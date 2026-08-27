// src/wallet/persistence/wallet.entity.ts
//
// Entity de persistência da Wallet. Mapeia o estado do aggregate
// em colunas do Postgres. O domínio (Wallet class) não conhece
// esta entity — quem faz a ponte é o WalletMapper.

import { Entity, PrimaryKey, Property, Index, Unique, Check } from '@mikro-orm/decorators/legacy';
import { v4 as uuid } from 'uuid';

@Entity({ tableName: 'wallets' })
@Unique({ name: 'uq_wallets_player_currency', properties: ['playerId', 'currency'] })
@Index({ name: 'ix_wallets_player', properties: ['playerId'] })
@Check({ name: 'ck_wallets_balance_non_negative', expression: 'balance_amount >= 0' })
@Check({ name: 'ck_wallets_version_positive', expression: 'version >= 1' })
@Check({ name: 'ck_wallets_currency_format', expression: "currency ~ '^[A-Z]{3}$'" })
export class WalletEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid', name: 'player_id' })
  playerId!: string;

  @Property({ type: 'char', length: 3 })
  currency!: string;

  @Property({ type: 'numeric', precision: 20, scale: 2, name: 'balance_amount' })
  balanceAmount!: string;

  @Property({ type: 'char', length: 3, name: 'balance_currency' })
  balanceCurrency!: string;

  @Property({ type: 'int' })
  version!: number;

  @Property({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Property({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Property({ type: 'timestamptz', name: 'closed_at', nullable: true })
  closedAt?: Date;

  static newId(): string {
    return uuid();
  }
}
