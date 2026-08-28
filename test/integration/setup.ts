// test/integration/setup.ts

import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
  LocalStackContainer,
  StartedLocalStackContainer,
} from '@testcontainers/postgresql';
import { LocalstackContainer } from '@testcontainers/localstack';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

export interface TestDb {
  container: StartedPostgreSqlContainer;
  orm: MikroORM;
  em: EntityManager;
  localstack: StartedLocalStackContainer;
  sqs: SQSClient;
  outboxQueueUrl: string;
}

let active: TestDb | null = null;

export async function setupTestDb(): Promise<TestDb> {
  const [pgContainer, localstack] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('wagering_test')
      .withUsername('wagering')
      .withPassword('wagering')
      .start(),
    new LocalstackContainer('localstack/localstack:3.8')
      .withEnvironment({ SERVICES: 'sqs', DEBUG: '0' })
      .start(),
  ]);

  const pgUri = pgContainer.getConnectionUri();
  process.env.DATABASE_URL = pgUri;

  const { mikroOrmConfig } = await import('../../src/db/mikro-orm.config');
  const orm = await MikroORM.init({ ...mikroOrmConfig, clientUrl: pgUri });
  await orm.migrator.up();

  await orm.em.execute(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_role') THEN
      CREATE ROLE app_role NOLOGIN;
    END IF;
  END $$;`);
  await orm.em.execute(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;`);
  await orm.em.execute(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;`);
  await orm.em.execute(`REVOKE UPDATE, DELETE ON wallet_ledger_entries FROM app_role;`);
  await orm.em.execute(`GRANT SELECT, INSERT ON wallet_ledger_entries TO app_role;`);

  const sqsEndpoint = localstack.getConnectionUri();
  const sqs = new SQSClient({
    region: 'us-east-1',
    endpoint: sqsEndpoint,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

  const outboxQueueName = 'wager-outbox-test.fifo';
  const outboxQueueUrl = (await sqs.send(
    new CreateQueueCommand({
      QueueName: outboxQueueName,
      Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' },
    }),
  )).QueueUrl!;

  process.env.WAGER_OUTBOX_QUEUE_URL = outboxQueueUrl;

  const em = orm.em.fork();
  active = {
    container: pgContainer,
    orm,
    em,
    localstack,
    sqs,
    outboxQueueUrl,
  };
  return active;
}

export async function teardownTestDb(): Promise<void> {
  if (!active) return;
  await active.orm.close();
  await active.container.stop();
  await active.localstack.stop();
  active = null;
}

export async function clearTables(em: EntityManager): Promise<void> {
  await em.execute(`TRUNCATE outbox_messages, inbox_messages, wallet_ledger_entries,
                          wager_transactions, wallets RESTART IDENTITY CASCADE;`);
}

export function freshEm(db: TestDb): EntityManager {
  return db.orm.em.fork();
}

export async function purgeQueue(sqs: SQSClient, queueUrl: string): Promise<void> {
  try {
    let drained = true;
    while (drained) {
      drained = false;
      // Receive and delete in a loop until empty
      const { ReceiveMessageCommand, DeleteMessageCommand } = await import('@aws-sdk/client-sqs');
      const out = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 0,
        }),
      );
      for (const msg of out.Messages ?? []) {
        if (msg.ReceiptHandle) {
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }));
          drained = true;
        }
      }
    }
  } catch {
    // queue may not exist yet
  }
}
