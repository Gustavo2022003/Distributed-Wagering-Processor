import { Module } from '@nestjs/common';
import { WageringService } from './wagering.service';
import { WageringController } from './wagering.controller';

@Module({
  controllers: [WageringController],
  providers: [WageringService],
})
export class WageringModule {}
