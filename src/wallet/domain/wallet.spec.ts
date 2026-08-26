import { describe, it, expect } from 'bun:test';
import { Money } from '../../shared/money';
import { LedgerDirection } from '../../wagering/domain/wager-transaction';
import {
  Wallet,
  CurrencyMismatchError,
  InsufficientFundsError,
  NegativeAmountError,
  ZeroAmountError,
  WalletClosedError,
} from './wallet';

const FIXED = new Date('2026-08-25T12:00:00.000Z');

function open(props: { initial?: string; currency?: string; now?: Date } = {}): Wallet {
  return Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: Money.from(props.initial ?? '100.00', props.currency ?? 'BRL'),
    now: props.now ?? FIXED,
  });
}

describe('Wallet.open', () => {
  it('cria wallet com saldo inicial, version=1, currency normalizada', () => {
    const w = open({ initial: '100.00' });
    expect(w.balance.amount).toBe('100.00');
    expect(w.balance.currency).toBe('BRL');
    expect(w.version).toBe(1);
    expect(w.playerId).toBe('player-1');
    expect(w.createdAt).toEqual(FIXED);
    expect(w.updatedAt).toEqual(FIXED);
    expect(w.isClosed()).toBe(false);
  });

  it('aceita saldo inicial zero (version ainda nasce em 1)', () => {
    const w = open({ initial: '0.00' });
    expect(w.balance.isZero()).toBe(true);
    expect(w.version).toBe(1);
  });

  it('rejeita saldo inicial negativo', () => {
    expect(() => open({ initial: '-10.00' })).toThrow(NegativeAmountError);
  });
});

describe('Wallet.debit', () => {
  it('reduz saldo e incrementa version', () => {
    const w = open({ initial: '100.00' });
    const plan = w.debit({
      money: Money.from('30.00', 'BRL'),
      transactionId: 'tx-1',
      entryId: 'entry-1',
      now: FIXED,
    });
    expect(w.balance.amount).toBe('70.00');
    expect(w.version).toBe(2);
    expect(w.updatedAt).toEqual(FIXED);
  });

  it('retorna MovementPlan com balanceBefore/After consistentes', () => {
    const w = open({ initial: '100.00' });
    const plan = w.debit({
      money: Money.from('30.00', 'BRL'),
      transactionId: 'tx-1',
      entryId: 'entry-1',
      now: FIXED,
    });
    expect(plan.balanceBefore.amount).toBe('100.00');
    expect(plan.balanceAfter.amount).toBe('70.00');
    expect(plan.money.amount).toBe('30.00');
    expect(plan.direction).toBe(LedgerDirection.Debit);
    expect(plan.newVersion).toBe(2);
  });

  it('rejeita débito maior que saldo', () => {
    const w = open({ initial: '50.00' });
    expect(() =>
      w.debit({
        money: Money.from('80.00', 'BRL'),
        transactionId: 'tx-1',
        entryId: 'entry-1',
      }),
    ).toThrow(InsufficientFundsError);
  });

  it('rejeita débito que zera saldo abaixo de zero (boundary)', () => {
    const w = open({ initial: '50.00' });
    expect(() =>
      w.debit({
        money: Money.from('50.01', 'BRL'),
        transactionId: 'tx-1',
        entryId: 'entry-1',
      }),
    ).toThrow(InsufficientFundsError);
  });

  it('permite débito igual ao saldo (resultado zero)', () => {
    const w = open({ initial: '50.00' });
    w.debit({
      money: Money.from('50.00', 'BRL'),
      transactionId: 'tx-1',
      entryId: 'entry-1',
    });
    expect(w.balance.isZero()).toBe(true);
    expect(w.version).toBe(2);
  });

  it('rejeita moeda diferente', () => {
    const w = open({ initial: '100.00' });
    expect(() =>
      w.debit({
        money: Money.from('10.00', 'USD'),
        transactionId: 'tx-1',
        entryId: 'entry-1',
      }),
    ).toThrow(CurrencyMismatchError);
  });

  it('rejeita valor zero', () => {
    const w = open({ initial: '100.00' });
    expect(() =>
      w.debit({
        money: Money.from('0.00', 'BRL'),
        transactionId: 'tx-1',
        entryId: 'entry-1',
      }),
    ).toThrow(ZeroAmountError);
  });

  it('rejeita valor negativo', () => {
    const w = open({ initial: '100.00' });
    expect(() =>
      w.debit({
        money: Money.from('-10.00', 'BRL'),
        transactionId: 'tx-1',
        entryId: 'entry-1',
      }),
    ).toThrow(NegativeAmountError);
  });
});

