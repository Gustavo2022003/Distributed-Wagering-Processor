import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WageringService } from './wagering.service';
import { WageringController } from './wagering.controller';
import { PendingReferenceWorker } from './application/pending-reference.worker';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [WageringController],
  providers: [WageringService, PendingReferenceWorker],
})
export class WageringModule {}
