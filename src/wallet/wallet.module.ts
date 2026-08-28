import { Module } from '@nestjs/common';
import { WalletController } from './application/wallet.controller';
import { CreateWalletUseCase } from './application/create-wallet.use-case';
import { ReconcileWalletUseCase } from './application/reconcile-wallet.use-case';
import { WalletRepository } from './persistence/wallet.repository';
import { WalletLedgerEntryRepository } from '../ledger/persistence/wallet-ledger-entry.repository';
import { WagerTransactionRepository } from '../wagering/persistence/wager-transaction.repository';
import { OutboxRepository } from '../messaging/persistence/outbox.repository';
import { ProcessWagerTransactionUseCase } from '../wagering/application/process-wager-transaction.use-case';

@Module({
  controllers: [WalletController],
  providers: [
    WalletRepository,
    WalletLedgerEntryRepository,
    WagerTransactionRepository,
    OutboxRepository,
    CreateWalletUseCase,
    ReconcileWalletUseCase,
    ProcessWagerTransactionUseCase,
  ],
  exports: [WalletRepository],
})
export class WalletModule {}
