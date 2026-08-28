import { EntityManager } from '@mikro-orm/core';
import { InboxMessage } from '../domain/inbox-message';
import { InboxMessageMapper } from './inbox-message.mapper';
import { InboxMessageEntity } from './inbox-message.entity';

export class InboxMessageRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Insere o registro de inbox ANTES do use case rodar. Se já existir
   * (UNIQUE em consumer_name + message_id), retorna a row existente e
   * o caller sabe que é replay — não processa de novo.
   */
  async tryInsert(
    consumerName: string,
    messageId: string,
    payloadHash: string,
    now: Date,
  ): Promise<{ inserted: true; inbox: InboxMessage } | { inserted: false; existing: InboxMessage }> {
    const existing = await this.findByMessageId(consumerName, messageId);
    if (existing) {
      return { inserted: false, existing };
    }
    const inbox = InboxMessage.receive({
      consumerName,
      messageId,
      payloadHash,
      now,
    });
    this.em.persist(InboxMessageMapper.toEntity(inbox));
    return { inserted: true, inbox };
  }

  async findByMessageId(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const entity = await this.em.findOne(InboxMessageEntity, {
      consumerName,
      messageId,
    });
    return entity ? InboxMessageMapper.toDomain(entity) : null;
  }

  async markProcessed(consumerName: string, messageId: string, at: Date): Promise<void> {
    await this.em.execute(
      `UPDATE inbox_messages
          SET processed_at = ?
        WHERE consumer_name = ? AND message_id = ?`,
      [at, consumerName, messageId],
    );
  }
}
