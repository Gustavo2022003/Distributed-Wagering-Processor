import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import type { SqsConsumer, SqsMessage } from './sqs-consumer.types';

export interface SqsConsumerClientOptions {
  client?: SQSClient;
  queueUrl: string;
  visibilityTimeout?: number;
}

export class SqsConsumerClient implements SqsConsumer {
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private readonly visibilityTimeout: number;
  private stopped = false;

  constructor(opts: SqsConsumerClientOptions) {
    if (opts.client) {
      this.client = opts.client;
    } else {
      this.client = new SQSClient({
        region: process.env.AWS_REGION ?? 'us-east-1',
        endpoint: process.env.AWS_ENDPOINT_URL,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
        },
      });
    }
    this.queueUrl = opts.queueUrl;
    this.visibilityTimeout = opts.visibilityTimeout ?? 30;
  }

  async receive(waitSeconds: number, maxMessages: number): Promise<SqsMessage[]> {
    if (this.stopped) return [];
    const useQueueUrl = process.env.AWS_ENDPOINT_URL ? true : false;
    const out = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitSeconds,
        VisibilityTimeout: this.visibilityTimeout,
        MessageAttributeNames: ['MessageDeduplicationId', 'MessageGroupId'],
      }),
      { useQueueUrlAsEndpoint: useQueueUrl } as any,
    );
    return (out.Messages ?? [])
      .filter((m) => m.MessageId && m.Body && m.ReceiptHandle)
      .map((m) => ({
        messageId: m.MessageId!,
        body: m.Body!,
        receiptHandle: m.ReceiptHandle!,
      }));
  }

  async delete(receiptHandle: string): Promise<void> {
    const useQueueUrl = process.env.AWS_ENDPOINT_URL ? true : false;
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }),
      { useQueueUrlAsEndpoint: useQueueUrl } as any,
    );
  }

  async nack(receiptHandle: string): Promise<void> {
    // SQS não tem "nack" explícito. Setamos VisibilityTimeout=0
    // para devolver imediatamente. Em produção, preferimos deixar
    // expirar naturalmente — evita loops de erro.
    const { ChangeMessageVisibilityCommand } = await import('@aws-sdk/client-sqs');
    const useQueueUrl = process.env.AWS_ENDPOINT_URL ? true : false;
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: 0,
      }),
      { useQueueUrlAsEndpoint: useQueueUrl } as any,
    );
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
  }
}
