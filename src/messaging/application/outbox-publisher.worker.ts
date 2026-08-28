import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from '@mikro-orm/core';
import { PublishOutboxUseCase } from './publish-outbox.use-case';
import { OutboxRepository } from '../persistence/outbox.repository';
import { OutboxPublisher } from '../i-outbox-publisher';

@Injectable()
export class OutboxPublisherWorker {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private isRunning = false;

  constructor(
    private readonly em: EntityManager,
    private readonly outboxRepo: OutboxRepository,
    private readonly publisher: OutboxPublisher,
  ) {}

  @Cron(CronExpression.EVERY_2_SECONDS, { name: 'outbox-publisher-worker' })
  async tick(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      const useCase = new PublishOutboxUseCase(this.em, this.outboxRepo, this.publisher);
      const result = await useCase.runOnce();
      if (result.published || result.rescheduled) {
        this.logger.log(
          `published=${result.published} rescheduled=${result.rescheduled}`,
        );
      }
    } catch (err) {
      this.logger.error('tick failed', err as Error);
    } finally {
      this.isRunning = false;
    }
  }
}
