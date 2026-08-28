import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WagerTransactionHttpController } from './application/process-wager-transaction.controller';
import { ProcessWagerTransactionUseCase } from './application/process-wager-transaction.use-case';
import { PendingReferenceWorker } from './application/pending-reference.worker';
import { WalletRepository } from '../wallet/persistence/wallet.repository';
import { WagerTransactionRepository } from './persistence/wager-transaction.repository';
import { WalletLedgerEntryRepository } from '../ledger/persistence/wallet-ledger-entry.repository';
import { OutboxRepository } from '../messaging/persistence/outbox.repository';
import { ReprocessPendingReferenceUseCase } from './application/reprocess-pending-reference.use-case';
import { ConsumeWagerTransactionUseCase } from './application/consume-wager-transaction.use-case';
import { InboxMessageRepository } from '../messaging/persistence/inbox-message.repository';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [WagerTransactionHttpController],
  providers: [
    WagerTransactionRepository,
    WalletRepository,
    WalletLedgerEntryRepository,
    OutboxRepository,
    InboxMessageRepository,
    ProcessWagerTransactionUseCase,
    ReprocessPendingReferenceUseCase,
    ConsumeWagerTransactionUseCase,
    PendingReferenceWorker,
  ],
})
export class WageringModule {}
