import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { OutboxMessage } from '../domain/outbox-message';
import { OutboxPublisher } from './i-outbox-publisher';

export interface SqsOutboxPublisherOptions {
  client?: SQSClient;
  queueUrl: string;
}

export class SqsOutboxPublisher implements OutboxPublisher {
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly ownsClient: boolean;

  constructor(opts: SqsOutboxPublisherOptions) {
    if (opts.client) {
      this.client = opts.client;
      this.ownsClient = false;
    } else {
      this.client = new SQSClient({
        region: process.env.AWS_REGION ?? 'us-east-1',
        endpoint: process.env.AWS_ENDPOINT_URL,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
        },
      });
      this.ownsClient = true;
    }
    this.queueUrl = opts.queueUrl;
  }

  async publish(event: OutboxMessage): Promise<void> {
    const useQueueUrl = process.env.AWS_ENDPOINT_URL ? true : false;
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(event.payload),
        MessageDeduplicationId: event.id,
        MessageGroupId: event.aggregateId,
      }),
      { useQueueUrlAsEndpoint: useQueueUrl } as any,
    );
  }
}
