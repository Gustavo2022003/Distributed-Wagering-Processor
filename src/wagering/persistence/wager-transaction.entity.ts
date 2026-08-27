// src/wagering/persistence/wager-transaction.entity.ts

import { Entity, PrimaryKey, Property, Index, Unique, Check } from '@mikro-orm/decorators/legacy';
import { v4 as uuid } from 'uuid';

@Entity({ tableName: 'wager_transactions' })
@Unique({ name: 'uq_wtx_idempotency_key', properties: ['idempotencyKey'] })
@Unique({
  name: 'uq_wtx_provider_external',
  properties: ['providerId', 'externalTransactionId'],
})
@Index({
  name: 'ix_wtx_reference_resolution',
  properties: ['providerId', 'referenceExternalTransactionId'],
})
@Index({
  name: 'ix_wtx_wallet_status',
  properties: ['walletId', 'status'],
})
@Index({
  name: 'ix_wtx_status_created',
  properties: ['status', 'createdAt'],
})
@Check({
  name: 'ck_wtx_kind',
  expression: "kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')",
})
@Check({
  name: 'ck_wtx_status',
  expression: "status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')",
})
@Check({ name: 'ck_wtx_money_positive', expression: 'money_amount > 0' })
@Check({ name: 'ck_wtx_money_currency_format', expression: "money_currency ~ '^[A-Z]{3}$'" })
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'varchar', length: 64, name: 'provider_id' })
  providerId!: string;

  @Property({ type: 'varchar', length: 128, name: 'external_transaction_id' })
  externalTransactionId!: string;

  @Property({ type: 'varchar', length: 256, name: 'idempotency_key' })
  idempotencyKey!: string;

  @Property({ type: 'char', length: 64, name: 'payload_hash' })
  payloadHash!: string;

  @Property({ type: 'uuid', name: 'wallet_id' })
  walletId!: string;

  @Property({ type: 'uuid', name: 'player_id' })
  playerId!: string;

  @Property({ type: 'varchar', length: 128, name: 'round_id' })
  roundId!: string;

  @Property({ type: 'varchar', length: 64, name: 'game_id' })
  gameId!: string;

  @Property({ type: 'varchar', length: 16 })
  kind!: string;

  @Property({ type: 'numeric', precision: 20, scale: 2, name: 'money_amount' })
  moneyAmount!: string;

  @Property({ type: 'char', length: 3, name: 'money_currency' })
  moneyCurrency!: string;

  @Property({
    type: 'varchar',
    length: 128,
    name: 'reference_external_transaction_id',
    nullable: true,
  })
  referenceExternalTransactionId?: string;

  @Property({ type: 'uuid', name: 'reference_transaction_id', nullable: true })
  referenceTransactionId?: string;

  @Property({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Property({ type: 'varchar', length: 20 })
  status!: string;

  @Property({ type: 'varchar', length: 64, name: 'failure_code', nullable: true })
  failureCode?: string;

  @Property({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt?: Date;

  static newId(): string {
    return uuid();
  }
}
