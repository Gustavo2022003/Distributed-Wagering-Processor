// src/wagering/events/wager-events.spec.ts

import { describe, it, expect } from 'bun:test';
import { LedgerDirection } from '../domain/wager-transaction';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WalletBalanceChanged,
  WagerTransactionPendingReference,
  type EventContext,
} from './wager-events';

const ctx: EventContext = {
  eventId: 'evt-1',
  correlationId: 'corr-1',
  occurredAt: new Date('2026-08-25T12:00:00.000Z'),
};

describe('IntegrationEvent base', () => {
  it('eventType e version vêm do tipo, não de string solta', () => {
    const evt = WagerTransactionProcessed.from({
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
    expect(evt.eventType).toBe('WagerTransactionProcessed');
    expect(evt.version).toBe(1);
  });

  it('data é Readonly e congelado', () => {
    const evt = WagerTransactionProcessed.from({
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
    expect(() => {
      (evt.data as any).transactionId = 'hack';
    }).toThrow();
  });

  it('toEnvelope serializa occurredAt como ISO-8601', () => {
    const evt = WagerTransactionProcessed.from({
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
    const env = evt.toEnvelope();
    expect(env.occurredAt).toBe('2026-08-25T12:00:00.000Z');
    expect(env.eventType).toBe('WagerTransactionProcessed');
    expect(env.version).toBe(1);
    expect(env.data.kind).toBe('BET');
  });

  it('data carrega MoneyProps (string), nunca Money', () => {
    const evt = WalletBalanceChanged.from({
      walletId: 'w-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      money: { amount: '25.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '75.00', currency: 'BRL' },
      walletVersion: 2,
      ctx,
    });
    // MoneyProps tem 'amount' como string
    expect(typeof evt.data.money.amount).toBe('string');
    expect(evt.data.money.amount).toBe('25.00');
    expect(typeof evt.data.balanceBefore.amount).toBe('string');
  });
});

describe('WagerTransactionProcessed', () => {
  it('carrega kind e status=PROCESSED', () => {
    const evt = WagerTransactionProcessed.from({
      transactionId: 'tx-1',
      providerId: 'p',
      externalTransactionId: 'ext-1',
      playerId: 'pl',
      walletId: 'w',
      roundId: 'r',
      gameId: 'g',
      kind: 'WIN',
      money: { amount: '50.00', currency: 'BRL' },
      referenceTransactionId: 'ref-tx-1',
      ctx,
    });
    expect(evt.data.kind).toBe('WIN');
    expect(evt.data.status).toBe('PROCESSED');
    expect(evt.data.referenceTransactionId).toBe('ref-tx-1');
  });
});

describe('WagerTransactionRejected', () => {
  it('carrega failureCode e status=REJECTED', () => {
    const evt = WagerTransactionRejected.from({
      transactionId: 'tx-1',
      providerId: 'p',
      externalTransactionId: 'ext-1',
      playerId: 'pl',
      walletId: 'w',
      roundId: 'r',
      gameId: 'g',
      kind: 'BET',
      failureCode: 'INSUFFICIENT_FUNDS',
      money: { amount: '100.00', currency: 'BRL' },
      ctx,
    });
    expect(evt.data.status).toBe('REJECTED');
    expect(evt.data.failureCode).toBe('INSUFFICIENT_FUNDS');
  });
});

describe('WagerTransactionPendingReference', () => {
  it('carrega referenceExternalTransactionId e kind=REFUND/ROLLBACK', () => {
    const evt = WagerTransactionPendingReference.from({
      transactionId: 'tx-1',
      providerId: 'p',
      externalTransactionId: 'ext-1',
      playerId: 'pl',
      walletId: 'w',
      roundId: 'r',
      gameId: 'g',
      kind: 'REFUND',
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: 'ref-123',
      ctx,
    });
    expect(evt.data.kind).toBe('REFUND');
    expect(evt.data.referenceExternalTransactionId).toBe('ref-123');
  });
});

describe('WalletBalanceChanged', () => {
  it('carrega direction, balanceBefore/After e walletVersion', () => {
    const evt = WalletBalanceChanged.from({
      walletId: 'w-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Credit,
      money: { amount: '50.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '150.00', currency: 'BRL' },
      walletVersion: 3,
      ctx,
    });
    expect(evt.data.direction).toBe(LedgerDirection.Credit);
    expect(evt.data.walletVersion).toBe(3);
    expect(evt.data.balanceAfter.amount).toBe('150.00');
  });

  it('aggregateId é o walletId', () => {
    const evt = WalletBalanceChanged.from({
      walletId: 'w-xyz',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      money: { amount: '25.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '75.00', currency: 'BRL' },
      walletVersion: 2,
      ctx,
    });
    expect(evt.aggregateId).toBe('w-xyz');
  });
});
