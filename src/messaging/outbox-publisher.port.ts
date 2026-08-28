import { OutboxMessage } from '../domain/outbox-message';

export interface OutboxPublisher {
  publish(event: OutboxMessage): Promise<void>;
}
