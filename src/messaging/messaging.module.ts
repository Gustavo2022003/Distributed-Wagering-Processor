import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MessagingService } from './messaging.service';
import { MessagingController } from './messaging.controller';
import { OutboxPublisherWorker } from './application/outbox-publisher.worker';
import { OutboxRepository } from './persistence/outbox.repository';
import { OutboxPublisher } from './i-outbox-publisher';
import { SqsOutboxPublisher } from './sqs-outbox-publisher';

const outboxQueueUrl =
  process.env.WAGER_OUTBOX_QUEUE_URL ?? 'http://localhost:4566/000000000000/wager-outbox';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    OutboxRepository,
    {
      provide: OutboxPublisher,
      useFactory: () => new SqsOutboxPublisher({ queueUrl: outboxQueueUrl }),
    },
    OutboxPublisherWorker,
  ],
})
export class MessagingModule {}
