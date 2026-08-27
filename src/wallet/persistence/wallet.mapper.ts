// src/wallet/persistence/wallet.mapper.ts

import { Wallet, type WalletState } from '../domain/wallet';
import { WalletEntity } from './wallet.entity';

export const WalletMapper = {
  toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: { amount: entity.balanceAmount, currency: entity.balanceCurrency },
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      closedAt: entity.closedAt,
    });
  },

  toEntity(domain: Wallet): WalletEntity {
    const e = new WalletEntity();
    e.id = domain.id;
    e.playerId = domain.playerId;
    e.currency = domain.currency;
    e.balanceAmount = domain.balance.amount;
    e.balanceCurrency = domain.balance.currency;
    e.version = domain.version;
    e.createdAt = domain.createdAt;
    e.updatedAt = domain.updatedAt;
    e.closedAt = domain.closedAt;
    return e;
  },

  toStateSnapshot(domain: Wallet): WalletState {
    return {
      id: domain.id,
      playerId: domain.playerId,
      currency: domain.currency,
      balance: { amount: domain.balance.amount, currency: domain.balance.currency },
      version: domain.version,
      createdAt: domain.createdAt,
      updatedAt: domain.updatedAt,
      closedAt: domain.closedAt,
    };
  },
};
