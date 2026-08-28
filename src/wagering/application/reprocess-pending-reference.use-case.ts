import { EntityManager } from '@mikro-orm/core';
import { FailureCode } from '../../shared/failure-codes';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  LedgerDirection,
} from '../domain/wager-transaction';
import { Money } from '../../shared/money';
import { WalletLedgerEntry } from '../../ledger/domain/wallet-ledger-entry';
import { WalletRepository } from '../../wallet/persistence/wallet.repository';
import { WagerTransactionRepository } from '../persistence/wager-transaction.repository';
import { WalletLedgerEntryRepository } from '../../ledger/persistence/wallet-ledger-entry.repository';
import { OutboxMessage } from '../../messaging/domain/outbox-message';
import { OutboxRepository } from '../../messaging/persistence/outbox.repository';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  type EventContext,
} from '../events/wager-events';
import { v4 as uuid } from 'uuid';

export const PENDING_REFERENCE_MAX_ATTEMPTS = 10;
export const PENDING_REFERENCE_BASE_BACKOFF_MS = 2_000;
export const PENDING_REFERENCE_MAX_BACKOFF_MS = 15 * 60 * 1_000;

export interface ReprocessResult {
  processed: number;
  rejected: number;
  skipped: number;
}

export class ReprocessPendingReferenceUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepo: WalletRepository,
    private readonly wtxRepo: WagerTransactionRepository,
    private readonly ledgerRepo: WalletLedgerEntryRepository,
    private readonly outboxRepo: OutboxRepository,
  ) {}

  async runOnce(now: Date = new Date()): Promise<ReprocessResult> {
    return await this.em.transactional(async () => {
      const candidates = await this.wtxRepo.findDuePendingReferences(now, 50);
      let processed = 0;
      let rejected = 0;
      let skipped = 0;

      for (const tx of candidates) {
        try {
          const outcome = await this.reprocessOne(tx, now);
          if (outcome === 'processed') processed++;
          else if (outcome === 'rejected') rejected++;
          else skipped++;
        } catch {
          skipped++;
        }
      }

      return { processed, rejected, skipped };
    });
  }

  private async reprocessOne(
    tx: WagerTransaction,
    now: Date,
  ): Promise<'processed' | 'rejected' | 'skipped'> {
    if (tx.status !== WagerTransactionStatus.PendingReference) {
      return 'skipped';
    }

    if (tx.attempts >= PENDING_REFERENCE_MAX_ATTEMPTS) {
      tx.reject(FailureCode.ReferenceResolutionExhausted, now);
      await this.wtxRepo.update(tx);
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
            failureCode: FailureCode.ReferenceResolutionExhausted,
            money: tx.money.toJSON(),
            referenceExternalTransactionId: tx.referenceExternalTransactionId,
            ctx: this.eventCtxFor(tx, now),
          }),
        ),
      );
      await this.em.flush();
      return 'rejected';
    }

    const reference = await this.wtxRepo.findByProviderExternalId(
      tx.providerId,
      tx.referenceExternalTransactionId!,
    );

    if (!reference) {
      tx.schedulePendingReferenceRetry(now, PENDING_REFERENCE_BASE_BACKOFF_MS, PENDING_REFERENCE_MAX_BACKOFF_MS);
      await this.wtxRepo.update(tx);
      await this.em.flush();
      return 'skipped';
    }

    if (reference.status !== WagerTransactionStatus.Processed) {
      tx.reject(FailureCode.ReferenceNotProcessed, now);
      await this.wtxRepo.update(tx);
      await this.em.flush();
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
            failureCode: FailureCode.ReferenceNotProcessed,
            money: tx.money.toJSON(),
            referenceExternalTransactionId: tx.referenceExternalTransactionId,
            ctx: this.eventCtxFor(tx, now),
          }),
        ),
      );
      return 'rejected';
    }

    if (reference.money.currency !== tx.money.currency) {
      tx.reject(FailureCode.CurrencyMismatch, now);
      await this.wtxRepo.update(tx);
      await this.em.flush();
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
            failureCode: FailureCode.CurrencyMismatch,
            money: tx.money.toJSON(),
            referenceExternalTransactionId: tx.referenceExternalTransactionId,
            ctx: this.eventCtxFor(tx, now),
          }),
        ),
      );
      return 'rejected';
    }

    if (tx.kind === WagerTransactionKind.Refund && reference.kind !== WagerTransactionKind.Bet) {
      tx.reject(FailureCode.ReferenceMismatch, now);
      await this.wtxRepo.update(tx);
      await this.em.flush();
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
            failureCode: FailureCode.ReferenceMismatch,
            money: tx.money.toJSON(),
            referenceExternalTransactionId: tx.referenceExternalTransactionId,
            ctx: this.eventCtxFor(tx, now),
          }),
        ),
      );
      return 'rejected';
    }

    const alreadyReversed = await this.wtxRepo.findExistingReversal(
      tx.providerId,
      tx.referenceExternalTransactionId!,
      tx.kind,
    );
    if (alreadyReversed) {
      tx.reject(FailureCode.ReferenceAlreadyReversed, now);
      await this.wtxRepo.update(tx);
      await this.em.flush();
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
            failureCode: FailureCode.ReferenceAlreadyReversed,
            money: tx.money.toJSON(),
            referenceExternalTransactionId: tx.referenceExternalTransactionId,
            ctx: this.eventCtxFor(tx, now),
          }),
        ),
      );
      return 'rejected';
    }

    const wallet = await this.walletRepo.findById(tx.walletId);
    if (!wallet) {
      tx.reject(FailureCode.InfrastructureError, now);
      await this.wtxRepo.update(tx);
      await this.em.flush();
      return 'rejected';
    }

    const money = Money.from(tx.money.amount, tx.money.currency);
    const isDebit =
      tx.kind === WagerTransactionKind.Bet ||
      (tx.kind === WagerTransactionKind.Rollback && reference.kind !== WagerTransactionKind.Bet);
    const balanceAfter = isDebit ? wallet.balance.subtract(money) : wallet.balance.add(money);

    if (balanceAfter.isNegative()) {
      tx.reject(FailureCode.NegativeBalanceOnReversal, now);
      await this.wtxRepo.update(tx);
      await this.em.flush();
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
            failureCode: FailureCode.NegativeBalanceOnReversal,
            money: tx.money.toJSON(),
            referenceExternalTransactionId: tx.referenceExternalTransactionId,
            ctx: this.eventCtxFor(tx, now),
          }),
        ),
      );
      return 'rejected';
    }

    const ok = await this.walletRepo.updateWithCondition({
      id: wallet.id,
      expectedVersion: wallet.version,
      newBalanceAmount: balanceAfter.amount,
      newBalanceCurrency: balanceAfter.currency,
      newUpdatedAt: now,
      debitGuard: isDebit ? money.amount : undefined,
    });
    if (!ok) {
      tx.schedulePendingReferenceRetry(now, PENDING_REFERENCE_BASE_BACKOFF_MS, PENDING_REFERENCE_MAX_BACKOFF_MS);
      await this.wtxRepo.update(tx);
      await this.em.flush();
      return 'skipped';
    }

    const direction = isDebit ? LedgerDirection.Debit : LedgerDirection.Credit;
    const entry = WalletLedgerEntry.create({
      id: uuid(),
      walletId: wallet.id,
      transactionId: tx.id,
      direction,
      money: money.toJSON(),
      balanceBefore: wallet.balance.toJSON(),
      balanceAfter: balanceAfter.toJSON(),
      now,
    });
    await this.ledgerRepo.insert(entry);

    tx.markProcessed(reference.id, now);
    await this.wtxRepo.update(tx);

    await this.outboxRepo.enqueue(
      OutboxMessage.enqueue(
        WalletBalanceChanged.from({
          walletId: wallet.id,
          transactionId: tx.id,
          direction,
          money: money.toJSON(),
          balanceBefore: wallet.balance.toJSON(),
          balanceAfter: balanceAfter.toJSON(),
          walletVersion: wallet.version + 1,
          ctx: this.eventCtxFor(tx, now),
        }),
      ),
    );

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
          referenceTransactionId: reference.id,
          referenceExternalTransactionId: tx.referenceExternalTransactionId,
          ctx: this.eventCtxFor(tx, now),
        }),
      ),
    );

    await this.em.flush();

    return 'processed';
  }

  private eventCtxFor(tx: WagerTransaction, now: Date): EventContext {
    return {
      eventId: uuid(),
      correlationId: tx.correlationId ?? 'pending-reference-worker',
      occurredAt: now,
    };
  }
}
