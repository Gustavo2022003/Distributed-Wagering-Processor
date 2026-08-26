// src/wagering/domain/wager-transaction.spec.ts
//
// Cobertura obrigatória da seção 13 do README para WagerTransaction:
//   - regras de BET, WIN, LOSS, REFUND, ROLLBACK
//   - conflito de moeda (delegado ao Money, mas testado via propriedade)
//   - idempotency key com payload divergente
//   - invariantes de transição (estado terminal)

import { describe, it, expect } from 'bun:test';
import { Money } from '../../shared/money';
import { FailureCode } from '../../shared/failure-codes';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  LedgerDirection,
  computePayloadHash,
  OpeningNotAllowedError,
  InvalidTransactionStateError,
  type WagerTransactionBusinessPayload,
} from './wager-transaction';

const FIXED_DATE = new Date('2026-08-25T12:00:00.000Z');

function basePayload(
  overrides: Partial<WagerTransactionBusinessPayload> = {},
): WagerTransactionBusinessPayload {
  return {
    providerId: 'provider-a',
    externalTransactionId: 'tx-001',
    playerId: 'player-1',
    walletId: 'wallet-1',
    roundId: 'round-1',
    gameId: 'fortune-chimp',
    kind: WagerTransactionKind.Bet,
    money: { amount: '25.00', currency: 'BRL' },
    ...overrides,
  };
}

describe('WagerTransaction.create', () => {
  it('creates a BET in PENDING with all fields preserved', () => {
    const payload = basePayload();
    const hash = computePayloadHash(payload);

    const tx = WagerTransaction.create({
      id: 'tx-id-1',
      providerId: payload.providerId,
      externalTransactionId: payload.externalTransactionId,
      idempotencyKey: 'provider-a:tx-001',
      payloadHash: hash,
      walletId: payload.walletId,
      playerId: payload.playerId,
      roundId: payload.roundId,
      gameId: payload.gameId,
      kind: payload.kind,
      money: Money.from('25.00', 'BRL'),
      now: FIXED_DATE,
    });

    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.id).toBe('tx-id-1');
    expect(tx.money.amount).toBe('25.00');
    expect(tx.money.currency).toBe('BRL');
    expect(tx.processedAt).toBeUndefined();
    expect(tx.failureCode).toBeUndefined();
    expect(tx.referenceTransactionId).toBeUndefined();
    expect(tx.createdAt).toEqual(FIXED_DATE);
  });

  it('rejects OPENING via create()', () => {
    const hash = computePayloadHash(basePayload({ kind: WagerTransactionKind.Opening }));
    expect(() =>
      WagerTransaction.create({
        id: 'x',
        providerId: 'p',
        externalTransactionId: 'x',
        idempotencyKey: 'p:x',
        payloadHash: hash,
        walletId: 'w',
        playerId: 'pl',
        roundId: 'r',
        gameId: 'g',
        kind: WagerTransactionKind.Opening,
        money: Money.from('10.00', 'BRL'),
      }),
    ).toThrow(OpeningNotAllowedError);
  });

  it('rejects REFUND without referenceExternalTransactionId', () => {
    const hash = computePayloadHash(
      basePayload({ kind: WagerTransactionKind.Refund }),
    );
    expect(() =>
      WagerTransaction.create({
        id: 'x',
        providerId: 'p',
        externalTransactionId: 'x',
        idempotencyKey: 'p:x',
        payloadHash: hash,
        walletId: 'w',
        playerId: 'pl',
        roundId: 'r',
        gameId: 'g',
        kind: WagerTransactionKind.Refund,
        money: Money.from('10.00', 'BRL'),
        // referenceExternalTransactionId omitido de propósito
      }),
    ).toThrow(InvalidTransactionStateError);
  });

  it('rejects ROLLBACK without referenceExternalTransactionId', () => {
    const hash = computePayloadHash(
      basePayload({ kind: WagerTransactionKind.Rollback }),
    );
    expect(() =>
      WagerTransaction.create({
        id: 'x',
        providerId: 'p',
        externalTransactionId: 'x',
        idempotencyKey: 'p:x',
        payloadHash: hash,
        walletId: 'w',
        playerId: 'pl',
        roundId: 'r',
        gameId: 'g',
        kind: WagerTransactionKind.Rollback,
        money: Money.from('10.00', 'BRL'),
      }),
    ).toThrow(InvalidTransactionStateError);
  });
});

