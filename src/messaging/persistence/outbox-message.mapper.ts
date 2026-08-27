// src/messaging/persistence/outbox-message.mapper.ts

import { OutboxMessage, type OutboxMessageState } from '../domain/outbox-message';
import { OutboxMessageEntity } from './outbox-message.entity';

export const OutboxMessageMapper = {
  toDomain(entity: OutboxMessageEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: entity.id,
      eventId: entity.eventId,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      correlationId: entity.correlationId,
      causationId: entity.causationId,
      payload: entity.payload,
      occurredAt: entity.occurredAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt,
      publishedAt: entity.publishedAt,
    });
  },

  toEntity(domain: OutboxMessage): OutboxMessageEntity {
    const e = new OutboxMessageEntity();
    e.id = domain.id;
    e.eventId = domain.eventId;
    e.aggregateId = domain.aggregateId;
    e.eventType = domain.eventType;
    e.correlationId = domain.correlationId;
    e.causationId = domain.causationId;
    e.payload = { ...domain.payload };
    e.occurredAt = domain.occurredAt;
    e.attempts = domain.attempts;
    e.nextAttemptAt = domain.nextAttemptAt;
    e.publishedAt = domain.publishedAt;
    return e;
  },

  toStateSnapshot(domain: OutboxMessage): OutboxMessageState {
    return {
      id: domain.id,
      eventId: domain.eventId,
      aggregateId: domain.aggregateId,
      eventType: domain.eventType,
      correlationId: domain.correlationId,
      causationId: domain.causationId,
      payload: domain.payload,
      occurredAt: domain.occurredAt,
      attempts: domain.attempts,
      nextAttemptAt: domain.nextAttemptAt,
      publishedAt: domain.publishedAt,
    };
  },
};
