import { EntityManager } from '@mikro-orm/core';
import { Money } from '../../shared/money';
import { WalletRepository } from '../persistence/wallet.repository';
import { WalletLedgerEntryRepository } from '../../ledger/persistence/wallet-ledger-entry.repository';
import { NotFoundError } from './errors';
import { moneyZero } from './money';

export interface ReconcileWalletResult {
  walletId: string;
  storedBalance: ReturnType<Money['toJSON']>;
  calculatedBalance: ReturnType<Money['toJSON']>;
  diff: ReturnType<Money['toJSON']>;
  consistent: boolean;
  entriesChecked: number;
}

export class ReconcileWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly walletRepo: WalletRepository,
    private readonly ledgerRepo: WalletLedgerEntryRepository,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletResult> {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) throw new NotFoundError(`Wallet not found: ${walletId}`);

    const entries = await this.ledgerRepo.findByWallet(walletId);
    const currency = wallet.currency;

    let balance = moneyZero(currency);
    for (const e of entries) {
      if (e.direction === 'CREDIT') {
        balance = balance.add(e.money);
      } else {
        balance = balance.subtract(e.money);
      }
    }

    const storedBalance = wallet.balance;
    const diff = storedBalance.subtract(balance);
    const consistent = diff.amount === '0.00';

    if (!consistent) {
      // Regra seção 9: loga/mede divergência, NUNCA corrige silenciosamente.
      // Aqui só logamos; métrica seria adicionada via counter/histogram.
      console.warn(
        `[reconcile] DIVERGENCE walletId=${walletId} stored=${storedBalance.amount} calculated=${balance.amount} diff=${diff.amount} entries=${entries.length}`,
      );
    }

    return {
      walletId,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: balance.toJSON(),
      diff: diff.toJSON(),
      consistent,
      entriesChecked: entries.length,
    };
  }
}
