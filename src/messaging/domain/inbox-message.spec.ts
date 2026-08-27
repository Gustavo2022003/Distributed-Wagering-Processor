// src/messaging/domain/inbox-message.spec.ts

import { describe, it, expect } from 'bun:test';
import { InboxMessage, InboxAlreadyProcessedError } from './inbox-message';

const FIXED = new Date('2026-08-25T12:00:00.000Z');

describe('InboxMessage.receive', () => {
  it('cria mensagem não-processada com timestamp', () => {
    const msg = InboxMessage.receive({
      messageId: 'msg-1',
      consumerName: 'wagering-consumer',
      payloadHash: 'abc123',
      now: FIXED,
    });
    expect(msg.messageId).toBe('msg-1');
    expect(msg.consumerName).toBe('wagering-consumer');
    expect(msg.payloadHash).toBe('abc123');
    expect(msg.receivedAt).toEqual(FIXED);
    expect(msg.processedAt).toBeUndefined();
    expect(msg.isProcessed()).toBe(false);
  });

  it('rejeita messageId vazio', () => {
    expect(() =>
      InboxMessage.receive({
        messageId: '',
        consumerName: 'c',
        payloadHash: 'h',
      }),
    ).toThrow();
  });

  it('rejeita consumerName vazio', () => {
    expect(() =>
      InboxMessage.receive({
        messageId: 'm',
        consumerName: '',
        payloadHash: 'h',
      }),
    ).toThrow();
  });
});

describe('InboxMessage.markProcessed', () => {
  it('marca como processada', () => {
    const msg = InboxMessage.receive({
      messageId: 'm',
      consumerName: 'c',
      payloadHash: 'h',
      now: FIXED,
    });
    msg.markProcessed(FIXED);
    expect(msg.isProcessed()).toBe(true);
    expect(msg.processedAt).toEqual(FIXED);
  });

  it('lança erro se chamada duas vezes', () => {
    const msg = InboxMessage.receive({
      messageId: 'm',
      consumerName: 'c',
      payloadHash: 'h',
      now: FIXED,
    });
    msg.markProcessed(FIXED);
    expect(() => msg.markProcessed(FIXED)).toThrow(InboxAlreadyProcessedError);
  });
});

describe('InboxMessage.rehydrate', () => {
  it('reconstrói estado já processado', () => {
    const msg = InboxMessage.rehydrate({
      messageId: 'm',
      consumerName: 'c',
      payloadHash: 'h',
      receivedAt: FIXED,
      processedAt: new Date('2026-08-25T13:00:00.000Z'),
    });
    expect(msg.isProcessed()).toBe(true);
  });
});
