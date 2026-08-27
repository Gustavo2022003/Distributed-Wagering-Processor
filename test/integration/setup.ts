// test/integration/setup.ts

import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { MikroORM, EntityManager } from '@mikro-orm/core';

export interface TestDb {
  container: StartedPostgreSqlContainer;
  orm: MikroORM;
  em: EntityManager;
}

let active: TestDb | null = null;

export async function setupTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('wagering_test')
    .withUsername('wagering')
    .withPassword('wagering')
    .start();

  // Importa o config DEPOIS do container subir, e força a URL
  // (o module-level do config lê process.env.DATABASE_URL no import)
  process.env.DATABASE_URL = container.getConnectionUri();

  // Re-import dinâmico pra garantir DATABASE_URL atualizado
  const { mikroOrmConfig } = await import('../../src/db/mikro-orm.config');
  const config = {
    ...mikroOrmConfig,
    clientUrl: container.getConnectionUri(),
  };

  const orm = await MikroORM.init(config);
  await orm.migrator.up();

  // Cria app_role pra os testes de REVOKE
  // (a migration inicial já cria; aqui só garante, com IF NOT EXISTS)
  await orm.em.execute(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_role') THEN
      CREATE ROLE app_role NOLOGIN;
    END IF;
  END $$;`);
  await orm.em.execute(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;`);
  await orm.em.execute(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;`);
  await orm.em.execute(`REVOKE UPDATE, DELETE ON wallet_ledger_entries FROM app_role;`);
  await orm.em.execute(`GRANT SELECT, INSERT ON wallet_ledger_entries TO app_role;`);

  const em = orm.em.fork();
  active = { container, orm, em };
  return active;
}

export async function teardownTestDb(): Promise<void> {
  if (!active) return;
  await active.orm.close();
  await active.container.stop();
  active = null;
}

export async function clearTables(em: EntityManager): Promise<void> {
  await em.execute(`TRUNCATE outbox_messages, inbox_messages, wallet_ledger_entries,
                          wager_transactions, wallets RESTART IDENTITY CASCADE;`);
}

export function freshEm(db: TestDb): EntityManager {
  return db.orm.em.fork();
}
