import { EntityManager } from '@mikro-orm/core';
import { v4 as uuid } from 'uuid';
import { Money } from '../../shared/money';
import { Wallet, type WalletState } from '../domain/wallet';
import { WalletRepository } from '../persistence/wallet.repository';
import { WagerTransactionRepository } from '../../wagering/persistence/wager-transaction.repository';
import { WalletLedgerEntryRepository } from '../../ledger/persistence/wallet-ledger-entry.repository';
import { OutboxRepository } from '../../messaging/persistence/outbox.repository';
import { WagerTransaction } from '../../wagering/domain/wager-transaction';
import { WalletLedgerEntry } from '../../ledger/domain/wallet-ledger-entry';
import { OutboxMessage } from '../../messaging/domain/outbox-message';
import { WagerTransactionProcessed, WalletBalanceChanged } from '../../wagering/events/wager-events';
import { TerminalBusinessError } from '../../wagering/application/errors';
import { EntityExistsError } from '../domain/errors';

export class WalletAlreadyExistsError extends TerminalBusinessError {
  readonly code = 'WALLET_ALREADY_EXISTS';
  constructor(playerId: string, currency: string) {
    super(`Wallet already exists for playerId=${playerId}, currency=${currency}`);
  }
}

export interface CreateWalletDto {
  playerId: string;
  currency: string;
  initialBalance: Money;
  now?: Date;
}

export interface CreateWalletResult {
  walletId: string;
  balance: ReturnType<Money['toJSON']>;
  openingTransactionId?: string;
}

export class CreateWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepo: WalletRepository,
    private readonly wtxRepo: WagerTransactionRepository,
    private readonly ledgerRepo: WalletLedgerEntryRepository,
    private readonly outboxRepo: OutboxRepository,
  ) {}

  async execute(dto: CreateWalletDto): Promise<CreateWalletResult> {
    return await this.em.transactional(async () => {
      const existing = await this.walletRepo.findByPlayerCurrency(dto.playerId, dto.currency);
      if (existing) {
        throw new WalletAlreadyExistsError(dto.playerId, dto.currency);
      }

      const now = dto.now ?? new Date();
      const wallet = Wallet.open({
        id: uuid(),
        playerId: dto.playerId,
        initialBalance: dto.initialBalance,
        now,
      });
      await this.walletRepo.insert(wallet);

      if (!dto.initialBalance.isZero()) {
        const tx = WagerTransaction.createOpening({
          id: uuid(),
          walletId: wallet.id,
          playerId: wallet.playerId,
          money: dto.initialBalance,
          now,
        });
        await this.wtxRepo.insert(tx);

        const entry = WalletLedgerEntry.create({
          id: uuid(),
          walletId: wallet.id,
          transactionId: tx.id,
          direction: 'CREDIT' as const,
          money: dto.initialBalance.toJSON(),
          balanceBefore: { amount: '0.00', currency: dto.currency },
          balanceAfter: dto.initialBalance.toJSON(),
          now,
        });
        await this.ledgerRepo.insert(entry);

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
              ctx: {
                eventId: uuid(),
                correlationId: 'create-wallet',
                occurredAt: now,
              },
            }),
          ),
        );
        await this.outboxRepo.enqueue(
          OutboxMessage.enqueue(
            WalletBalanceChanged.from({
              walletId: wallet.id,
              transactionId: tx.id,
              direction: 'CREDIT' as const,
              money: dto.initialBalance.toJSON(),
              balanceBefore: { amount: '0.00', currency: dto.currency },
              balanceAfter: dto.initialBalance.toJSON(),
              walletVersion: wallet.version,
              ctx: {
                eventId: uuid(),
                correlationId: 'create-wallet',
                occurredAt: now,
              },
            }),
          ),
        );

        return {
          walletId: wallet.id,
          balance: wallet.balance.toJSON(),
          openingTransactionId: tx.id,
        };
      }

      return {
        walletId: wallet.id,
        balance: wallet.balance.toJSON(),
      };
    });
  }
}
