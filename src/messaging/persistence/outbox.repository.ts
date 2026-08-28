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
}
