// test/integration/migrations.spec.ts

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM } from '@mikro-orm/core';
import { setupTestDb, teardownTestDb, type TestDb } from './setup';

describe('Migrations', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  it('aplicam todas as migrations sem erro', async () => {
    const pending = await db.orm.migrator.getPendingMigrations?.() ?? [];
    expect(pending).toHaveLength(0);
  });

  it('criaram todas as 5 tabelas esperadas', async () => {
    const result = await db.em.execute<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name;`,
    );
    const tables = (result as unknown as { table_name: string }[]).map((r) => r.table_name);
    expect(tables).toContain('wallets');
    expect(tables).toContain('wager_transactions');
    expect(tables).toContain('wallet_ledger_entries');
    expect(tables).toContain('inbox_messages');
    expect(tables).toContain('outbox_messages');
  });

  it('criaram UNIQUE em wallets (player_id, currency)', async () => {
    const result = await db.em.execute<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'wallets' AND constraint_type = 'UNIQUE';`,
    );
    const names = (result as unknown as { constraint_name: string }[]).map((r) => r.constraint_name);
    expect(names).toContain('uq_wallets_player_currency');
  });

  it('criaram UNIQUE em wager_transactions (idempotency_key)', async () => {
    const result = await db.em.execute<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'wager_transactions' AND constraint_type = 'UNIQUE';`,
    );
    const names = (result as unknown as { constraint_name: string }[]).map((r) => r.constraint_name);
    expect(names).toContain('uq_wtx_idempotency_key');
  });

  it('criaram UNIQUE em inbox_messages (consumer_name, message_id)', async () => {
    const result = await db.em.execute<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'inbox_messages' AND constraint_type = 'PRIMARY KEY';`,
    );
    const names = (result as unknown as { constraint_name: string }[]).map((r) => r.constraint_name);
    // PK composta cobre a unicidade
    expect(names).toContain('inbox_messages_pkey');
  });

  it('criaram CHECK de balance_amount >= 0 em wallets', async () => {
    const result = await db.em.execute<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'wallets' AND constraint_type = 'CHECK';`,
    );
    const names = (result as unknown as { constraint_name: string }[]).map((r) => r.constraint_name);
    expect(names).toContain('ck_wallets_balance_non_negative');
  });

  it('criaram índice (provider_id, reference_external_transaction_id) em wager_transactions', async () => {
    const result = await db.em.execute<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'wager_transactions';`,
    );
    const names = (result as unknown as { indexname: string }[]).map((r) => r.indexname);
    expect(names).toContain('ix_wtx_reference_resolution');
  });

  it('criaram índice (published_at, next_attempt_at) em outbox_messages', async () => {
    const result = await db.em.execute<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'outbox_messages';`,
    );
    const names = (result as unknown as { indexname: string }[]).map((r) => r.indexname);
    expect(names).toContain('ix_outbox_pending_due');
  });

  it('REVOKE bloqueia UPDATE/DELETE no ledger para app_role', async () => {
    const result = await db.em.execute<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'app_role' AND table_name = 'wallet_ledger_entries';`,
    );
    const privs = (result as unknown as { privilege_type: string }[]).map((r) => r.privilege_type);
    expect(privs).toContain('SELECT');
    expect(privs).toContain('INSERT');
    expect(privs).not.toContain('UPDATE');
    expect(privs).not.toContain('DELETE');
  });
});
