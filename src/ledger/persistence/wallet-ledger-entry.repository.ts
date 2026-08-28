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

  async findByWalletPaginated(
    walletId: string,
    limit: number,
    cursorCreatedAt?: Date,
    cursorId?: string,
  ): Promise<WalletLedgerEntry[]> {
    const where: any = { walletId };
    if (cursorCreatedAt && cursorId) {
      // Estável: order by (created_at ASC, id ASC); cursor = par (createdAt, id)
      where.$or = [
        { createdAt: { $gt: cursorCreatedAt } },
        { createdAt: cursorCreatedAt, id: { $gt: cursorId } },
      ];
    }
    const entities = await this.em.find(WalletLedgerEntryEntity, where, {
      limit,
      orderBy: [{ createdAt: 'ASC' }, { id: 'ASC' }],
    });
    return entities.map((e) => WalletLedgerEntryMapper.toDomain(e));
  }

  async findByWallet(walletId: string): Promise<WalletLedgerEntry[]> {
    const entities = await this.em.find(
      WalletLedgerEntryEntity,
      { walletId },
      { orderBy: [{ createdAt: 'ASC' }, { id: 'ASC' }] },
    );
    return entities.map((e) => WalletLedgerEntryMapper.toDomain(e));
  }
}
