// src/messaging/sqs-consumer.port.ts

export interface SqsMessage {
  messageId: string;
  body: string;
  receiptHandle: string;
}

export interface SqsConsumer {
  receive(waitSeconds: number, maxMessages: number): Promise<SqsMessage[]>;
  delete(receiptHandle: string): Promise<void>;
  /**
   * Devolve a mensagem para a fila (não deleta). SQS usa VisibilityTimeout,
   * então isso só é útil em erros fatais.
   */
  nack(receiptHandle: string): Promise<void>;
  shutdown(): Promise<void>;
}
