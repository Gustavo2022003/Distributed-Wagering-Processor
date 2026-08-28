// test/integration/publish-outbox.spec.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { v4 as uuid } from 'uuid';
import { EntityManager } from '@mikro-orm/core';
import {
  setupTestDb,
  teardownTestDb,
  clearTables,
  freshEm,
  purgeQueue,
  type TestDb,
} from './setup';
import { OutboxRepository } from '../../src/messaging/persistence/outbox.repository';
import { PublishOutboxUseCase } from '../../src/messaging/application/publish-outbox.use-case';
import { SqsOutboxPublisher } from '../../src/messaging/sqs-outbox-publisher';
import { OutboxMessage } from '../../src/messaging/domain/outbox-message';
import { ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { WagerTransactionProcessed } from '../../src/wagering/events/wager-events';

describe('PublishOutboxUseCase (SQS real via LocalStack)', () => {
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
    await purgeQueue(db.sqs, db.outboxQueueUrl);
  });

  async function enqueueFakeEvent(): Promise<OutboxMessage> {
    const event = OutboxMessage.enqueue(
      WagerTransactionProcessed.from({
        transactionId: uuid(),
        providerId: 'provider-a',
        externalTransactionId: 'ext-' + uuid(),
        playerId: uuid(),
        walletId: uuid(),
        roundId: 'r',
        gameId: 'g',
        kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
        ctx: {
          eventId: uuid(),
          correlationId: 'corr-1',
          occurredAt: new Date(),
        },
      }),
    );
    const outboxRepo = new OutboxRepository(em);
    outboxRepo.enqueue(event);
    await em.flush();
    return event;
  }

  it('publica eventos pendentes no SQS e marca published_at', async () => {
    await enqueueFakeEvent();
    await enqueueFakeEvent();
    await enqueueFakeEvent();

    const outboxRepo = new OutboxRepository(em);
    const publisher = new SqsOutboxPublisher({ queueUrl: db.outboxQueueUrl, client: db.sqs });
    const useCase = new PublishOutboxUseCase(em, outboxRepo, publisher);

    const result = await useCase.runOnce();
    expect(result.published).toBe(3);
    expect(result.rescheduled).toBe(0);

    // Confere published_at no banco
    const verify = freshEm(db);
    const pending = await verify.execute(
      `SELECT count(*)::int AS n FROM outbox_messages WHERE published_at IS NULL`,
    );
    expect((pending as any[])[0].n).toBe(0);

    // Confere mensagens no SQS
    const received = await db.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: db.outboxQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    expect(received.Messages?.length).toBe(3);
    for (const m of received.Messages ?? []) {
      const body = JSON.parse(m.Body!);
      expect(body.eventType).toBe('WagerTransactionProcessed');
    }
    // Limpa pra não afetar próximo test
    for (const m of received.Messages ?? []) {
      if (m.ReceiptHandle) {
        await db.sqs.send(new DeleteMessageCommand({ QueueUrl: db.outboxQueueUrl, ReceiptHandle: m.ReceiptHandle }));
      }
    }
  });

  it('scheduleRetry: publicação falhou → next_attempt_at é setado, published_at continua null', async () => {
    await enqueueFakeEvent();

    // Publisher que sempre falha
    const failingPublisher = {
      publish: async () => { throw new Error('SQS offline'); },
    };
    const outboxRepo = new OutboxRepository(em);
    const useCase = new PublishOutboxUseCase(em, outboxRepo, failingPublisher);

    const result = await useCase.runOnce();
    expect(result.published).toBe(0);
    expect(result.rescheduled).toBe(1);

    const verify = freshEm(db);
    const row: any[] = await verify.execute(
      `SELECT published_at, next_attempt_at, attempts FROM outbox_messages LIMIT 1`,
    );
    expect(row[0].published_at).toBeNull();
    expect(row[0].next_attempt_at).not.toBeNull();
    expect(row[0].attempts).toBe(1);
  });

  it('processo morre entre commit e publicação → próxima instância assume e publica', async () => {
    // Cenário: inserimos um evento no banco e simulamos "morte" do publisher
    // antes do markPublished. O próximo runOnce() encontra o evento (published_at IS NULL)
    // e publica normalmente.
    await enqueueFakeEvent();

    // Simula "morte": lê a row como se fosse outro worker pegando
    const verify1 = freshEm(db);
    const before: any[] = await verify1.execute(
      `SELECT id, published_at FROM outbox_messages LIMIT 1`,
    );
    expect(before[0].published_at).toBeNull();

    // "Crash" — sem markPublished
    // O próximo worker pega o evento (FOR UPDATE SKIP LOCKED permite)
    const outboxRepo = new OutboxRepository(em);
    const publisher = new SqsOutboxPublisher({ queueUrl: db.outboxQueueUrl, client: db.sqs });
    const useCase = new PublishOutboxUseCase(em, outboxRepo, publisher);
    const result = await useCase.runOnce();
    expect(result.published).toBe(1);

    // Agora published_at setado
    const verify2 = freshEm(db);
    const after: any[] = await verify2.execute(
      `SELECT id, published_at FROM outbox_messages LIMIT 1`,
    );
    expect(after[0].published_at).not.toBeNull();

    // Mensagem está no SQS
    const received = await db.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: db.outboxQueueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 1,
      }),
    );
    expect(received.Messages?.length).toBe(1);
    if (received.Messages?.[0]?.ReceiptHandle) {
      await db.sqs.send(new DeleteMessageCommand({
        QueueUrl: db.outboxQueueUrl,
        ReceiptHandle: received.Messages[0].ReceiptHandle,
      }));
    }
  });

  it('dois publishers concorrentes sobre a mesma outbox: cada evento é publicado exatamente 1 vez', async () => {
    // Cenário: dois workers rodam em paralelo.
    // FOR UPDATE SKIP LOCKED garante que cada um pega um batch exclusivo
    // (sem lock de outro), publica, e só então commita.
    // Resultado: cada evento aparece 1x no SQS.

    for (let i = 0; i < 10; i++) {
      await enqueueFakeEvent();
    }

    const publisher1 = new SqsOutboxPublisher({ queueUrl: db.outboxQueueUrl, client: db.sqs });
    const publisher2 = new SqsOutboxPublisher({ queueUrl: db.outboxQueueUrl, client: db.sqs });
    // Cada publisher usa seu próprio em (em.fork)
    // Cada publisher usa seu próprio em (em.fork)
    const em1 = freshEm(db);
    const em2 = freshEm(db);
    const useCase1 = new PublishOutboxUseCase(em1, new OutboxRepository(em1), publisher1);
    const useCase2 = new PublishOutboxUseCase(em2, new OutboxRepository(em2), publisher2);

    const [r1, r2] = await Promise.all([useCase1.runOnce(), useCase2.runOnce()]);

    // A soma de published deve ser 10 (cada evento exatamente 1x)
    expect(r1.published + r2.published).toBe(10);
    expect(r1.rescheduled + r2.rescheduled).toBe(0);

    // Recebe do SQS e conta — deve ser 10 mensagens
    const allMessages: any[] = [];
    let drained = true;
    while (drained) {
      drained = false;
      const out = await db.sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: db.outboxQueueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
        }),
      );
      for (const m of out.Messages ?? []) {
        allMessages.push(JSON.parse(m.Body!));
        if (m.ReceiptHandle) {
          await db.sqs.send(new DeleteMessageCommand({ QueueUrl: db.outboxQueueUrl, ReceiptHandle: m.ReceiptHandle }));
        }
        drained = true;
      }
    }

    // Cada event_id aparece exatamente 1x
    const ids = allMessages.map((m) => m.eventId);
    expect(ids.length).toBe(10);
    expect(new Set(ids).size).toBe(10);
  });
});