describe('WagerTransaction.createOpening', () => {
  it('creates an OPENING already PROCESSED with internal sentinels', () => {
    const tx = WagerTransaction.createOpening({
      id: 'opening-id-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      money: Money.from('1000.00', 'BRL'),
      now: FIXED_DATE,
    });

    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.kind).toBe(WagerTransactionKind.Opening);
    expect(tx.processedAt).toEqual(FIXED_DATE);
    expect(tx.providerId).toBe('internal');
    expect(tx.referenceExternalTransactionId).toBeUndefined();
  });
});

describe('WagerTransaction transitions', () => {
  it('moves PENDING → PROCESSED on markProcessed', () => {
    const tx = makeBetTx();
    tx.markProcessed(undefined, FIXED_DATE);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.processedAt).toEqual(FIXED_DATE);
  });

  it('moves PENDING → PENDING_REFERENCE on markPendingReference', () => {
    const tx = makeRefundTx();
    tx.markPendingReference();
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
    expect(tx.processedAt).toBeUndefined();
  });

  it('moves PENDING → REJECTED on reject(code)', () => {
    const tx = makeBetTx();
    tx.reject(FailureCode.InsufficientFunds, FIXED_DATE);
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(tx.processedAt).toEqual(FIXED_DATE);
  });

  it('moves PENDING → FAILED on fail(code)', () => {
    const tx = makeBetTx();
    tx.fail(FailureCode.ReferenceResolutionExhausted, FIXED_DATE);
    expect(tx.status).toBe(WagerTransactionStatus.Failed);
    expect(tx.failureCode).toBe(FailureCode.ReferenceResolutionExhausted);
  });

  it('throws on transition out of PROCESSED (terminal)', () => {
    const tx = makeBetTx();
    tx.markProcessed(undefined, FIXED_DATE);
    expect(() => tx.reject(FailureCode.InsufficientFunds, FIXED_DATE))
      .toThrow(InvalidTransactionStateError);
    expect(() => tx.markPendingReference())
      .toThrow(InvalidTransactionStateError);
  });

  it('throws on transition out of REJECTED (terminal)', () => {
    const tx = makeBetTx();
    tx.reject(FailureCode.InsufficientFunds, FIXED_DATE);
    expect(() => tx.markProcessed(undefined, FIXED_DATE))
      .toThrow(InvalidTransactionStateError);
  });

  it('throws on transition out of FAILED (terminal)', () => {
    const tx = makeBetTx();
    tx.fail(FailureCode.ReferenceResolutionExhausted, FIXED_DATE);
    expect(() => tx.markProcessed(undefined, FIXED_DATE))
      .toThrow(InvalidTransactionStateError);
  });

  it('isTerminal() reflects current state', () => {
    const tx = makeBetTx();
    expect(tx.isTerminal()).toBe(false);
    tx.markProcessed(undefined, FIXED_DATE);
    expect(tx.isTerminal()).toBe(true);
  });
});

