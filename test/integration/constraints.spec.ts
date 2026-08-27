// test/integration/constraints.spec.ts

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import { v4 as uuid } from 'uuid';
import { EntityManager } from '@mikro-orm/core';
import { setupTestDb, teardownTestDb, clearTables, freshEm, type TestDb } from './setup';
import { WalletEntity } from '../../src/wallet/persistence/wallet.entity';
import { WagerTransactionEntity } from '../../src/wagering/persistence/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../../src/ledger/persistence/wallet-ledger-entry.entity';
import { WagerTransactionKind, WagerTransactionStatus } from '../../src/wagering/domain/wager-transaction';

describe('Schema constraints', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    em = freshEm(db);
    await clearTables(db.em);
  });

  async function makeWallet(): Promise<WalletEntity> {
    const w = new WalletEntity();
    w.id = uuid();
    w.playerId = uuid();
    w.currency = 'BRL';
    w.balanceAmount = '100.00';
    w.balanceCurrency = 'BRL';
    w.version = 1;
    w.createdAt = new Date();
    w.updatedAt = new Date();
    await em.persist(w).flush();
    return w;
  }

  async function makeTx(w: WalletEntity): Promise<WagerTransactionEntity> {
    const tx = new WagerTransactionEntity();
    Object.assign(tx, {
      id: uuid(),
      providerId: 'p',
      externalTransactionId: 'ext-' + uuid(),
      idempotencyKey: 'p:' + uuid(),
      payloadHash: 'a'.repeat(64),
      walletId: w.id,
      playerId: w.playerId,
      roundId: 'r',
      gameId: 'g',
      kind: WagerTransactionKind.Bet,
      moneyAmount: '25.00',
      moneyCurrency: 'BRL',
      createdAt: new Date(),
      status: WagerTransactionStatus.Processed,
    });
    await em.persist(tx).flush();
    return tx;
  }

  it('CHECK rejeita saldo negativo em wallets', async () => {
    const w = new WalletEntity();
    w.id = uuid();
    w.playerId = uuid();
    w.currency = 'BRL';
    w.balanceAmount = '-10.00';
    w.balanceCurrency = 'BRL';
    w.version = 1;
    w.createdAt = new Date();
    w.updatedAt = new Date();
    await expect(em.persist(w).flush()).rejects.toThrow(/violates check constraint/i);
  });

  it('UNIQUE rejeita wallet duplicada para (player_id, currency)', async () => {
    const playerId = uuid();
    const baseProps = {
      currency: 'BRL',
      balanceAmount: '50.00',
      balanceCurrency: 'BRL',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const w1 = new WalletEntity();
    Object.assign(w1, { id: uuid(), playerId, ...baseProps });
    await em.persist(w1).flush();

    const w2 = new WalletEntity();
    Object.assign(w2, { id: uuid(), playerId, ...baseProps });
    await expect(em.persist(w2).flush()).rejects.toThrow(/duplicate key|unique constraint/i);
  });

  it('UNIQUE rejeita idempotency_key duplicada em wager_transactions', async () => {
    const w = await makeWallet();
    const key = 'provider-a:tx-123';
    const baseProps = {
      providerId: 'provider-a',
      externalTransactionId: 'tx-123',
      idempotencyKey: key,
      payloadHash: 'a'.repeat(64),
      walletId: w.id,
      playerId: w.playerId,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Bet,
      moneyAmount: '25.00',
      moneyCurrency: 'BRL',
      createdAt: new Date(),
      status: WagerTransactionStatus.Pending,
    };

    const tx1 = new WagerTransactionEntity();
    Object.assign(tx1, { id: uuid(), ...baseProps });
    await em.persist(tx1).flush();

    const tx2 = new WagerTransactionEntity();
    Object.assign(tx2, { id: uuid(), ...baseProps });
    await expect(em.persist(tx2).flush()).rejects.toThrow(/duplicate key|unique constraint/i);
  });

  it('CHECK rejeita kind inválido em wager_transactions', async () => {
    const w = await makeWallet();
    const tx = new WagerTransactionEntity();
    Object.assign(tx, {
      id: uuid(),
      providerId: 'p',
      externalTransactionId: 'e',
      idempotencyKey: 'p:e',
      payloadHash: 'a'.repeat(64),
      walletId: w.id,
      playerId: w.playerId,
      roundId: 'r',
      gameId: 'g',
      kind: 'INVALID_KIND',
      moneyAmount: '25.00',
      moneyCurrency: 'BRL',
      createdAt: new Date(),
      status: WagerTransactionStatus.Pending,
    });
    await expect(em.persist(tx).flush()).rejects.toThrow(/violates check constraint/i);
  });

  it('CHECK rejeita status inválido em wager_transactions', async () => {
    const w = await makeWallet();
    const tx = new WagerTransactionEntity();
    Object.assign(tx, {
      id: uuid(),
      providerId: 'p',
      externalTransactionId: 'e',
      idempotencyKey: 'p:e',
      payloadHash: 'a'.repeat(64),
      walletId: w.id,
      playerId: w.playerId,
      roundId: 'r',
      gameId: 'g',
      kind: WagerTransactionKind.Bet,
      moneyAmount: '25.00',
      moneyCurrency: 'BRL',
      createdAt: new Date(),
      status: 'INVALID_STATUS',
    });
    await expect(em.persist(tx).flush()).rejects.toThrow(/violates check constraint/i);
  });

  it('CHECK rejeita money_amount <= 0 em wager_transactions', async () => {
    const w = await makeWallet();
    const tx = new WagerTransactionEntity();
    Object.assign(tx, {
      id: uuid(),
      providerId: 'p',
      externalTransactionId: 'e',
      idempotencyKey: 'p:e',
      payloadHash: 'a'.repeat(64),
      walletId: w.id,
      playerId: w.playerId,
      roundId: 'r',
      gameId: 'g',
      kind: WagerTransactionKind.Bet,
      moneyAmount: '0.00',
      moneyCurrency: 'BRL',
      createdAt: new Date(),
      status: WagerTransactionStatus.Pending,
    });
    await expect(em.persist(tx).flush()).rejects.toThrow(/violates check constraint/i);
  });

  it('UNIQUE rejeita duas entries para o mesmo (transaction_id, wallet_id)', async () => {
    const w = await makeWallet();
    const tx = await makeTx(w);

    const e1 = new WalletLedgerEntryEntity();
    Object.assign(e1, {
      id: uuid(),
      walletId: w.id,
      transactionId: tx.id,
      direction: 'DEBIT',
      moneyAmount: '25.00',
      moneyCurrency: 'BRL',
      balanceBeforeAmount: '100.00',
      balanceBeforeCurrency: 'BRL',
      balanceAfterAmount: '75.00',
      balanceAfterCurrency: 'BRL',
      createdAt: new Date(),
    });
    await em.persist(e1).flush();

    const e2 = new WalletLedgerEntryEntity();
    Object.assign(e2, {
      id: uuid(),
      walletId: w.id,
      transactionId: tx.id,
      direction: 'CREDIT',
      moneyAmount: '5.00',
      moneyCurrency: 'BRL',
      balanceBeforeAmount: '75.00',
      balanceBeforeCurrency: 'BRL',
      balanceAfterAmount: '80.00',
      balanceAfterCurrency: 'BRL',
      createdAt: new Date(),
    });
    await expect(em.persist(e2).flush()).rejects.toThrow(/duplicate key|unique constraint/i);
  });

  it('REVOKE bloqueia UPDATE no wallet_ledger_entries', async () => {
    const w = await makeWallet();
    const tx = await makeTx(w);
    const entry = new WalletLedgerEntryEntity();
    Object.assign(entry, {
      id: uuid(),
      walletId: w.id,
      transactionId: tx.id,
      direction: 'DEBIT',
      moneyAmount: '25.00',
      moneyCurrency: 'BRL',
      balanceBeforeAmount: '100.00',
      balanceBeforeCurrency: 'BRL',
      balanceAfterAmount: '75.00',
      balanceAfterCurrency: 'BRL',
      createdAt: new Date(),
    });
    await em.persist(entry).flush();

    // Troca pro app_role e tenta UPDATE
    await em.execute(`SET ROLE app_role;`);
    try {
      await expect(
        em.execute(
          `UPDATE wallet_ledger_entries SET money_amount = '0.01' WHERE id = '${entry.id}'`,
        ),
      ).rejects.toThrow(/permission|denied/i);
    } finally {
      await em.execute(`RESET ROLE;`);
    }
  });

  it('REVOKE bloqueia DELETE no wallet_ledger_entries', async () => {
    const w = await makeWallet();
    const tx = await makeTx(w);
    const entry = new WalletLedgerEntryEntity();
    Object.assign(entry, {
      id: uuid(),
      walletId: w.id,
      transactionId: tx.id,
      direction: 'DEBIT',
      moneyAmount: '25.00',
      moneyCurrency: 'BRL',
      balanceBeforeAmount: '100.00',
      balanceBeforeCurrency: 'BRL',
      balanceAfterAmount: '75.00',
      balanceAfterCurrency: 'BRL',
      createdAt: new Date(),
    });
    await em.persist(entry).flush();

    await em.execute(`SET ROLE app_role;`);
    try {
      await expect(
        em.execute(`DELETE FROM wallet_ledger_entries WHERE id = '${entry.id}'`),
      ).rejects.toThrow(/permission|denied/i);
    } finally {
      await em.execute(`RESET ROLE;`);
    }
  });
});
