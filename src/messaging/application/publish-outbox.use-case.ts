import { EntityManager } from '@mikro-orm/core';
import { OutboxRepository } from '../persistence/outbox.repository';
import { OutboxPublisher } from '../i-outbox-publisher';

export const OUTBOX_PUBLISHER_BASE_BACKOFF_MS = 2_000;
export const OUTBOX_PUBLISHER_MAX_BACKOFF_MS = 15 * 60 * 1_000;
export const OUTBOX_PUBLISHER_MAX_BATCH = 50;

export interface PublishOutboxResult {
  published: number;
  rescheduled: number;
}

export class PublishOutboxUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly outboxRepo: OutboxRepository,
    private readonly publisher: OutboxPublisher,
  ) {}

  async runOnce(now: Date = new Date()): Promise<PublishOutboxResult> {
    let published = 0;
    let rescheduled = 0;
    let batchSize = 0;

    // FOR UPDATE SKIP LOCKED exige transação. Cada publisher pega
    // um batch exclusivo; commits liberam os locks para os outros.
    do {
      const { processed, hasMore, batch } = await this.em.transactional(async () => {
        const candidates = await this.outboxRepo.findDueForPublish(now, OUTBOX_PUBLISHER_MAX_BATCH);
        if (candidates.length === 0) {
          return { processed: 0, hasMore: false, batch: 0 };
        }

        let local = 0;
        for (const event of candidates) {
          try {
            await this.publisher.publish(event);
            await this.outboxRepo.markPublished(event.id, now);
            local++;
          } catch {
            const nextAttempt = computeNextAttempt(now, event.attempts + 1);
            await this.outboxRepo.scheduleRetry(event.id, nextAttempt, event.attempts + 1);
          }
        }
        return { processed: local, hasMore: candidates.length === OUTBOX_PUBLISHER_MAX_BATCH, batch: candidates.length };
      });

      published += processed;
      rescheduled += batch - processed;
      batchSize = batch;
      if (!hasMore) break;
    } while (batchSize > 0);

    return { published, rescheduled };
  }
}

export function computeNextAttempt(now: Date, attempts: number): Date {
  const exp = Math.min(Math.pow(2, attempts) * OUTBOX_PUBLISHER_BASE_BACKOFF_MS, OUTBOX_PUBLISHER_MAX_BACKOFF_MS);
  return new Date(now.getTime() + exp);
}
