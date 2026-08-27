// src/ledger/persistence/wallet-ledger-entry.entity.ts

import { Entity, PrimaryKey, Property, Index, Unique, Check } from '@mikro-orm/decorators/legacy';
import { v4 as uuid } from 'uuid';

@Entity({ tableName: 'wallet_ledger_entries' })
@Unique({
  name: 'uq_wle_transaction_wallet',
  properties: ['transactionId', 'walletId'],
})
@Index({ name: 'ix_wle_wallet_created', properties: ['walletId', 'createdAt'] })
@Index({ name: 'ix_wle_transaction', properties: ['transactionId'] })
@Check({
  name: 'ck_wle_direction',
  expression: "direction IN ('DEBIT','CREDIT')",
})
@Check({ name: 'ck_wle_money_positive', expression: 'money_amount > 0' })
@Check({
  name: 'ck_wle_balance_currency_match',
  expression: 'balance_before_currency = balance_after_currency',
})
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid', name: 'wallet_id' })
  walletId!: string;

  @Property({ type: 'uuid', name: 'transaction_id' })
  transactionId!: string;

  @Property({ type: 'varchar', length: 8 })
  direction!: string;

  @Property({ type: 'numeric', precision: 20, scale: 2, name: 'money_amount' })
  moneyAmount!: string;

  @Property({ type: 'char', length: 3, name: 'money_currency' })
  moneyCurrency!: string;

  @Property({ type: 'numeric', precision: 20, scale: 2, name: 'balance_before_amount' })
  balanceBeforeAmount!: string;

  @Property({ type: 'char', length: 3, name: 'balance_before_currency' })
  balanceBeforeCurrency!: string;

  @Property({ type: 'numeric', precision: 20, scale: 2, name: 'balance_after_amount' })
  balanceAfterAmount!: string;

  @Property({ type: 'char', length: 3, name: 'balance_after_currency' })
  balanceAfterCurrency!: string;

  @Property({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  static newId(): string {
    return uuid();
  }
}
