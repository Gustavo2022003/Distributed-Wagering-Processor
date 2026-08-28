import { OutboxMessage } from '../domain/outbox-message';

export abstract class OutboxPublisher {
  abstract publish(event: OutboxMessage): Promise<void>;
}
