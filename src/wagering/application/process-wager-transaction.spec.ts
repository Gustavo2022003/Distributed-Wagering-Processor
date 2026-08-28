import { describe, it, expect } from 'bun:test';
import { Money } from '../../shared/money';
import { FailureCode } from '../../shared/failure-codes';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  PayloadConflictError,
} from '../domain/wager-transaction';
import { Wallet } from '../../wallet/domain/wallet';
import { WalletNotFoundError } from '../../shared/errors/domain-errors';
import { ProcessWagerTransactionUseCase, type ProcessWagerTransactionDto } from './process-wager-transaction.use-case';

class FakeEm {
  async transactional<T>(fn: () => Promise<T>): Promise<T> {
    return await fn();
  }
  async flush() {}
}

class FakeWalletRepo {
  wallets = new Map<string, Wallet>();
  nextUpdateOk = true;

  async findById(id: string) {
    return this.wallets.get(id) ?? null;
  }
  async insert(w: Wallet) {
    this.wallets.set(w.id, w);
  }
  async updateWithCondition(props: {
    id: string;
    expectedVersion: number;
    newBalanceAmount: string;
    newBalanceCurrency: string;
    newUpdatedAt: Date;
    debitGuard?: string;
  }): Promise<boolean> {
    if (!this.nextUpdateOk) return false;
    const w = this.wallets.get(props.id);
    if (!w || w.version !== props.expectedVersion) return false;
    if (props.debitGuard && Number(w.balance.amount) < Number(props.debitGuard)) return false;
    const newBalance = Money.from(props.newBalanceAmount, props.newBalanceCurrency);
    const newW = Wallet.rehydrate({
      id: w.id,
      playerId: w.playerId,
      currency: w.currency,
      balance: { amount: newBalance.amount, currency: newBalance.currency },
      version: props.expectedVersion + 1,
      createdAt: w.createdAt,
      updatedAt: props.newUpdatedAt,
      closedAt: undefined,
    });
    this.wallets.set(w.id, newW);
    return true;
  }
}

class FakeWtxRepo {
  byIdempotencyKey = new Map<string, any>();
  byProviderExternal = new Map<string, any>();
  byExistingReversal = new Map<string, any>();
  byId = new Map<string, any>();

  async findById(id: string) {
    return this.byId.get(id) ?? null;
  }
  async findByIdempotencyKey(key: string) {
    return this.byIdempotencyKey.get(key) ?? null;
  }
  async findByProviderExternalId(providerId: string, externalId: string) {
    return this.byProviderExternal.get(`${providerId}:${externalId}`) ?? null;
  }
  async findExistingReversal(providerId: string, refExtId: string, kind: WagerTransactionKind) {
    return this.byExistingReversal.get(`${providerId}:${refExtId}:${kind}`) ?? null;
  }
  async insert(tx: any) {
    this.byIdempotencyKey.set(tx.idempotencyKey, tx);
    this.byProviderExternal.set(`${tx.providerId}:${tx.externalTransactionId}`, tx);
    this.byId.set(tx.id, tx);
  }
  async update(tx: any) {
    this.byId.set(tx.id, tx);
    this.byIdempotencyKey.set(tx.idempotencyKey, tx);
  }
}

class FakeLedgerRepo {
  inserted: any[] = [];
  async insert(e: any) { this.inserted.push(e); }
}

class FakeOutboxRepo {
  enqueued: any[] = [];
  async enqueue(e: any) {
    const flat = e.payload ? { ...e, ...e.payload } : e;
    this.enqueued.push(flat);
  }
}

const NOW = new Date('2026-08-25T12:00:00.000Z');

function makeUseCase() {
  const em = new FakeEm() as any;
  const walletRepo = new FakeWalletRepo() as any;
  const wtxRepo = new FakeWtxRepo() as any;
  const ledgerRepo = new FakeLedgerRepo() as any;
  const outboxRepo = new FakeOutboxRepo() as any;
  const useCase = new ProcessWagerTransactionUseCase(em, walletRepo, wtxRepo, ledgerRepo, outboxRepo);
  return { useCase, walletRepo, wtxRepo, ledgerRepo, outboxRepo };
}

async function makeWalletWithBalance(amount: string, currency = 'BRL'): Promise<Wallet> {
  return Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: Money.from(amount, currency),
    now: NOW,
  });
}

function makeRefTx(
  status: WagerTransactionStatus,
  kind: WagerTransactionKind,
  amount: string,
): any {
  const tx = WagerTransaction.create({
    id: 'ref-tx',
    providerId: 'provider-a',
    externalTransactionId: 'ref-ext',
    idempotencyKey: 'provider-a:ref-ext',
    payloadHash: 'h',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'r',
    gameId: 'g',
    kind,
    money: Money.from(amount, 'BRL'),
    referenceExternalTransactionId:
      kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback
        ? 'dummy-ref'
        : undefined,
    now: NOW,
  });
  (tx as any)._status = status;
  return tx;
}

