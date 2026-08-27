// src/messaging/persistence/inbox-message.mapper.ts

import { InboxMessage, type InboxMessageState } from '../domain/inbox-message';
import { InboxMessageEntity } from './inbox-message.entity';

export const InboxMessageMapper = {
  toDomain(entity: InboxMessageEntity): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: entity.messageId,
      consumerName: entity.consumerName,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt,
    });
  },

  toEntity(domain: InboxMessage): InboxMessageEntity {
    const e = new InboxMessageEntity();
    e.messageId = domain.messageId;
    e.consumerName = domain.consumerName;
    e.payloadHash = domain.payloadHash;
    e.receivedAt = domain.receivedAt;
    e.processedAt = domain.processedAt;
    return e;
  },

  toStateSnapshot(domain: InboxMessage): InboxMessageState {
    return {
      messageId: domain.messageId,
      consumerName: domain.consumerName,
      payloadHash: domain.payloadHash,
      receivedAt: domain.receivedAt,
      processedAt: domain.processedAt,
    };
  },
};
