import { Module } from '@nestjs/common';
import { WalletModule } from './wallet/wallet.module';
import { WageringModule } from './wagering/wagering.module';
import { LedgerModule } from './ledger/ledger.module';
import { MessagingModule } from './messaging/messaging.module';

@Module({
  imports: [
    WalletModule,
    WageringModule,
    LedgerModule,
    MessagingModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
