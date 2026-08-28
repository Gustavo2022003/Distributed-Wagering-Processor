import { EntityManager } from '@mikro-orm/core';
import { v4 as uuid } from 'uuid';
import { Money, MoneyProps } from '../../shared/money';
import { FailureCode } from '../../shared/failure-codes';
import { TerminalBusinessError } from './errors';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  LedgerDirection,
  PayloadConflictError,
} from '../domain/wager-transaction';
import { Wallet } from '../../wallet/domain/wallet';
import { WalletLedgerEntry } from '../../ledger/domain/wallet-ledger-entry';
import { WalletRepository } from '../../wallet/persistence/wallet.repository';
import { WagerTransactionRepository } from '../persistence/wager-transaction.repository';
import { WalletLedgerEntryRepository } from '../../ledger/persistence/wallet-ledger-entry.repository';
import { OutboxMessage } from '../../messaging/domain/outbox-message';
import { OutboxRepository } from '../../messaging/persistence/outbox.repository';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
  WalletBalanceChanged,
  type EventContext,
} from '../events/wager-events';

export interface ProcessWagerTransactionDto {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
  correlationId: string;
  causationId?: string;
  now: Date;
}

export type ProcessWagerTransactionResult =
  | {
      status: WagerTransactionStatus.Processed;
      transactionId: string;
      balance: MoneyProps | null;
      referenceTransactionId: string | undefined;
      idempotentReplay: boolean;
    }
  | {
      status: WagerTransactionStatus.Rejected;
      transactionId: string;
      failureCode: FailureCode;
      idempotentReplay: boolean;
    }
  | {
      status: WagerTransactionStatus.PendingReference;
      transactionId: string;
      referenceExternalTransactionId: string;
      idempotentReplay: boolean;
    };

