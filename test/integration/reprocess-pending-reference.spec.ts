import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { v4 as uuid } from 'uuid';
import { EntityManager } from '@mikro-orm/core';
import { FailureCode } from '../../src/shared/failure-codes';
import { setupTestDb, teardownTestDb, clearTables, freshEm, type TestDb } from './setup';
import { WalletRepository } from '../../src/wallet/persistence/wallet.repository';
import { WagerTransactionRepository } from '../../src/wagering/persistence/wager-transaction.repository';
import { WalletLedgerEntryRepository } from '../../src/ledger/persistence/wallet-ledger-entry.repository';
import { OutboxRepository } from '../../src/messaging/persistence/outbox.repository';
import { ReprocessPendingReferenceUseCase } from '../../src/wagering/application/reprocess-pending-reference.use-case';
import { WagerTransactionEntity } from '../../src/wagering/persistence/wager-transaction.entity';
import { OutboxMessageEntity } from '../../src/messaging/persistence/outbox-message.entity';
import { WalletEntity } from '../../src/wallet/persistence/wallet.entity';

async function persist(em: EntityManager, e: any) {
  await em.persist(e).flush();
  em.clear();
}

async function newWallet(em: EntityManager, amount: string): Promise<WalletEntity> {
  const w = new WalletEntity();
  w.id = uuid();
  w.playerId = uuid();
  w.currency = 'BRL';
  w.balanceAmount = amount;
  w.balanceCurrency = 'BRL';
  w.version = 1;
  w.createdAt = new Date();
  w.updatedAt = new Date();
  await em.persist(w).flush();
  em.clear();
  return w;
}

function newPendingRefundTx(walletId: string, playerId: string, refId: string, attempts: number): WagerTransactionEntity {
  const tx = new WagerTransactionEntity();
  tx.id = uuid();
  tx.providerId = 'provider-a';
  tx.externalTransactionId = uuid();
  tx.idempotencyKey = `provider-a:${tx.externalTransactionId}`;
  tx.payloadHash = 'h';
  tx.walletId = walletId;
  tx.playerId = playerId;
  tx.roundId = 'r';
  tx.gameId = 'g';
  tx.kind = 'REFUND';
  tx.moneyAmount = '25.00';
  tx.moneyCurrency = 'BRL';
  tx.referenceExternalTransactionId = refId;
  tx.createdAt = new Date();
  tx.status = 'PENDING_REFERENCE';
  tx.attempts = attempts;
  tx.nextAttemptAt = new Date(Date.now() - 60_000);
  return tx;
}

function newProcessedBetTx(walletId: string, playerId: string, extId: string): WagerTransactionEntity {
  const tx = new WagerTransactionEntity();
  tx.id = uuid();
  tx.providerId = 'provider-a';
  tx.externalTransactionId = extId;
  tx.idempotencyKey = `provider-a:${extId}`;
  tx.payloadHash = 'h-bet';
  tx.walletId = walletId;
  tx.playerId = playerId;
  tx.roundId = 'r1';
  tx.gameId = 'g1';
  tx.kind = 'BET';
  tx.moneyAmount = '25.00';
  tx.moneyCurrency = 'BRL';
  tx.createdAt = new Date();
  tx.status = 'PROCESSED';
  tx.processedAt = new Date();
  tx.attempts = 0;
  return tx;
}

function makeUseCase(em: EntityManager) {
  return new ReprocessPendingReferenceUseCase(
    em,
    new WalletRepository(em),
    new WagerTransactionRepository(em),
    new WalletLedgerEntryRepository(em),
    new OutboxRepository(em),
  );
}

describe('ReprocessPendingReferenceUseCase', () => {
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

  it('esgota tentativas → REJECTED com ReferenceResolutionExhausted', async () => {
    const wallet = await newWallet(em, '100.00');
    const refund = newPendingRefundTx(wallet.id, wallet.playerId, 'bet-that-never-comes', 10);
    await persist(em, refund);

    const useCase = makeUseCase(em);
    const result = await useCase.runOnce();
    expect(result).toEqual({ processed: 0, rejected: 1, skipped: 0 });

    const verifyEm = em.fork();
    const final = await new WagerTransactionRepository(verifyEm).findById(refund.id);
    expect(final?.status).toBe('REJECTED');
    expect(final?.failureCode).toBe(FailureCode.ReferenceResolutionExhausted);

    const outbox = await db.em.find(OutboxMessageEntity, {});
    const rejectedEvent = outbox.find((o) => o.eventType === 'WagerTransactionRejected');
    expect(rejectedEvent).toBeDefined();
  });

  it('REFUND antes da BET: pula e incrementa attempts; depois que BET chega, processa', async () => {
    const wallet = await newWallet(em, '75.00');
    const refund = newPendingRefundTx(wallet.id, wallet.playerId, 'bet-ext-1', 0);
    await persist(em, refund);

    const useCase = makeUseCase(em);
    const before = await useCase.runOnce();
    expect(before).toEqual({ processed: 0, rejected: 0, skipped: 1 });

    const verifyEm = em.fork();
    const pending = await new WagerTransactionRepository(verifyEm).findById(refund.id);
    expect(pending?.status).toBe('PENDING_REFERENCE');
    expect(pending?.attempts).toBe(1);

    em.clear();
    const bet = newProcessedBetTx(wallet.id, wallet.playerId, 'bet-ext-1');
    await persist(em, bet);

    em.clear();
    await em.getConnection().execute(
      `UPDATE wager_transactions SET next_attempt_at = ? WHERE id = ?::uuid`,
      [new Date(Date.now() - 60_000), refund.id],
    );
    em.clear();

    const after = await useCase.runOnce();
    expect(after).toEqual({ processed: 1, rejected: 0, skipped: 0 });

    const finalVerify = em.fork();
    const final = await new WagerTransactionRepository(finalVerify).findById(refund.id);
    expect(final?.status).toBe('PROCESSED');
    expect(final?.referenceTransactionId).toBe(bet.id);

    const finalWallet = await new WalletRepository(finalVerify).findById(wallet.id);
    expect(finalWallet?.balance.amount).toBe('100.00');

    const outbox = await db.em.find(OutboxMessageEntity, {});
    expect(outbox.some((o) => o.eventType === 'WagerTransactionProcessed')).toBe(true);
    expect(outbox.some((o) => o.eventType === 'WalletBalanceChanged')).toBe(true);
  });
});