describe('Wallet.credit', () => {
  it('aumenta saldo e incrementa version', () => {
    const w = open({ initial: '100.00' });
    w.credit({
      money: Money.from('50.00', 'BRL'),
      transactionId: 'tx-1',
      entryId: 'entry-1',
    });
    expect(w.balance.amount).toBe('150.00');
    expect(w.version).toBe(2);
  });

  it('rejeita moeda diferente', () => {
    const w = open({ initial: '100.00' });
    expect(() =>
      w.credit({
        money: Money.from('10.00', 'USD'),
        transactionId: 'tx-1',
        entryId: 'entry-1',
      }),
    ).toThrow(CurrencyMismatchError);
  });

  it('rejeita valor zero', () => {
    const w = open({ initial: '100.00' });
    expect(() =>
      w.credit({
        money: Money.from('0.00', 'BRL'),
        transactionId: 'tx-1',
        entryId: 'entry-1',
      }),
    ).toThrow(ZeroAmountError);
  });
});

describe('Wallet version', () => {
  it('incrementa em CADA mudança de saldo, debit ou credit', () => {
    const w = open({ initial: '100.00' });
    expect(w.version).toBe(1);
    w.credit({ money: Money.from('10.00', 'BRL'), transactionId: 't1', entryId: 'e1' });
    expect(w.version).toBe(2);
    w.debit({ money: Money.from('5.00', 'BRL'), transactionId: 't2', entryId: 'e2' });
    expect(w.version).toBe(3);
    w.credit({ money: Money.from('20.00', 'BRL'), transactionId: 't3', entryId: 'e3' });
    expect(w.version).toBe(4);
  });

  it('NÃO incrementa em operações que falharam (sem efeito no saldo)', () => {
    const w = open({ initial: '100.00' });
    expect(w.version).toBe(1);
    try {
      w.debit({ money: Money.from('200.00', 'BRL'), transactionId: 't1', entryId: 'e1' });
    } catch {}
    expect(w.version).toBe(1);
    try {
      w.debit({ money: Money.from('10.00', 'USD'), transactionId: 't2', entryId: 'e2' });
    } catch {}
    expect(w.version).toBe(1);
  });
});

describe('Wallet.rehydrate', () => {
  it('reconstrói wallet com todos os campos preservados', () => {
    const past = new Date('2026-01-01T00:00:00.000Z');
    const updated = new Date('2026-08-01T00:00:00.000Z');
    const w = Wallet.rehydrate({
      id: 'w-1',
      playerId: 'p-1',
      currency: 'BRL',
      balance: { amount: '250.00', currency: 'BRL' },
      version: 5,
      createdAt: past,
      updatedAt: updated,
      closedAt: undefined,
    });
    expect(w.balance.amount).toBe('250.00');
    expect(w.version).toBe(5);
    expect(w.createdAt).toEqual(past);
    expect(w.updatedAt).toEqual(updated);
    expect(w.isClosed()).toBe(false);
  });

  it('preserva estado de fechada', () => {
    const closed = new Date('2026-07-01T00:00:00.000Z');
    const w = Wallet.rehydrate({
      id: 'w-1',
      playerId: 'p-1',
      currency: 'BRL',
      balance: { amount: '0.00', currency: 'BRL' },
      version: 3,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: closed,
      closedAt: closed,
    });
    expect(w.isClosed()).toBe(true);
    expect(() =>
      w.credit({ money: Money.from('10.00', 'BRL'), transactionId: 't1', entryId: 'e1' }),
    ).toThrow(WalletClosedError);
  });
});
