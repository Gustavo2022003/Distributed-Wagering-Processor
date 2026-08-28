import { EntityManager } from '@mikro-orm/core';
import { Wallet } from '../domain/wallet';
import { WalletMapper } from './wallet.mapper';
import { WalletEntity } from './wallet.entity';

export class WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { id });
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async findByPlayerCurrency(playerId: string, currency: string): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, { playerId, currency });
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async insert(wallet: Wallet): Promise<void> {
    const entity = WalletMapper.toEntity(wallet);
    this.em.persist(entity);
  }

  async updateWithCondition(props: {
    id: string;
    expectedVersion: number;
    newBalanceAmount: string;
    newBalanceCurrency: string;
    newUpdatedAt: Date;
    debitGuard?: string;
  }): Promise<boolean> {
    const conn = this.em.getConnection();
    if (props.debitGuard !== undefined) {
      const result: any = await conn.execute(
        `UPDATE wallets
            SET balance_amount = balance_amount - ?,
                version = version + 1,
                updated_at = ?
          WHERE id = ?
            AND version = ?
            AND currency = ?
            AND balance_amount >= ?
        RETURNING balance_amount`,
        [
          props.debitGuard,
          props.newUpdatedAt,
          props.id,
          props.expectedVersion,
          props.newBalanceCurrency,
          props.debitGuard,
        ],
      );
      const arr = Array.isArray(result) ? result : (result?.rows ?? []);
      return arr.length > 0;
    }

    const result: any = await conn.execute(
      `UPDATE wallets
          SET balance_amount = ?,
              version = version + 1,
              updated_at = ?
        WHERE id = ?
            AND version = ?
            AND currency = ?
        RETURNING balance_amount`,
      [
        props.newBalanceAmount,
        props.newUpdatedAt,
        props.id,
        props.expectedVersion,
        props.newBalanceCurrency,
      ],
    );
    return Array.isArray(result) && result.length > 0;
  }
}
