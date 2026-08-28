import { defineConfig } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator, TSMigrationGenerator } from '@mikro-orm/migrations';

import { WalletEntity } from '../wallet/persistence/wallet.entity';
import { WagerTransactionEntity } from '../wagering/persistence/wager-transaction.entity';
import { WalletLedgerEntryEntity } from '../ledger/persistence/wallet-ledger-entry.entity';
import { InboxMessageEntity } from '../messaging/persistence/inbox-message.entity';
import { OutboxMessageEntity } from '../messaging/persistence/outbox-message.entity';

export const mikroOrmConfig = defineConfig({
  driver: PostgreSqlDriver,
  entities: [
    WalletEntity,
    WagerTransactionEntity,
    WalletLedgerEntryEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
  dbName: process.env.DATABASE_URL ? undefined : 'wagering',
  clientUrl: process.env.DATABASE_URL,
  pool: {
    min: 0,
    max: 10,
    acquireTimeout: 5_000,
  },
  extensions: [Migrator],
  migrations: {
    path: './src/migrations',
    pathTs: './src/migrations',
    generator: TSMigrationGenerator,
    transactional: true,
  },
  debug: process.env.NODE_ENV !== 'production',
});
