// src/ledger/persistence/wallet-ledger-entry.repository.ts

import { EntityManager } from '@mikro-orm/core';
import { WalletLedgerEntry } from '../domain/wallet-ledger-entry';
import { WalletLedgerEntryMapper } from './wallet-ledger-entry.mapper';
import { WalletLedgerEntryEntity } from './wallet-ledger-entry.entity';

export class WalletLedgerEntryRepository {
  constructor(private readonly em: EntityManager) {}

  async insert(entry: WalletLedgerEntry): Promise<void> {
    const entity = WalletLedgerEntryMapper.toEntity(entry);
    this.em.persist(entity);
  }
}
