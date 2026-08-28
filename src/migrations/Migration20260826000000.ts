import { Migration } from '@mikro-orm/migrations';

export class Migration20260826000000 extends Migration {
  async up(): Promise<void> {
    // ─── ROLES ────────────────────────────────────────────────────────────
    this.addSql(`CREATE ROLE app_role NOLOGIN;`);

    // ─── EXTENSIONS ────────────────────────────────────────────────────────
    this.addSql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // ─── TABLES ───────────────────────────────────────────────────────────

    this.addSql(`
      CREATE TABLE wallets (
        id UUID PRIMARY KEY,
        player_id UUID NOT NULL,
        currency CHAR(3) NOT NULL,
        balance_amount NUMERIC(20, 2) NOT NULL,
        balance_currency CHAR(3) NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        closed_at TIMESTAMPTZ,
        CONSTRAINT uq_wallets_player_currency UNIQUE (player_id, currency),
        CONSTRAINT ck_wallets_balance_non_negative CHECK (balance_amount >= 0),
        CONSTRAINT ck_wallets_version_positive CHECK (version >= 1),
        CONSTRAINT ck_wallets_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT ck_wallets_balance_currency_match CHECK (balance_currency = currency)
      );
    `);
    this.addSql(`CREATE INDEX ix_wallets_player ON wallets (player_id);`);

    this.addSql(`
      CREATE TABLE wager_transactions (
        id UUID PRIMARY KEY,
        provider_id VARCHAR(64) NOT NULL,
        external_transaction_id VARCHAR(128) NOT NULL,
        idempotency_key VARCHAR(256) NOT NULL,
        payload_hash CHAR(64) NOT NULL,
        wallet_id UUID NOT NULL,
        player_id UUID NOT NULL,
        round_id VARCHAR(128) NOT NULL,
        game_id VARCHAR(64) NOT NULL,
        kind VARCHAR(16) NOT NULL,
        money_amount NUMERIC(20, 2) NOT NULL,
        money_currency CHAR(3) NOT NULL,
        reference_external_transaction_id VARCHAR(128),
        reference_transaction_id UUID,
        created_at TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) NOT NULL,
        failure_code VARCHAR(64),
        processed_at TIMESTAMPTZ,
        CONSTRAINT uq_wtx_idempotency_key UNIQUE (idempotency_key),
        CONSTRAINT uq_wtx_provider_external UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT ck_wtx_kind CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        CONSTRAINT ck_wtx_status CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        CONSTRAINT ck_wtx_money_positive CHECK (money_amount > 0),
        CONSTRAINT ck_wtx_money_currency_format CHECK (money_currency ~ '^[A-Z]{3}$'),
        CONSTRAINT fk_wtx_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT
      );
    `);
    this.addSql(`CREATE INDEX ix_wtx_reference_resolution ON wager_transactions (provider_id, reference_external_transaction_id);`);
    this.addSql(`CREATE INDEX ix_wtx_wallet_status ON wager_transactions (wallet_id, status);`);
    this.addSql(`CREATE INDEX ix_wtx_status_created ON wager_transactions (status, created_at);`);

    this.addSql(`
      CREATE TABLE wallet_ledger_entries (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL,
        transaction_id UUID NOT NULL,
        direction VARCHAR(8) NOT NULL,
        money_amount NUMERIC(20, 2) NOT NULL,
        money_currency CHAR(3) NOT NULL,
        balance_before_amount NUMERIC(20, 2) NOT NULL,
        balance_before_currency CHAR(3) NOT NULL,
        balance_after_amount NUMERIC(20, 2) NOT NULL,
        balance_after_currency CHAR(3) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT uq_wle_transaction_wallet UNIQUE (transaction_id, wallet_id),
        CONSTRAINT ck_wle_direction CHECK (direction IN ('DEBIT','CREDIT')),
        CONSTRAINT ck_wle_money_positive CHECK (money_amount > 0),
        CONSTRAINT ck_wle_balance_currency_match CHECK (balance_before_currency = balance_after_currency),
        CONSTRAINT ck_wle_money_currency_match CHECK (money_currency = balance_before_currency),
        CONSTRAINT fk_wle_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT,
        CONSTRAINT fk_wle_transaction FOREIGN KEY (transaction_id) REFERENCES wager_transactions(id) ON DELETE RESTRICT
      );
    `);
    this.addSql(`CREATE INDEX ix_wle_wallet_created ON wallet_ledger_entries (wallet_id, created_at);`);
    this.addSql(`CREATE INDEX ix_wle_transaction ON wallet_ledger_entries (transaction_id);`);

    this.addSql(`
      CREATE TABLE inbox_messages (
        message_id VARCHAR(128) NOT NULL,
        consumer_name VARCHAR(64) NOT NULL,
        payload_hash CHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ,
        PRIMARY KEY (message_id, consumer_name)
      );
    `);
    this.addSql(`CREATE INDEX ix_inbox_consumer_processed ON inbox_messages (consumer_name, processed_at);`);

    this.addSql(`
      CREATE TABLE outbox_messages (
        id UUID PRIMARY KEY,
        event_id UUID NOT NULL,
        aggregate_id UUID NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        correlation_id VARCHAR(64) NOT NULL,
        causation_id VARCHAR(64),
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        CONSTRAINT uq_outbox_event_id UNIQUE (event_id)
      );
    `);
    this.addSql(`CREATE INDEX ix_outbox_pending_due ON outbox_messages (published_at, next_attempt_at);`);

    // ─── GRANTS + REVOKES ─────────────────────────────────────────────────

    this.addSql(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;`);
    this.addSql(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;`);

    // Ledger é append-only: proíbe UPDATE e DELETE
    this.addSql(`REVOKE UPDATE, DELETE ON wallet_ledger_entries FROM app_role;`);
    this.addSql(`GRANT SELECT, INSERT ON wallet_ledger_entries TO app_role;`);
  }

  async down(): Promise<void> {
    this.addSql(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_role;`);
    this.addSql(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_role;`);

    this.addSql(`DROP TABLE IF EXISTS outbox_messages CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS inbox_messages CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS wallet_ledger_entries CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS wager_transactions CASCADE;`);
    this.addSql(`DROP TABLE IF EXISTS wallets CASCADE;`);

    this.addSql(`DROP ROLE IF EXISTS app_role;`);
  }
}
