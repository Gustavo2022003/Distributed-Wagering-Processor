import { EntityManager } from '@mikro-orm/core';
import { OutboxMessage } from '../domain/outbox-message';
import { OutboxMessageMapper } from './outbox-message.mapper';
import { OutboxMessageEntity } from './outbox-message.entity';

export class OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  async enqueue(event: OutboxMessage): Promise<void> {
    const entity = OutboxMessageMapper.toEntity(event);
    this.em.persist(entity);
  }

  async findDueForPublish(now: Date, limit: number): Promise<OutboxMessage[]> {
    const rows: any[] = await this.em.getConnection().execute(
      `SELECT id, event_id, aggregate_id, event_type, correlation_id, causation_id,
              payload, occurred_at, attempts, next_attempt_at, published_at
         FROM outbox_messages
        WHERE published_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY occurred_at ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );
    return rows.map((row) => rowToDomain(row));
  }

  async markPublished(id: string, at: Date): Promise<void> {
    await this.em.execute(
      `UPDATE outbox_messages
          SET published_at = ?,
              next_attempt_at = NULL
        WHERE id = ?::uuid`,
      [at, id],
    );
  }

  async scheduleRetry(id: string, nextAttemptAt: Date, attempts: number): Promise<void> {
    await this.em.execute(
      `UPDATE outbox_messages
          SET attempts = ?,
              next_attempt_at = ?
        WHERE id = ?::uuid`,
      [attempts, nextAttemptAt, id],
    );
  }
}

function rowToDomain(row: any): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: row.id,
    eventId: row.event_id,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    payload: row.payload,
    occurredAt: row.occurred_at,
    attempts: row.attempts ?? 0,
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at) : undefined,
    publishedAt: row.published_at ? new Date(row.published_at) : undefined,
  });
}