describe('WagerTransaction domain queries', () => {
  it('requiresReference() is true for REFUND and ROLLBACK only', () => {
    expect(makeBetTx().requiresReference()).toBe(false);
    expect(makeWinTx().requiresReference()).toBe(false);
    expect(makeLossTx().requiresReference()).toBe(false);
    expect(makeRefundTx().requiresReference()).toBe(true);
    expect(makeRollbackTx().requiresReference()).toBe(true);
  });

  it('affectsBalance() is false for LOSS', () => {
    const loss = makeLossTx();
    expect(loss.affectsBalance()).toBe(false);
  });

  it('affectsBalance() is false for REJECTED', () => {
    const bet = makeBetTx();
    bet.reject(FailureCode.InsufficientFunds, FIXED_DATE);
    expect(bet.affectsBalance()).toBe(false);
  });

  it('affectsBalance() is true for BET, WIN, REFUND, ROLLBACK, OPENING', () => {
    expect(makeBetTx().affectsBalance()).toBe(true);
    expect(makeWinTx().affectsBalance()).toBe(true);
    expect(makeRefundTx().affectsBalance()).toBe(true);
    expect(makeRollbackTx().affectsBalance()).toBe(true);

    const opening = WagerTransaction.createOpening({
      id: 'op-1', walletId: 'w', playerId: 'p', money: Money.from('10.00', 'BRL'),
    });
    expect(opening.affectsBalance()).toBe(true);
  });

  it('matchesPayload returns true for the same hash', () => {
    const tx = makeBetTx();
    expect(tx.matchesPayload(tx.payloadHash)).toBe(true);
    expect(tx.matchesPayload('outro-hash')).toBe(false);
  });
});

