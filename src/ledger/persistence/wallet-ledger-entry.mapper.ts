// src/ledger/persistence/wallet-ledger-entry.mapper.ts

import { WalletLedgerEntry, type LedgerEntryState } from '../domain/wallet-ledger-entry';
import { LedgerDirection } from '../../wagering/domain/wager-transaction';
import { WalletLedgerEntryEntity } from './wallet-ledger-entry.entity';

export const WalletLedgerEntryMapper = {
  toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: entity.id,
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: entity.direction as LedgerDirection,
      money: { amount: entity.moneyAmount, currency: entity.moneyCurrency },
      balanceBefore: {
        amount: entity.balanceBeforeAmount,
        currency: entity.balanceBeforeCurrency,
      },
      balanceAfter: {
        amount: entity.balanceAfterAmount,
        currency: entity.balanceAfterCurrency,
      },
      createdAt: entity.createdAt,
    });
  },

  toEntity(domain: WalletLedgerEntry): WalletLedgerEntryEntity {
    const e = new WalletLedgerEntryEntity();
    e.id = domain.id;
    e.walletId = domain.walletId;
    e.transactionId = domain.transactionId;
    e.direction = domain.direction;
    e.moneyAmount = domain.money.amount;
    e.moneyCurrency = domain.money.currency;
    e.balanceBeforeAmount = domain.balanceBefore.amount;
    e.balanceBeforeCurrency = domain.balanceBefore.currency;
    e.balanceAfterAmount = domain.balanceAfter.amount;
    e.balanceAfterCurrency = domain.balanceAfter.currency;
    e.createdAt = domain.createdAt;
    return e;
  },

  toStateSnapshot(domain: WalletLedgerEntry): LedgerEntryState {
    return {
      id: domain.id,
      walletId: domain.walletId,
      transactionId: domain.transactionId,
      direction: domain.direction,
      money: { amount: domain.money.amount, currency: domain.money.currency },
      balanceBefore: {
        amount: domain.balanceBefore.amount,
        currency: domain.balanceBefore.currency,
      },
      balanceAfter: {
        amount: domain.balanceAfter.amount,
        currency: domain.balanceAfter.currency,
      },
      createdAt: domain.createdAt,
    };
  },
};
