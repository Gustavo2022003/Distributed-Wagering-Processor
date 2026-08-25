import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { LedgerController } from './ledger.controller';

@Module({
  controllers: [LedgerController],
  providers: [LedgerService],
})
export class LedgerModule {}
