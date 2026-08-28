import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { v4 as uuid } from 'uuid';
import { EntityManager } from '@mikro-orm/core';
import { Money } from '../../src/shared/money';
import { setupTestDb, teardownTestDb, clearTables, freshEm, type TestDb } from './setup';
import { WalletRepository } from '../../src/wallet/persistence/wallet.repository';
import { WagerTransactionRepository } from '../../src/wagering/persistence/wager-transaction.repository';
import { WalletLedgerEntryRepository } from '../../src/ledger/persistence/wallet-ledger-entry.repository';
import { OutboxRepository } from '../../src/messaging/persistence/outbox.repository';
import { ProcessWagerTransactionUseCase, type ProcessWagerTransactionDto } from '../../src/wagering/application/process-wager-transaction.use-case';
import { WagerTransactionKind, WagerTransactionStatus } from '../../src/wagering/domain/wager-transaction';
import { FailureCode } from '../../src/shared/failure-codes';
import { WalletEntity } from '../../src/wallet/persistence/wallet.entity';
import { WalletLedgerEntryEntity } from '../../src/ledger/persistence/wallet-ledger-entry.entity';
import { WagerTransactionEntity } from '../../src/wagering/persistence/wager-transaction.entity';

describe('Cenário seção 8: duas bets simultâneas', () => {
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

  function makeUseCase(em: EntityManager) {
    const walletRepo = new WalletRepository(em);
    const wtxRepo = new WagerTransactionRepository(em);
    const ledgerRepo = new WalletLedgerEntryRepository(em);
    const outboxRepo = new OutboxRepository(em);
    return new ProcessWagerTransactionUseCase(em, walletRepo, wtxRepo, ledgerRepo, outboxRepo);
  }

  async function makeWalletWith100() {
    const setupEm = em.fork();
    const w = new WalletEntity();
    w.id = uuid();
    w.playerId = uuid();
    w.currency = 'BRL';
    w.balanceAmount = '100.00';
    w.balanceCurrency = 'BRL';
    w.version = 1;
    w.createdAt = new Date();
    w.updatedAt = new Date();
    await setupEm.persist(w).flush();
    return w;
  }

  function makeBetDto(walletId: string, playerId: string, externalId: string, amount = '80.00'): ProcessWagerTransactionDto {
    return {
      id: uuid(),
      providerId: 'provider-a',
      externalTransactionId: externalId,
      idempotencyKey: `provider-a:${externalId}`,
      payloadHash: 'h-' + externalId,
      playerId,
      walletId,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: { amount, currency: 'BRL' },
      correlationId: 'corr-' + externalId,
      now: new Date(),
    };
  }

  it('saldo 100, duas bets de 80 simultâneas → uma PROCESSED, uma REJECTED, saldo 20, 1 débito', async () => {
    const wallet = await makeWalletWith100();

    const [r1, r2] = await Promise.all([
      makeUseCase(em.fork()).execute(makeBetDto(wallet.id, wallet.playerId, 'tx-a')),
      makeUseCase(em.fork()).execute(makeBetDto(wallet.id, wallet.playerId, 'tx-b')),
    ]);

    const processed = [r1, r2].filter((r) => r.status === WagerTransactionStatus.Processed);
    const rejected = [r1, r2].filter((r) => r.status === WagerTransactionStatus.Rejected);
    expect(processed).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    if (rejected[0].status === WagerTransactionStatus.Rejected) {
      expect(rejected[0].failureCode).toBe(FailureCode.InsufficientFunds);
    }

    const verifyEm = em.fork();
    const finalWallet = await verifyEm.findOneOrFail(WalletEntity, { id: wallet.id });
    expect(finalWallet.balanceAmount).toBe('20.00');
    expect(finalWallet.version).toBe(2);

    const entries = await verifyEm.find(WalletLedgerEntryEntity, { walletId: wallet.id });
    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe('DEBIT');
    expect(entries[0].moneyAmount).toBe('80.00');
  });
});
