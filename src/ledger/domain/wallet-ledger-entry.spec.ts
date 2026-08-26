// src/ledger/domain/wallet-ledger-entry.spec.ts

import { describe, it, expect } from 'bun:test';
import { LedgerDirection } from '../../wagering/domain/wager-transaction';
import { WalletLedgerEntry, UnbalancedLedgerEntryError } from './wallet-ledger-entry';

const FIXED = new Date('2026-08-25T12:00:00.000Z');

describe('WalletLedgerEntry.create', () => {
  it('aceita DEBIT balanceado: balanceBefore - money === balanceAfter', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e-1',
      walletId: 'w-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      money: { amount: '25.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '75.00', currency: 'BRL' },
      now: FIXED,
    });
    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceAfter.amount).toBe('75.00');
  });

  it('aceita CREDIT balanceado: balanceBefore + money === balanceAfter', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e-1',
      walletId: 'w-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Credit,
      money: { amount: '50.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '150.00', currency: 'BRL' },
      now: FIXED,
    });
    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Credit);
  });

  it('aceita DEBIT que zera o saldo', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e-1',
      walletId: 'w-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      money: { amount: '100.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '0.00', currency: 'BRL' },
      now: FIXED,
    });
    expect(entry.isBalanced()).toBe(true);
  });

  it('rejeita DEBIT desbalanceado (after maior que esperado)', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'e-1',
        walletId: 'w-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: { amount: '25.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'BRL' },
        balanceAfter: { amount: '80.00', currency: 'BRL' }, // errado: deveria ser 75
        now: FIXED,
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it('rejeita DEBIT desbalanceado (after menor que esperado)', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'e-1',
        walletId: 'w-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: { amount: '25.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'BRL' },
        balanceAfter: { amount: '70.00', currency: 'BRL' }, // errado: deveria ser 75
        now: FIXED,
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it('rejeita CREDIT desbalanceado', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'e-1',
        walletId: 'w-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Credit,
        money: { amount: '50.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'BRL' },
        balanceAfter: { amount: '140.00', currency: 'BRL' }, // errado: deveria ser 150
        now: FIXED,
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it('rejeita moeda diferente entre money e balance', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'e-1',
        walletId: 'w-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: { amount: '25.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'USD' }, // moeda diferente
        balanceAfter: { amount: '75.00', currency: 'USD' },
        now: FIXED,
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it('preserva todos os campos no objeto criado', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e-1',
      walletId: 'w-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      money: { amount: '25.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '75.00', currency: 'BRL' },
      now: FIXED,
    });
    expect(entry.id).toBe('e-1');
    expect(entry.walletId).toBe('w-1');
    expect(entry.transactionId).toBe('tx-1');
    expect(entry.createdAt).toEqual(FIXED);
    expect(entry.money.amount).toBe('25.00');
    expect(entry.balanceBefore.amount).toBe('100.00');
    expect(entry.balanceAfter.amount).toBe('75.00');
  });
});

describe('WalletLedgerEntry.rehydrate', () => {
  it('reconstrói entry sem revalidar aritmética', () => {
    // Estado "desbalanceado" do banco — rehydrate aceita (é fato histórico)
    const entry = WalletLedgerEntry.rehydrate({
      id: 'e-1',
      walletId: 'w-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      money: { amount: '25.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '99.00', currency: 'BRL' }, // desbalanceado de propósito
      createdAt: FIXED,
    });
    expect(entry.balanceAfter.amount).toBe('99.00');
    expect(entry.isBalanced()).toBe(false); // ainda detecta o desbalanço via query
  });
});

describe('WalletLedgerEntry imutabilidade', () => {
  it('não expõe setters', () => {
    const entry = WalletLedgerEntry.create({
      id: 'e-1',
      walletId: 'w-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      money: { amount: '25.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '75.00', currency: 'BRL' },
      now: FIXED,
    });
    // @ts-expect-error — não existe setter
    entry.balance = 'hack';
  });
});
