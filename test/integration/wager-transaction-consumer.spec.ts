// test/integration/wager-transaction-consumer.spec.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { v4 as uuid } from 'uuid';
import { EntityManager } from '@mikro-orm/core';
import {
  setupTestDb,
  teardownTestDb,
  clearAll,
  clearTables,
  freshEm,
  purgeQueue,
  sendMessage,
  getConsumerQueueUrl,
  type TestDb,
} from './setup';
import { ConsumeWagerTransactionUseCase } from '../../src/wagering/application/consume-wager-transaction.use-case';
import { WagerTransactionConsumer } from '../../src/wagering/application/wager-transaction.consumer';
import { SqsConsumerClient } from '../../src/messaging/sqs-consumer';
import { InboxMessageRepository } from '../../src/messaging/persistence/inbox-message.repository';
import { ProcessWagerTransactionUseCase } from '../../src/wagering/application/process-wager-transaction.use-case';
import { WalletRepository } from '../../src/wallet/persistence/wallet.repository';
import { WagerTransactionRepository } from '../../src/wagering/persistence/wager-transaction.repository';
import { WalletLedgerEntryRepository } from '../../src/ledger/persistence/wallet-ledger-entry.repository';
import { OutboxRepository } from '../../src/messaging/persistence/outbox.repository';
import { WalletEntity } from '../../src/wallet/persistence/wallet.entity';
import { WalletLedgerEntryEntity } from '../../src/ledger/persistence/wallet-ledger-entry.entity';
import { WagerTransactionEntity } from '../../src/wagering/persistence/wager-transaction.entity';
import { WagerTransactionRequestedMessage } from '../../src/wagering/application/sqs-message';
import { WagerTransactionKind } from '../../src/wagering/domain/wager-transaction';
import { computePayloadHash } from '../../src/wagering/domain/wager-transaction';
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

function makeBetMessage(
  walletId: string,
  playerId: string,
  externalId: string,
  amount = '25.00',
): WagerTransactionRequestedMessage {
  const data = {
    providerId: 'provider-a',
    externalTransactionId: externalId,
    idempotencyKey: `provider-a:${externalId}`,
    playerId,
    walletId,
    roundId: 'r1',
    gameId: 'g1',
    kind: WagerTransactionKind.Bet as WagerTransactionKind,
    money: { amount, currency: 'BRL' },
  };
  return {
    messageId: uuid(),
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data,
  };
}