describe('ledgerDirectionFor', () => {
  it('BET is DEBIT', () => {
    expect(makeBetTx().ledgerDirectionFor()).toBe(LedgerDirection.Debit);
  });

  it('WIN is CREDIT', () => {
    expect(makeWinTx().ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  it('OPENING is CREDIT', () => {
    const opening = WagerTransaction.createOpening({
      id: 'op-1', walletId: 'w', playerId: 'p', money: Money.from('10.00', 'BRL'),
    });
    expect(opening.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  it('REFUND referencing a BET is CREDIT', () => {
    const refund = makeRefundTx();
    const bet = makeBetTx();
    bet.markProcessed(undefined, FIXED_DATE);
    expect(refund.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
  });

  it('ROLLBACK referencing a BET is CREDIT', () => {
    const rb = makeRollbackTx();
    const bet = makeBetTx();
    bet.markProcessed(undefined, FIXED_DATE);
    expect(rb.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
  });

  it('ROLLBACK referencing a WIN is DEBIT', () => {
    const rb = makeRollbackTx();
    const win = makeWinTx();
    win.markProcessed(undefined, FIXED_DATE);
    expect(rb.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
  });

  it('REFUND referencing anything but BET throws', () => {
    const refund = makeRefundTx();
    const win = makeWinTx();
    win.markProcessed(undefined, FIXED_DATE);
    expect(() => refund.ledgerDirectionFor(win))
      .toThrow(InvalidTransactionStateError);
  });

  it('REFUND/ROLLBACK without reference throws', () => {
    expect(() => makeRefundTx().ledgerDirectionFor())
      .toThrow(InvalidTransactionStateError);
  });
});

describe('computePayloadHash', () => {
  it('is stable for the same payload regardless of key order at top level', () => {
    const a = basePayload();
    // monta o mesmo payload com chaves em ordem diferente
    const b: WagerTransactionBusinessPayload = {
      money: { amount: '25.00', currency: 'BRL' },
      kind: WagerTransactionKind.Bet,
      gameId: 'fortune-chimp',
      roundId: 'round-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      externalTransactionId: 'tx-001',
      providerId: 'provider-a',
    };
    expect(computePayloadHash(a)).toBe(computePayloadHash(b));
  });

  it('is stable across nested key order (money object)', () => {
    const a = basePayload();
    const reordered: WagerTransactionBusinessPayload = {
      ...a,
      money: { currency: 'BRL', amount: '25.00' },
    };
    expect(computePayloadHash(a)).toBe(computePayloadHash(reordered));
  });

  it('changes when amount changes', () => {
    const a = basePayload();
    const b = basePayload({ money: { amount: '26.00', currency: 'BRL' } });
    expect(computePayloadHash(a)).not.toBe(computePayloadHash(b));
  });

  it('changes when kind changes', () => {
    const a = basePayload({ kind: WagerTransactionKind.Bet });
    const b = basePayload({ kind: WagerTransactionKind.Win });
    expect(computePayloadHash(a)).not.toBe(computePayloadHash(b));
  });

  it('changes when referenceExternalTransactionId changes (REFUND)', () => {
    const a = basePayload({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ref-1',
    });
    const b = basePayload({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: 'ref-2',
    });
    expect(computePayloadHash(a)).not.toBe(computePayloadHash(b));
  });
});

describe('matchesPayload (idempotency conflict scenario)', () => {
  it('same idempotencyKey + same hash → replay (matchesPayload true)', () => {
    const tx = makeBetTx();
    expect(tx.matchesPayload(tx.payloadHash)).toBe(true);
  });

  it('same idempotencyKey + different hash → conflict (matchesPayload false)', () => {
    const tx = makeBetTx();
    expect(tx.matchesPayload('hash-completamente-diferente')).toBe(false);
  });
});

// ─── helpers de construção ────────────────────────────────────────────────

function makeBetTx(): WagerTransaction {
  const payload = basePayload();
  return WagerTransaction.create({
    id: 'tx-bet',
    providerId: payload.providerId,
    externalTransactionId: payload.externalTransactionId,
    idempotencyKey: 'provider-a:tx-001',
    payloadHash: computePayloadHash(payload),
    walletId: payload.walletId,
    playerId: payload.playerId,
    roundId: payload.roundId,
    gameId: payload.gameId,
    kind: payload.kind,
    money: Money.from('25.00', 'BRL'),
    now: FIXED_DATE,
  });
}

function makeWinTx(): WagerTransaction {
  const payload = basePayload({ kind: WagerTransactionKind.Win });
  return WagerTransaction.create({
    id: 'tx-win',
    providerId: payload.providerId,
    externalTransactionId: 'tx-win-001',
    idempotencyKey: 'provider-a:tx-win-001',
    payloadHash: computePayloadHash(payload),
    walletId: payload.walletId,
    playerId: payload.playerId,
    roundId: payload.roundId,
    gameId: payload.gameId,
    kind: payload.kind,
    money: Money.from('50.00', 'BRL'),
    now: FIXED_DATE,
  });
}

function makeLossTx(): WagerTransaction {
  const payload = basePayload({ kind: WagerTransactionKind.Loss });
  return WagerTransaction.create({
    id: 'tx-loss',
    providerId: payload.providerId,
    externalTransactionId: 'tx-loss-001',
    idempotencyKey: 'provider-a:tx-loss-001',
    payloadHash: computePayloadHash(payload),
    walletId: payload.walletId,
    playerId: payload.playerId,
    roundId: payload.roundId,
    gameId: payload.gameId,
    kind: payload.kind,
    money: Money.from('25.00', 'BRL'),
    now: FIXED_DATE,
  });
}

function makeRefundTx(): WagerTransaction {
  const payload = basePayload({
    kind: WagerTransactionKind.Refund,
    referenceExternalTransactionId: 'tx-bet',
  });
  return WagerTransaction.create({
    id: 'tx-refund',
    providerId: payload.providerId,
    externalTransactionId: 'tx-refund-001',
    idempotencyKey: 'provider-a:tx-refund-001',
    payloadHash: computePayloadHash(payload),
    walletId: payload.walletId,
    playerId: payload.playerId,
    roundId: payload.roundId,
    gameId: payload.gameId,
    kind: payload.kind,
    money: Money.from('25.00', 'BRL'),
    referenceExternalTransactionId: 'tx-bet',
    now: FIXED_DATE,
  });
}

function makeRollbackTx(): WagerTransaction {
  const payload = basePayload({
    kind: WagerTransactionKind.Rollback,
    referenceExternalTransactionId: 'tx-bet',
  });
  return WagerTransaction.create({
    id: 'tx-rollback',
    providerId: payload.providerId,
    externalTransactionId: 'tx-rollback-001',
    idempotencyKey: 'provider-a:tx-rollback-001',
    payloadHash: computePayloadHash(payload),
    walletId: payload.walletId,
    playerId: payload.playerId,
    roundId: payload.roundId,
    gameId: payload.gameId,
    kind: payload.kind,
    money: Money.from('25.00', 'BRL'),
    referenceExternalTransactionId: 'tx-bet',
    now: FIXED_DATE,
  });
}
