import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/decorators/legacy';
import { v4 as uuid } from 'uuid';

@Entity({ tableName: 'outbox_messages' })
@Unique({ name: 'uq_outbox_event_id', properties: ['eventId'] })
@Index({
  name: 'ix_outbox_pending_due',
  properties: ['publishedAt', 'nextAttemptAt'],
})
export class OutboxMessageEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid', name: 'event_id' })
  eventId!: string;

  @Property({ type: 'uuid', name: 'aggregate_id' })
  aggregateId!: string;

  @Property({ type: 'varchar', length: 64, name: 'event_type' })
  eventType!: string;

  @Property({ type: 'varchar', length: 64, name: 'correlation_id' })
  correlationId!: string;

  @Property({ type: 'varchar', length: 64, name: 'causation_id', nullable: true })
  causationId?: string;

  @Property({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Property({ type: 'timestamptz', name: 'occurred_at' })
  occurredAt!: Date;

  @Property({ type: 'int', default: 0 })
  attempts!: number;

  @Property({ type: 'timestamptz', name: 'next_attempt_at', nullable: true })
  nextAttemptAt?: Date;

  @Property({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt?: Date;

  static newId(): string {
    return uuid();
  }
}
