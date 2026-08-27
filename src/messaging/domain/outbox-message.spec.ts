// src/messaging/domain/outbox-message.spec.ts

import { describe, it, expect } from 'bun:test';
import { WagerTransactionProcessed, type EventContext } from '../../wagering/events/wager-events';
import { OutboxMessage, OutboxAlreadyPublishedError } from './outbox-message';

const FIXED = new Date('2026-08-25T12:00:00.000Z');
const ctx: EventContext = {
  eventId: 'evt-1',
  correlationId: 'corr-1',
  occurredAt: FIXED,
};

function makeEvent() {
  return WagerTransactionProcessed.from({
    transactionId: 'tx-1',
    providerId: 'p',
    externalTransactionId: 'ext-1',
    playerId: 'pl',
    walletId: 'w',
    roundId: 'r',
    gameId: 'g',
    kind: 'BET',
    money: { amount: '25.00', currency: 'BRL' },
    ctx,
  });
}

describe('OutboxMessage.enqueue', () => {
  it('enfileira evento a partir de IntegrationEvent', () => {
    const event = makeEvent();
    const msg = OutboxMessage.enqueue(event);
    expect(msg.id).toBe(event.eventId);
    expect(msg.eventId).toBe(event.eventId);
    expect(msg.eventType).toBe('WagerTransactionProcessed');
    expect(msg.aggregateId).toBe('w');
    expect(msg.attempts).toBe(0);
    expect(msg.isPending()).toBe(true);
    expect(msg.isDue(FIXED)).toBe(true);
  });

  it('payload é o envelope serializado', () => {
    const event = makeEvent();
    const msg = OutboxMessage.enqueue(event);
    const env = msg.payload as any;
    expect(env.eventType).toBe('WagerTransactionProcessed');
    expect(env.version).toBe(1);
    expect(env.data.kind).toBe('BET');
  });
});

describe('OutboxMessage transitions', () => {
  it('markPublished seta publishedAt e desmarca pending', () => {
    const msg = OutboxMessage.enqueue(makeEvent());
    msg.markPublished(FIXED);
    expect(msg.isPending()).toBe(false);
    expect(msg.publishedAt).toEqual(FIXED);
    expect(msg.nextAttemptAt).toBeUndefined();
  });

  it('markPublished chamado duas vezes lança erro', () => {
    const msg = OutboxMessage.enqueue(makeEvent());
    msg.markPublished(FIXED);
    expect(() => msg.markPublished(FIXED)).toThrow(OutboxAlreadyPublishedError);
  });

  it('scheduleRetry incrementa attempts e calcula backoff exponencial', () => {
    const msg = OutboxMessage.enqueue(makeEvent());
    msg.scheduleRetry(FIXED); // attempts=1, +2s
    expect(msg.attempts).toBe(1);
    expect(msg.nextAttemptAt!.getTime() - FIXED.getTime()).toBe(2000);

    msg.scheduleRetry(FIXED); // attempts=2, +4s
    expect(msg.attempts).toBe(2);
    expect(msg.nextAttemptAt!.getTime() - FIXED.getTime()).toBe(4000);

    msg.scheduleRetry(FIXED); // attempts=3, +8s
    expect(msg.attempts).toBe(3);
    expect(msg.nextAttemptAt!.getTime() - FIXED.getTime()).toBe(8000);
  });

  it('scheduleRetry após markPublished lança erro', () => {
    const msg = OutboxMessage.enqueue(makeEvent());
    msg.markPublished(FIXED);
    expect(() => msg.scheduleRetry(FIXED)).toThrow(OutboxAlreadyPublishedError);
  });

  it('isDue respeita nextAttemptAt', () => {
    const msg = OutboxMessage.enqueue(makeEvent());
    msg.scheduleRetry(FIXED); // +2s

    const before = new Date(FIXED.getTime() + 1000);
    const after = new Date(FIXED.getTime() + 3000);

    expect(msg.isDue(before)).toBe(false);
    expect(msg.isDue(after)).toBe(true);
  });
});
