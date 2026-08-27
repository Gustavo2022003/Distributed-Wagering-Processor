// src/messaging/persistence/inbox-message.entity.ts

import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/decorators/legacy';

@Entity({ tableName: 'inbox_messages' })
@Index({ name: 'ix_inbox_consumer_processed', properties: ['consumerName', 'processedAt'] })
export class InboxMessageEntity {
  // PK composta: (messageId, consumerName) — garante unicidade
  @PrimaryKey({ type: 'varchar', length: 128, name: 'message_id' })
  messageId!: string;

  @PrimaryKey({ type: 'varchar', length: 64, name: 'consumer_name' })
  consumerName!: string;

  @Property({ type: 'char', length: 64, name: 'payload_hash' })
  payloadHash!: string;

  @Property({ type: 'timestamptz', name: 'received_at' })
  receivedAt!: Date;

  @Property({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt?: Date;
}