function baseDto(overrides: Partial<ProcessWagerTransactionDto> = {}): ProcessWagerTransactionDto {
  return {
    id: 'tx-1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'provider-a:ext-1',
    payloadHash: 'hash-1',
    playerId: 'player-1',
    walletId: 'wallet-1',
    roundId: 'round-1',
    gameId: 'fortune-chimp',
    kind: WagerTransactionKind.Bet,
    money: { amount: '25.00', currency: 'BRL' },
    correlationId: 'corr-1',
    now: NOW,
    ...overrides,
  };
}

describe('ProcessWagerTransactionUseCase', () => {
  describe('BET', () => {
    it('PROCESSED com saldo suficiente: debit + ledger + 2 eventos', async () => {
      const { useCase, walletRepo, ledgerRepo, outboxRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('100.00'));

      const result = await useCase.execute(baseDto({ kind: WagerTransactionKind.Bet }));

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      if (result.status === WagerTransactionStatus.Processed) {
        expect(result.idempotentReplay).toBe(false);
        expect(result.balance?.amount).toBe('75.00');
      }
      expect(ledgerRepo.inserted).toHaveLength(1);
      expect(outboxRepo.enqueued).toHaveLength(2);
    });

    it('REJECTED com INSUFFICIENT_FUNDS: sem ledger, 1 evento Rejected', async () => {
      const { useCase, walletRepo, ledgerRepo, outboxRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('10.00'));

      const result = await useCase.execute(baseDto({ kind: WagerTransactionKind.Bet }));

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      if (result.status === WagerTransactionStatus.Rejected) {
        expect(result.failureCode).toBe(FailureCode.InsufficientFunds);
      }
      expect(ledgerRepo.inserted).toHaveLength(0);
      expect(outboxRepo.enqueued).toHaveLength(1);
      expect(outboxRepo.enqueued[0].eventType).toBe('WagerTransactionRejected');
    });

    it('REJECTED quando update atômico falha (concorrência)', async () => {
      const { useCase, walletRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('100.00'));
      walletRepo.nextUpdateOk = false;

      const result = await useCase.execute(baseDto({ kind: WagerTransactionKind.Bet }));

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      if (result.status === WagerTransactionStatus.Rejected) {
        expect(result.failureCode).toBe(FailureCode.InsufficientFunds);
      }
    });
  });

  describe('LOSS', () => {
    it('PROCESSED sem mexer em saldo, sem ledger, 1 evento Processed', async () => {
      const { useCase, walletRepo, ledgerRepo, outboxRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('100.00'));

      const result = await useCase.execute(baseDto({ kind: WagerTransactionKind.Loss }));

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(ledgerRepo.inserted).toHaveLength(0);
      expect(outboxRepo.enqueued).toHaveLength(1);
      expect(outboxRepo.enqueued[0].eventType).toBe('WagerTransactionProcessed');
      const finalWallet = walletRepo.wallets.get('wallet-1')!;
      expect(finalWallet.balance.amount).toBe('100.00');
    });
  });

  describe('WIN', () => {
    it('PROCESSED creditando saldo, com ledger, 2 eventos', async () => {
      const { useCase, walletRepo, ledgerRepo, outboxRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('100.00'));

      const result = await useCase.execute(
        baseDto({ kind: WagerTransactionKind.Win, money: { amount: '50.00', currency: 'BRL' } }),
      );

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      if (result.status === WagerTransactionStatus.Processed) {
        expect(result.balance?.amount).toBe('150.00');
      }
      expect(ledgerRepo.inserted).toHaveLength(1);
      expect(outboxRepo.enqueued).toHaveLength(2);
    });
  });

  describe('REFUND', () => {
    it('PENDING_REFERENCE quando referência não existe', async () => {
      const { useCase, walletRepo, outboxRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('100.00'));

      const result = await useCase.execute(
        baseDto({
          kind: WagerTransactionKind.Refund,
          money: { amount: '25.00', currency: 'BRL' },
          referenceExternalTransactionId: 'bet-ext-1',
        }),
      );

      expect(result.status).toBe(WagerTransactionStatus.PendingReference);
      expect(outboxRepo.enqueued).toHaveLength(1);
      expect(outboxRepo.enqueued[0].eventType).toBe('WagerTransactionPendingReference');
    });

    it('REJECTED com ReferenceNotProcessed quando referência não é PROCESSED', async () => {
      const { useCase, walletRepo, wtxRepo } = makeUseCase();
      const wallet = await makeWalletWithBalance('100.00');
      walletRepo.wallets.set(wallet.id, wallet);
      wtxRepo.byProviderExternal.set(
        'provider-a:bet-ext-1',
        makeRefTx(WagerTransactionStatus.Pending, WagerTransactionKind.Bet, '25.00'),
      );

      const result = await useCase.execute(
        baseDto({
          kind: WagerTransactionKind.Refund,
          money: { amount: '25.00', currency: 'BRL' },
          referenceExternalTransactionId: 'bet-ext-1',
        }),
      );

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      if (result.status === WagerTransactionStatus.Rejected) {
        expect(result.failureCode).toBe(FailureCode.ReferenceNotProcessed);
      }
    });

    it('REJECTED com ReferenceMismatch quando REFUND referencia WIN', async () => {
      const { useCase, walletRepo, wtxRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('100.00'));
      wtxRepo.byProviderExternal.set(
        'provider-a:win-ext-1',
        makeRefTx(WagerTransactionStatus.Processed, WagerTransactionKind.Win, '50.00'),
      );

      const result = await useCase.execute(
        baseDto({
          kind: WagerTransactionKind.Refund,
          money: { amount: '50.00', currency: 'BRL' },
          referenceExternalTransactionId: 'win-ext-1',
        }),
      );

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      if (result.status === WagerTransactionStatus.Rejected) {
        expect(result.failureCode).toBe(FailureCode.ReferenceMismatch);
      }
    });

    it('REJECTED com ReferenceAlreadyReversed quando já existe reversão', async () => {
      const { useCase, walletRepo, wtxRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('100.00'));
      wtxRepo.byProviderExternal.set(
        'provider-a:bet-ext-1',
        makeRefTx(WagerTransactionStatus.Processed, WagerTransactionKind.Bet, '25.00'),
      );
      wtxRepo.byExistingReversal.set(
        'provider-a:bet-ext-1:REFUND',
        makeRefTx(WagerTransactionStatus.Processed, WagerTransactionKind.Refund, '25.00'),
      );

      const result = await useCase.execute(
        baseDto({
          kind: WagerTransactionKind.Refund,
          money: { amount: '25.00', currency: 'BRL' },
          referenceExternalTransactionId: 'bet-ext-1',
        }),
      );

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      if (result.status === WagerTransactionStatus.Rejected) {
        expect(result.failureCode).toBe(FailureCode.ReferenceAlreadyReversed);
      }
    });

    it('PROCESSED quando referência BET PROCESSED e saldo suficiente', async () => {
      const { useCase, walletRepo, wtxRepo, ledgerRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('75.00'));
      wtxRepo.byProviderExternal.set(
        'provider-a:bet-ext-1',
        makeRefTx(WagerTransactionStatus.Processed, WagerTransactionKind.Bet, '25.00'),
      );

      const result = await useCase.execute(
        baseDto({
          kind: WagerTransactionKind.Refund,
          money: { amount: '25.00', currency: 'BRL' },
          referenceExternalTransactionId: 'bet-ext-1',
        }),
      );

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      if (result.status === WagerTransactionStatus.Processed) {
        expect(result.balance?.amount).toBe('100.00');
      }
      expect(ledgerRepo.inserted).toHaveLength(1);
    });
  });

  describe('ROLLBACK', () => {
    it('REJECTED com NegativeBalanceOnReversal quando reverter WIN deixaria saldo negativo', async () => {
      const { useCase, walletRepo, wtxRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('30.00'));
      wtxRepo.byProviderExternal.set(
        'provider-a:win-ext-1',
        makeRefTx(WagerTransactionStatus.Processed, WagerTransactionKind.Win, '50.00'),
      );

      const result = await useCase.execute(
        baseDto({
          kind: WagerTransactionKind.Rollback,
          money: { amount: '50.00', currency: 'BRL' },
          referenceExternalTransactionId: 'win-ext-1',
        }),
      );

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      if (result.status === WagerTransactionStatus.Rejected) {
        expect(result.failureCode).toBe(FailureCode.NegativeBalanceOnReversal);
      }
    });
  });

  describe('Idempotência', () => {
    it('replay: mesma idempotencyKey + mesmo hash → retorna o resultado original', async () => {
      const { useCase, walletRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('100.00'));

      const r1 = await useCase.execute(baseDto());
      expect(r1.status).toBe(WagerTransactionStatus.Processed);
      if (r1.status === WagerTransactionStatus.Processed) {
        expect(r1.idempotentReplay).toBe(false);
      }

      const r2 = await useCase.execute(baseDto());
      expect(r2.status).toBe(WagerTransactionStatus.Processed);
      if (r2.status === WagerTransactionStatus.Processed) {
        expect(r2.idempotentReplay).toBe(true);
      }
    });

    it('conflito: mesma idempotencyKey + hash diferente → PAYLOAD_CONFLICT', async () => {
      const { useCase, walletRepo } = makeUseCase();
      walletRepo.wallets.set('wallet-1', await makeWalletWithBalance('100.00'));

      await useCase.execute(baseDto());

      await expect(
        useCase.execute(baseDto({ payloadHash: 'hash-diferente' })),
      ).rejects.toThrow(PayloadConflictError);
    });
  });

  describe('Validações de entrada', () => {
    it('Wallet não encontrada → WalletNotFoundError', async () => {
      const { useCase } = makeUseCase();

      await expect(useCase.execute(baseDto())).rejects.toThrow(WalletNotFoundError);
    });
  });
});
