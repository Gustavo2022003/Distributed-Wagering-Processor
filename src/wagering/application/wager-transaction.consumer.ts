// src/wagering/application/wager-transaction.consumer.ts

import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { ConsumeWagerTransactionUseCase } from './consume-wager-transaction.use-case';
import type { SqsConsumer } from '../../messaging/sqs-consumer.types';
import { InboxMessageRepository } from '../../messaging/persistence/inbox-message.repository';
import { ProcessWagerTransactionUseCase } from './process-wager-transaction.use-case';
import { WalletRepository } from '../../wallet/persistence/wallet.repository';
import { WagerTransactionRepository } from '../persistence/wager-transaction.repository';
import { WalletLedgerEntryRepository } from '../../ledger/persistence/wallet-ledger-entry.repository';
import { OutboxRepository } from '../../messaging/persistence/outbox.repository';

const POLL_INTERVAL_MS = 1_000;
const MAX_MESSAGES_PER_POLL = 10;
const POLL_WAIT_SECONDS = 1;

@Injectable()
export class WagerTransactionConsumer implements OnApplicationShutdown {
  private readonly logger = new Logger(WagerTransactionConsumer.name);
  private isPolling = false;
  private shutdownRequested = false;

  constructor(
    private readonly em: EntityManager,
    private readonly consumer: SqsConsumer,
  ) {}

  static build(
    em: EntityManager,
    consumer: SqsConsumer,
  ): WagerTransactionConsumer {
    return new WagerTransactionConsumer(em, consumer);
  }

  async onApplicationShutdown(): Promise<void> {
    this.shutdownRequested = true;
    // Espera o poll atual terminar
    while (this.isPolling) {
      await new Promise((r) => setTimeout(r, 50));
    }
    await this.consumer.shutdown();
    this.logger.log('consumer shutdown complete');
  }

  async start(): Promise<void> {
    this.logger.log('consumer started');
    while (!this.shutdownRequested) {
      this.isPolling = true;
      try {
        await this.pollOnce();
      } catch (err) {
        this.logger.error('poll failed', err as Error);
      } finally {
        this.isPolling = false;
      }
      if (!this.shutdownRequested) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    }
  }

  private async pollOnce(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      const messages = await this.consumer.receive(0, MAX_MESSAGES_PER_POLL);
      if (messages.length === 0) break;

      await Promise.all(
        messages.map(async (msg) => {
          const msgEm = this.em.fork();
          const processUseCase = new ProcessWagerTransactionUseCase(
            msgEm,
            new WalletRepository(msgEm),
            new WagerTransactionRepository(msgEm),
            new WalletLedgerEntryRepository(msgEm),
            new OutboxRepository(msgEm),
          );
          const inboxRepo = new InboxMessageRepository(msgEm);
          const useCase = new ConsumeWagerTransactionUseCase(
            msgEm,
            this.consumer,
            inboxRepo,
            processUseCase,
          );
          try {
            const result = await useCase.processOne(msg);
            this.logger.debug(`msg=${msg.messageId.slice(0, 8)} action=${result.action} reason=${result.reason ?? '-'}`);
          } catch (err) {
            this.logger.error(`msg=${msg.messageId.slice(0, 8)} failed`, err as Error);
          } finally {
            // Garante que o fork libera a connection do pool
            msgEm.clear();
          }
        }),
      );

      if (messages.length < MAX_MESSAGES_PER_POLL) break;
    }
  }
}