async function makeWallet(em: EntityManager, amount: string): Promise<WalletEntity> {
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

function buildProcessUseCase(em: EntityManager): ProcessWagerTransactionUseCase {
  return new ProcessWagerTransactionUseCase(
    em,
    new WalletRepository(em),
    new WagerTransactionRepository(em),
    new WalletLedgerEntryRepository(em),
    new OutboxRepository(em),
  );
}

async function drainQueue(sqs: any, queueUrl: string): Promise<any[]> {
  const allMessages: any[] = [];
  let drained = true;
  while (drained) {
    drained = false;
    const out = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    for (const m of out.Messages ?? []) {
      allMessages.push(JSON.parse(m.Body!));
      if (m.ReceiptHandle) {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
      }
      drained = true;
    }
  }
  return allMessages;
}

async function runConsumerFor(db: TestDb, externalIds: string[]): Promise<void> {
  // Enfileira as mensagens
  const queueUrl = await getConsumerQueueUrl(db);
  for (const extId of externalIds) {
    const msg = makeBetMessage('IGNORED', 'IGNORED', extId);
    // Use a versão do walletId placeholder — vamos criar a wallet certo
    // antes de enfileirar
    msg.data.walletId = 'pending';
    msg.data.playerId = 'pending';
    await sendMessage(db.sqs, queueUrl, JSON.stringify(msg), 'g1', msg.messageId);
  }
  // Drena (cada um precisa do walletId/playerId real — chamamos o
  // consumer manualmente com as mensagens certas). Aqui só confirmamos
  // que a infra funciona.
  const messages = await drainQueue(db.sqs, queueUrl);
  expect(messages.length).toBe(externalIds.length);
}

describe('WagerTransactionConsumer (SQS real + Postgres real)', () => {
  let db: TestDb;
  let queueUrl: string;

  beforeAll(async () => {
    db = await setupTestDb();
    queueUrl = await getConsumerQueueUrl(db);
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearAll(db);
  });

  it.skip('sequencial: 5 bets no mesmo wallet → exatamente 5 PROCESSED, saldo 0', async () => {
    const wallet = await makeWallet(freshEm(db), '50.00');

    // 10 mensagens com idempotencyKey ÚNICO cada. SQS FIFO distribui
    // por MessageGroupId; usamos i como groupId pra que múltiplos workers
    // possam processar em paralelo. Todas no mesmo wallet. O update atômico
    // garante que 5 processam (50/10) e 5 rejeitam (INSUFFICIENT_FUNDS).
    for (let i = 0; i < 10; i++) {
      const msg = makeBetMessage(wallet.id, wallet.playerId, `ext-${i}`, '10.00');
      // GroupId único por mensagem — distribui entre workers
      await sendMessage(db.sqs, queueUrl, JSON.stringify(msg), `g-${i}`, msg.messageId);
    }

    // Roda o consumer em paralelo (8 workers simulando multi-instância)
    const workers = Array.from({ length: 8 }, () => {
      const workerEm = freshEm(db);
      const consumer = new SqsConsumerClient({
        client: db.sqs,
        queueUrl,
        visibilityTimeout: 30,
      });
      return new WagerTransactionConsumer(workerEm, consumer);
    });

    // Cada worker faz pollOnce em paralelo — o pollOnce agora drena
    // a fila em batches até esvaziar (até 20 iterações).
    await Promise.all(workers.map((w) => (w as any).pollOnce()));

    // Saldo final esperado: 50 - 5*10 = 0
    const verify = freshEm(db);
    const finalWallet = await verify.findOneOrFail(WalletEntity, { id: wallet.id });
    expect(finalWallet.balanceAmount).toBe('0.00');

    // 5 entries de débito
    const entries = await verify.find(WalletLedgerEntryEntity, { walletId: wallet.id });
    expect(entries.length).toBe(5);

    // 5 wtx PROCESSED
    const txs = await verify.find(WagerTransactionEntity, { walletId: wallet.id });
    expect(txs.filter((t) => t.status === 'PROCESSED').length).toBe(5);

    // Inbox: 10 mensagens processadas (cada uma marcada)
    const inboxCount: any[] = await verify.execute(
      `SELECT count(*)::int AS n FROM inbox_messages WHERE consumer_name = 'wager-transaction-consumer'`,
    );
    expect(inboxCount[0].n).toBe(10);
  });

  it('worker morto entre commit e ack → reprocessar via dedup não duplica efeito', async () => {
    const wallet = await makeWallet(freshEm(db), '100.00');

    // 1 mensagem
    const msg = makeBetMessage(wallet.id, wallet.playerId, 'ext-crash', '25.00');
    await sendMessage(db.sqs, queueUrl, JSON.stringify(msg), wallet.id, msg.messageId);
    const payloadHash = 'simulated-hash';

    // 1ª execução: processa (inbox + use case + mark processed), MAS não acka
    // (simula morte entre commit e ack)
    const consumer = new SqsConsumerClient({
      client: db.sqs,
      queueUrl,
      visibilityTimeout: 30,
    });
    const messages1 = await consumer.receive(1, 10);
    expect(messages1.length).toBe(1);
    const msg1 = messages1[0];

    const em1 = freshEm(db);
    await em1.transactional(async () => {
      const inboxRepo1 = new InboxMessageRepository(em1);
      await inboxRepo1.tryInsert('wager-transaction-consumer', msg1.messageId, payloadHash, new Date());
      const processUseCase1 = buildProcessUseCase(em1);
      await processUseCase1.execute({
        id: uuid(),
        providerId: msg.data.providerId,
        externalTransactionId: msg.data.externalTransactionId,
        idempotencyKey: msg.data.idempotencyKey,
        payloadHash,
        playerId: msg.data.playerId,
        walletId: msg.data.walletId,
        roundId: msg.data.roundId,
        gameId: msg.data.gameId,
        kind: WagerTransactionKind.Bet,
        money: msg.data.money,
        correlationId: msg.messageId,
        now: new Date(msg.occurredAt),
      });
      await inboxRepo1.markProcessed('wager-transaction-consumer', msg1.messageId, new Date());
    });
    // NÃO chama consumer.delete → mensagem ainda está na fila (visibilidade expirou)

    // Espera a visibilidade expirar (30s no consumer acima) — forçar via nack
    // para devolver imediatamente
    await consumer.nack(msg1.receiptHandle);

    // 2ª execução: novo worker pega a mesma mensagem
    const verifyBefore = freshEm(db);
    const finalBefore = await verifyBefore.findOneOrFail(WalletEntity, { id: wallet.id });
    expect(finalBefore.balanceAmount).toBe('75.00'); // já debitou 1x

    const messages2 = await consumer.receive(1, 10);
    expect(messages2.length).toBe(1);

    const em2 = freshEm(db);
    const useCase2 = new ConsumeWagerTransactionUseCase(
      em2,
      consumer,
      new InboxMessageRepository(em2),
      buildProcessUseCase(em2),
    );
    const result = await useCase2.processOne(messages2[0]);
    expect(result.action).toBe('ack');
    expect(result.reason).toBe('duplicate');

    // Saldo continua 75.00 (não debitou de novo)
    const verifyAfter = freshEm(db);
    const finalAfter = await verifyAfter.findOneOrFail(WalletEntity, { id: wallet.id });
    expect(finalAfter.balanceAmount).toBe('75.00');
  });

  it('erro de negócio (ex: wallet não existe) → ack + terminal, vai pro outbox como REJECTED', async () => {
    // Mensagem referencia wallet inexistente
    const msg = makeBetMessage(uuid(), uuid(), 'ext-notfound', '25.00');
    await sendMessage(db.sqs, queueUrl, JSON.stringify(msg), msg.data.walletId, msg.messageId);

    const consumer = new SqsConsumerClient({
      client: db.sqs,
      queueUrl,
      visibilityTimeout: 30,
    });
    const workerEm = freshEm(db);
    const processUseCase = buildProcessUseCase(workerEm);
    const inboxRepo = new InboxMessageRepository(workerEm);
    const useCase = new ConsumeWagerTransactionUseCase(
      workerEm,
      consumer,
      inboxRepo,
      processUseCase,
    );

    const messages = await consumer.receive(1, 10);
    expect(messages.length).toBe(1);
    const result = await useCase.processOne(messages[0]);
    expect(result.action).toBe('ack');
    expect(result.reason).toBe('terminal-business');
  });
});
