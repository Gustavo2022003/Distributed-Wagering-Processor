import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { setupTestDb, teardownTestDb, clearAll, type TestDb } from './setup';
import { v4 as uuid } from 'uuid';

describe('HTTP API (Nest + supertest)', () => {
  let db: TestDb;
  let app: INestApplication;
  let request: any;

  beforeAll(async () => {
    db = await setupTestDb();
    process.env.DATABASE_URL = db.container.getConnectionUri();
    process.env.AWS_ENDPOINT_URL = db.localstack.getConnectionUri();
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    process.env.WAGER_OUTBOX_QUEUE_URL = db.outboxQueueUrl;

    const { SQSClient, CreateQueueCommand } = await import('@aws-sdk/client-sqs');
    const sqs = new SQSClient({
      region: 'us-east-1',
      endpoint: db.localstack.getConnectionUri(),
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const consumerQueueUrl = (await sqs.send(
      new CreateQueueCommand({
        QueueName: 'wager-transactions-test.fifo',
        Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' },
      }),
    )).QueueUrl!;
    process.env.WAGER_CONSUMER_QUEUE_URL = consumerQueueUrl;

    const { AppModule } = await import('../../src/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    request = (await import('supertest')).default(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearAll(db);
  });

  const post = async (path: string, body?: any, headers?: Record<string, string>) => {
    const r = await request.post(path).set(headers ?? {}).send(body ?? {});
    return { status: r.status, body: r.body };
  };
  const get = async (path: string, headers?: Record<string, string>) => {
    const r = await request.get(path).set(headers ?? {});
    return { status: r.status, body: r.body };
  };

  it('GET /health/live retorna ok', async () => {
    const res = await get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/ready retorna ok', async () => {
    const res = await get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe('ok');
  });

  it('POST /wallets cria wallet + OPENING + ledger CREDIT', async () => {
    const res = await post('/wallets', {
      playerId: uuid(),
      currency: 'BRL',
      initialBalance: '100.00',
    });
    expect(res.status).toBe(201);
    expect(res.body.walletId).toBeDefined();
    expect(res.body.balance.amount).toBe('100.00');
    expect(res.body.openingTransactionId).toBeDefined();
  });

  it('POST /wallets duplicado retorna 409', async () => {
    const playerId = uuid();
    const r1 = await post('/wallets', { playerId, currency: 'BRL', initialBalance: '100.00' });
    expect(r1.status).toBe(201);
    const r2 = await post('/wallets', { playerId, currency: 'BRL', initialBalance: '50.00' });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('WALLET_ALREADY_EXISTS');
  });

  it('POST /wallets sem playerId retorna 400', async () => {
    const res = await post('/wallets', { currency: 'BRL', initialBalance: '100.00' });
    expect(res.status).toBe(400);
  });

  it('GET /wallets/:id retorna wallet', async () => {
    const created = await post('/wallets', { playerId: uuid(), currency: 'BRL', initialBalance: '100.00' });
    const res = await get(`/wallets/${created.body.walletId}`);
    expect(res.status).toBe(200);
    expect(res.body.walletId).toBe(created.body.walletId);
  });

  it('GET /wallets/:id inexistente retorna 404', async () => {
    const res = await get(`/wallets/${uuid()}`);
    expect(res.status).toBe(404);
  });

  it('GET /wallets/:id/ledger retorna entries + nextCursor', async () => {
    const created = await post('/wallets', { playerId: uuid(), currency: 'BRL', initialBalance: '100.00' });
    const res = await get(`/wallets/${created.body.walletId}/ledger`);
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBe(1);
    expect(res.body.nextCursor).toBeNull();
  });

  it('POST /wagering/transactions com Idempotency-Key processa', async () => {
    const w = await post('/wallets', { playerId: uuid(), currency: 'BRL', initialBalance: '100.00' });
    const res = await post('/wagering/transactions', {
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      playerId: w.body.walletId,
      walletId: w.body.walletId,
      roundId: 'r1',
      gameId: 'g1',
      kind: 'BET',
      money: { amount: '10.00', currency: 'BRL' },
    }, { 'Idempotency-Key': 'key-1' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSED');
    expect(res.body.balance.amount).toBe('90.00');
    expect(res.body.idempotentReplay).toBe(false);
  });

  it('POST /wagering/transactions sem Idempotency-Key retorna 400', async () => {
    const w = await post('/wallets', { playerId: uuid(), currency: 'BRL', initialBalance: '100.00' });
    const res = await post('/wagering/transactions', {
      providerId: 'provider-a',
      externalTransactionId: 'ext-2',
      playerId: w.body.walletId,
      walletId: w.body.walletId,
      roundId: 'r1',
      gameId: 'g1',
      kind: 'BET',
      money: { amount: '10.00', currency: 'BRL' },
    });
    expect(res.status).toBe(400);
  });

  it('POST /wagering/transactions com mesmo Idempotency-Key + payload igual faz replay', async () => {
    const w = await post('/wallets', { playerId: uuid(), currency: 'BRL', initialBalance: '100.00' });
    const body = {
      providerId: 'provider-a',
      externalTransactionId: 'ext-3',
      playerId: w.body.walletId,
      walletId: w.body.walletId,
      roundId: 'r1',
      gameId: 'g1',
      kind: 'BET',
      money: { amount: '10.00', currency: 'BRL' },
    };
    const r1 = await post('/wagering/transactions', body, { 'Idempotency-Key': 'key-replay' });
    expect(r1.body.status).toBe('PROCESSED');
    const r2 = await post('/wagering/transactions', body, { 'Idempotency-Key': 'key-replay' });
    expect(r2.body.status).toBe('PROCESSED');
    expect(r2.body.idempotentReplay).toBe(true);
    const wAfter = await get(`/wallets/${w.body.walletId}`);
    expect(wAfter.body.balance.amount).toBe('90.00');
  });

  it('POST /wagering/transactions rejeita BET sem saldo (regra de negócio → 409)', async () => {
    const w = await post('/wallets', { playerId: uuid(), currency: 'BRL', initialBalance: '5.00' });
    const res = await post('/wagering/transactions', {
      providerId: 'provider-a',
      externalTransactionId: 'ext-4',
      playerId: w.body.walletId,
      walletId: w.body.walletId,
      roundId: 'r1',
      gameId: 'g1',
      kind: 'BET',
      money: { amount: '50.00', currency: 'BRL' },
    }, { 'Idempotency-Key': 'key-4' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(res.body.failureCode).toBe('INSUFFICIENT_FUNDS');
  });

  it('GET /wagering/transactions/:id retorna transação', async () => {
    const w = await post('/wallets', { playerId: uuid(), currency: 'BRL', initialBalance: '100.00' });
    const created = await post('/wagering/transactions', {
      providerId: 'provider-a',
      externalTransactionId: 'ext-5',
      playerId: w.body.walletId,
      walletId: w.body.walletId,
      roundId: 'r1',
      gameId: 'g1',
      kind: 'BET',
      money: { amount: '10.00', currency: 'BRL' },
    }, { 'Idempotency-Key': 'key-5' });
    const res = await get(`/wagering/transactions/${created.body.transactionId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSED');
  });

  it('GET /providers/:pid/transactions/:extId retorna transação', async () => {
    const w = await post('/wallets', { playerId: uuid(), currency: 'BRL', initialBalance: '100.00' });
    await post('/wagering/transactions', {
      providerId: 'provider-a',
      externalTransactionId: 'ext-6',
      playerId: w.body.walletId,
      walletId: w.body.walletId,
      roundId: 'r1',
      gameId: 'g1',
      kind: 'BET',
      money: { amount: '10.00', currency: 'BRL' },
    }, { 'Idempotency-Key': 'key-6' });
    const res = await get('/wagering/providers/provider-a/transactions/ext-6');
    expect(res.status).toBe(200);
    expect(res.body.externalTransactionId).toBe('ext-6');
  });

  it('POST /wallets/:id/reconciliation retorna consistent=true para wallet válida', async () => {
    const w = await post('/wallets', { playerId: uuid(), currency: 'BRL', initialBalance: '100.00' });
    const res = await post(`/wallets/${w.body.walletId}/reconciliation`, {});
    expect(res.status).toBe(201);
    expect(res.body.consistent).toBe(true);
    expect(res.body.storedBalance.amount).toBe('100.00');
    expect(res.body.entriesChecked).toBe(1);
  });
});
