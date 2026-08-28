import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from '@mikro-orm/core';
import { ReprocessPendingReferenceUseCase } from './reprocess-pending-reference.use-case';
import { WalletRepository } from '../../wallet/persistence/wallet.repository';
import { WagerTransactionRepository } from '../persistence/wager-transaction.repository';
import { WalletLedgerEntryRepository } from '../../ledger/persistence/wallet-ledger-entry.repository';
import { OutboxRepository } from '../../messaging/persistence/outbox.repository';

@Injectable()
export class PendingReferenceWorker {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private isRunning = false;

  constructor(private readonly em: EntityManager) {}

  @Cron(CronExpression.EVERY_5_SECONDS, { name: 'pending-reference-worker' })
  async tick(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      const useCase = new ReprocessPendingReferenceUseCase(
        this.em,
        new WalletRepository(this.em),
        new WagerTransactionRepository(this.em),
        new WalletLedgerEntryRepository(this.em),
        new OutboxRepository(this.em),
      );
      const result = await useCase.runOnce();
      if (result.processed || result.rejected) {
        this.logger.log(
          `processed=${result.processed} rejected=${result.rejected} skipped=${result.skipped}`,
        );
      }
    } catch (err) {
      this.logger.error('tick failed', err as Error);
    } finally {
      this.isRunning = false;
    }
  }
}