export class ProcessWagerTransactionUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepo: WalletRepository,
    private readonly wtxRepo: WagerTransactionRepository,
    private readonly ledgerRepo: WalletLedgerEntryRepository,
    private readonly outboxRepo: OutboxRepository,
  ) {}

  async execute(
    dto: ProcessWagerTransactionDto,
  ): Promise<ProcessWagerTransactionResult> {
    return await this.em.transactional(async () => {
      const existing = await this.wtxRepo.findByIdempotencyKey(dto.idempotencyKey);
      if (existing) {
        if (existing.payloadHash === dto.payloadHash) {
          return this.replayResult(existing);
        }
        throw new PayloadConflictError(existing.payloadHash, dto.payloadHash);
      }

      const tx = WagerTransaction.create({
        id: dto.id,
        providerId: dto.providerId,
        externalTransactionId: dto.externalTransactionId,
        idempotencyKey: dto.idempotencyKey,
        payloadHash: dto.payloadHash,
        walletId: dto.walletId,
        playerId: dto.playerId,
        roundId: dto.roundId,
        gameId: dto.gameId,
        kind: dto.kind,
        money: Money.from(dto.money.amount, dto.money.currency),
        referenceExternalTransactionId: dto.referenceExternalTransactionId,
        now: dto.now,
      });

      let reference: WagerTransaction | undefined;
      if (tx.requiresReference()) {
        const refResult = await this.resolveReference(tx, dto);
        if (refResult.outcome === 'pending') {
          await this.wtxRepo.insert(tx);
          await this.enqueuePendingReference(tx, dto);
          return {
            status: WagerTransactionStatus.PendingReference,
            transactionId: tx.id,
            referenceExternalTransactionId: dto.referenceExternalTransactionId!,
            idempotentReplay: false,
          };
        }
        if (refResult.outcome === 'rejected') {
          tx.reject(refResult.failureCode, dto.now);
          await this.wtxRepo.insert(tx);
          await this.enqueueRejected(tx, refResult.failureCode, dto);
          return {
            status: WagerTransactionStatus.Rejected,
            transactionId: tx.id,
            failureCode: refResult.failureCode,
            idempotentReplay: false,
          };
        }
        reference = refResult.reference;
      }

      const wallet = await this.walletRepo.findById(dto.walletId);
      if (!wallet) {
        throw new TerminalBusinessError(`Wallet not found: ${dto.walletId}`);
      }

      const kindResult = await this.applyKindRule(tx, wallet, reference, dto.now);
      if (kindResult.outcome === 'rejected') {
        await this.wtxRepo.insert(tx);
        await this.enqueueRejected(tx, kindResult.failureCode, dto);
        return {
          status: WagerTransactionStatus.Rejected,
          transactionId: tx.id,
          failureCode: kindResult.failureCode,
          idempotentReplay: false,
        };
      }

      if (tx.affectsBalance() && tx.kind !== WagerTransactionKind.Loss) {
        await this.wtxRepo.insert(tx);
        await this.em.flush();
      }

      let finalBalance: Money = wallet.balance;
      if (tx.affectsBalance()) {
        const result = await this.applyBalanceChange(tx, wallet, reference, dto);
        if (!result.applied) {
          tx.reject(FailureCode.InsufficientFunds, dto.now);
          await this.wtxRepo.update(tx);
          await this.em.flush();
          await this.enqueueRejected(tx, FailureCode.InsufficientFunds, dto);
          return {
            status: WagerTransactionStatus.Rejected,
            transactionId: tx.id,
            failureCode: FailureCode.InsufficientFunds,
            idempotentReplay: false,
          };
        }
        finalBalance = result.balanceAfter;
      }

      if (tx.kind === WagerTransactionKind.Loss) {
        await this.wtxRepo.insert(tx);
        await this.em.flush();
      }

      await this.outboxRepo.enqueue(
        OutboxMessage.enqueue(
          WagerTransactionProcessed.from({
            transactionId: tx.id,
            providerId: tx.providerId,
            externalTransactionId: tx.externalTransactionId,
            playerId: tx.playerId,
            walletId: tx.walletId,
            roundId: tx.roundId,
            gameId: tx.gameId,
            kind: tx.kind,
            money: tx.money.toJSON(),
            referenceTransactionId: reference?.id,
            referenceExternalTransactionId: tx.referenceExternalTransactionId,
            ctx: this.eventCtxFor(tx, dto),
          }),
        ),
      );

      return {
        status: WagerTransactionStatus.Processed,
        transactionId: tx.id,
        balance: finalBalance.toJSON(),
        referenceTransactionId: reference?.id,
        idempotentReplay: false,
      };
    });
  }

  private async resolveReference(
    tx: WagerTransaction,
    dto: ProcessWagerTransactionDto,
  ): Promise<
    | { outcome: 'ok'; reference: WagerTransaction }
    | { outcome: 'pending' }
    | { outcome: 'rejected'; failureCode: FailureCode }
  > {
    const reference = await this.wtxRepo.findByProviderExternalId(
      dto.providerId,
      dto.referenceExternalTransactionId!,
    );

    if (!reference) {
      return { outcome: 'pending' };
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      return { outcome: 'rejected', failureCode: FailureCode.ReferenceNotProcessed };
    }

    if (tx.kind === WagerTransactionKind.Refund && reference.kind !== WagerTransactionKind.Bet) {
      return { outcome: 'rejected', failureCode: FailureCode.ReferenceMismatch };
    }

    if (reference.money.currency !== tx.money.currency) {
      return { outcome: 'rejected', failureCode: FailureCode.CurrencyMismatch };
    }

    if (reference.money.amount !== tx.money.amount) {
      return { outcome: 'rejected', failureCode: FailureCode.ReferenceMismatch };
    }

    const alreadyReversed = await this.wtxRepo.findExistingReversal(
      dto.providerId,
      dto.referenceExternalTransactionId!,
      tx.kind,
    );
    if (alreadyReversed) {
      return { outcome: 'rejected', failureCode: FailureCode.ReferenceAlreadyReversed };
    }

    return { outcome: 'ok', reference };
  }

  private async applyKindRule(
    tx: WagerTransaction,
    wallet: Wallet,
    reference: WagerTransaction | undefined,
    now: Date,
  ): Promise<{ outcome: 'ok' } | { outcome: 'rejected'; failureCode: FailureCode }> {
    if (tx.kind === WagerTransactionKind.Bet) {
      if (wallet.balance.isLessThan(tx.money)) {
        tx.reject(FailureCode.InsufficientFunds, now);
        return { outcome: 'rejected', failureCode: FailureCode.InsufficientFunds };
      }
    } else if (tx.kind === WagerTransactionKind.Loss) {
      tx.markProcessed(reference?.id, now);
    } else if (tx.kind === WagerTransactionKind.Refund || tx.kind === WagerTransactionKind.Rollback) {
      if (!reference) {
        return { outcome: 'rejected', failureCode: FailureCode.ReferenceNotFound };
      }
      const balanceAfter = this.simulateReversal(wallet.balance, tx.kind, reference.kind, tx.money);
      if (balanceAfter.isNegative()) {
        tx.reject(FailureCode.NegativeBalanceOnReversal, now);
        return { outcome: 'rejected', failureCode: FailureCode.NegativeBalanceOnReversal };
      }
    }
    return { outcome: 'ok' };
  }

  private simulateReversal(
    currentBalance: Money,
    reversalKind: WagerTransactionKind.Refund | WagerTransactionKind.Rollback,
    referenceKind: WagerTransactionKind,
    money: Money,
  ): Money {
    if (reversalKind === WagerTransactionKind.Refund) {
      return currentBalance.add(money);
    }
    if (referenceKind === WagerTransactionKind.Bet) {
      return currentBalance.add(money);
    }
    return currentBalance.subtract(money);
  }

  private async applyBalanceChange(
    tx: WagerTransaction,
    wallet: Wallet,
    reference: WagerTransaction | undefined,
    dto: ProcessWagerTransactionDto,
  ): Promise<{ applied: boolean; balanceAfter: Money }> {
    const isDebit =
      tx.kind === WagerTransactionKind.Bet ||
      (tx.kind === WagerTransactionKind.Rollback && reference?.kind !== WagerTransactionKind.Bet);

    const money = Money.from(tx.money.amount, tx.money.currency);
    const direction = isDebit ? LedgerDirection.Debit : LedgerDirection.Credit;
    const balanceAfter = isDebit
      ? wallet.balance.subtract(money)
      : wallet.balance.add(money);
    const entryId = uuid();
    const now = dto.now;

    const ok = await this.walletRepo.updateWithCondition({
      id: wallet.id,
      expectedVersion: wallet.version,
      newBalanceAmount: balanceAfter.amount,
      newBalanceCurrency: balanceAfter.currency,
      newUpdatedAt: now,
      debitGuard: isDebit ? money.amount : undefined,
    });

    if (!ok) {
      return { applied: false, balanceAfter };
    }

    tx.markProcessed(reference?.id, dto.now);
    await this.wtxRepo.update(tx);

    const entry = WalletLedgerEntry.create({
      id: entryId,
      walletId: wallet.id,
      transactionId: tx.id,
      direction,
      money: money.toJSON(),
      balanceBefore: wallet.balance.toJSON(),
      balanceAfter: balanceAfter.toJSON(),
      now,
    });
    await this.ledgerRepo.insert(entry);

    const event = WalletBalanceChanged.from({
      walletId: wallet.id,
      transactionId: tx.id,
      direction,
      money: money.toJSON(),
      balanceBefore: wallet.balance.toJSON(),
      balanceAfter: balanceAfter.toJSON(),
      walletVersion: wallet.version + 1,
      ctx: this.eventCtxFor(tx, dto),
    });
    await this.outboxRepo.enqueue(OutboxMessage.enqueue(event));

    await this.em.flush();

    return { applied: true, balanceAfter };
  }

  private async replayResult(
    existing: WagerTransaction,
  ): Promise<ProcessWagerTransactionResult> {
    if (existing.status === WagerTransactionStatus.Rejected) {
      return {
        status: WagerTransactionStatus.Rejected,
        transactionId: existing.id,
        failureCode: existing.failureCode!,
        idempotentReplay: true,
      };
    }
    if (existing.status === WagerTransactionStatus.PendingReference) {
      return {
        status: WagerTransactionStatus.PendingReference,
        transactionId: existing.id,
        referenceExternalTransactionId: existing.referenceExternalTransactionId!,
        idempotentReplay: true,
      };
    }
    if (existing.status === WagerTransactionStatus.Failed) {
      return {
        status: WagerTransactionStatus.Rejected,
        transactionId: existing.id,
        failureCode: existing.failureCode ?? FailureCode.InfrastructureError,
        idempotentReplay: true,
      };
    }
    const wallet = await this.walletRepo.findById(existing.walletId);
    return {
      status: WagerTransactionStatus.Processed,
      transactionId: existing.id,
      balance: wallet?.balance.toJSON() ?? null,
      referenceTransactionId: existing.referenceTransactionId,
      idempotentReplay: true,
    };
  }

  private eventCtxFor(tx: WagerTransaction, dto: ProcessWagerTransactionDto): EventContext {
    return {
      eventId: uuid(),
      correlationId: dto.correlationId,
      causationId: dto.causationId,
      occurredAt: dto.now,
    };
  }

  private async enqueueRejected(
    tx: WagerTransaction,
    failureCode: FailureCode,
    dto: ProcessWagerTransactionDto,
  ): Promise<void> {
    await this.outboxRepo.enqueue(
      OutboxMessage.enqueue(
        WagerTransactionRejected.from({
          transactionId: tx.id,
          providerId: tx.providerId,
          externalTransactionId: tx.externalTransactionId,
          playerId: tx.playerId,
          walletId: tx.walletId,
          roundId: tx.roundId,
          gameId: tx.gameId,
          kind: tx.kind,
          failureCode,
          money: tx.money.toJSON(),
          referenceExternalTransactionId: tx.referenceExternalTransactionId,
          ctx: this.eventCtxFor(tx, dto),
        }),
      ),
    );
  }

  private async enqueuePendingReference(
    tx: WagerTransaction,
    dto: ProcessWagerTransactionDto,
  ): Promise<void> {
    await this.outboxRepo.enqueue(
      OutboxMessage.enqueue(
        WagerTransactionPendingReference.from({
          transactionId: tx.id,
          providerId: tx.providerId,
          externalTransactionId: tx.externalTransactionId,
          playerId: tx.playerId,
          walletId: tx.walletId,
          roundId: dto.roundId,
          gameId: dto.gameId,
          kind: tx.kind,
          money: tx.money.toJSON(),
          referenceExternalTransactionId: tx.referenceExternalTransactionId!,
          ctx: this.eventCtxFor(tx, dto),
        }),
      ),
    );
  }
}
