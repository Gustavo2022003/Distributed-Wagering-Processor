// src/db/mikro-orm.config.ts
//
// Config do MikroORM para o CLI (migrations) e para o runtime.
// O DATABASE_URL vem do env. Em testes, é sobrescrito pelo test helper.

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
  extensions: [Migrator],
  migrations: {
    path: './src/migrations',
    pathTs: './src/migrations',
    generator: TSMigrationGenerator,
    transactional: true,
  },
  debug: process.env.NODE_ENV !== 'production',
});
