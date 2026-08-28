import { Migration } from '@mikro-orm/migrations';

export class Migration20260827000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`ALTER TABLE wager_transactions ADD COLUMN correlation_id VARCHAR(64);`);
    this.addSql(`ALTER TABLE wager_transactions ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;`);
    this.addSql(`ALTER TABLE wager_transactions ADD COLUMN next_attempt_at TIMESTAMPTZ;`);
    this.addSql(`CREATE INDEX ix_wtx_pending_retry ON wager_transactions (status, next_attempt_at);`);
  }

  async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS ix_wtx_pending_retry;`);
    this.addSql(`ALTER TABLE wager_transactions DROP COLUMN IF EXISTS next_attempt_at;`);
    this.addSql(`ALTER TABLE wager_transactions DROP COLUMN IF EXISTS attempts;`);
    this.addSql(`ALTER TABLE wager_transactions DROP COLUMN IF EXISTS correlation_id;`);
  }
}
