// src/messaging/domain/outbox-message.ts
//
// OutboxMessage é a representação em domínio de um evento enfileirado para
// publicação. O worker de outbox lê esses registros, publica no SQS, e
// marca como publicado. Backoff exponencial é responsabilidade do worker
// (scheduleRetry calcula o próximo nextAttemptAt).
//
// Seção 6.5 e 11 do README.

import { IntegrationEvent } from '../../shared/events/integration-event';
import { DomainError } from '../../shared/errors/domain-error';

export class OutboxAlreadyPublishedError extends DomainError {
  readonly code = 'OUTBOX_ALREADY_PUBLISHED';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Estado reidratável
// ─────────────────────────────────────────────────────────────────────────────

export interface OutboxMessageState {
  id: string;
  eventId: string;
  aggregateId: string;
  eventType: string;
  correlationId: string;
  causationId: string | undefined;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | undefined;
  publishedAt: Date | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Classe
// ─────────────────────────────────────────────────────────────────────────────

export class OutboxMessage {
  public readonly id: string;
  public readonly eventId: string;
  public readonly aggregateId: string;
  public readonly eventType: string;
  public readonly correlationId: string;
  public readonly causationId: string | undefined;
  public readonly payload: Readonly<Record<string, unknown>>;
  public readonly occurredAt: Date;
  private _attempts: number;
  private _nextAttemptAt: Date | undefined;
  private _publishedAt: Date | undefined;

  private constructor(state: OutboxMessageState) {
    this.id = state.id;
    this.eventId = state.eventId;
    this.aggregateId = state.aggregateId;
    this.eventType = state.eventType;
    this.correlationId = state.correlationId;
    this.causationId = state.causationId;
    this.payload = Object.freeze({ ...state.payload });
    this.occurredAt = state.occurredAt;
    this._attempts = state.attempts;
    this._nextAttemptAt = state.nextAttemptAt;
    this._publishedAt = state.publishedAt;
  }

  /**
   * Enfileira um IntegrationEvent para publicação.
   * O payload é o envelope serializado (via IntegrationEvent.toEnvelope()).
   */
  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    const env = event.toEnvelope();
    return new OutboxMessage({
      id: event.eventId, // eventId é único; usamos como id da outbox também
      eventId: event.eventId,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      correlationId: event.correlationId,
      causationId: event.causationId,
      payload: env as unknown as Record<string, unknown>,
      occurredAt: event.occurredAt,
      attempts: 0,
      nextAttemptAt: event.occurredAt, // disponível imediatamente
      publishedAt: undefined,
    });
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(state);
  }

  // ─── getters ────────────────────────────────────────────────────────────

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  // ─── consultas ──────────────────────────────────────────────────────────

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    if (!this.isPending()) return false;
    if (this._nextAttemptAt === undefined) return true;
    return this._nextAttemptAt <= now;
  }

  // ─── transições ─────────────────────────────────────────────────────────

  /**
   * Marca como publicado após confirmação do broker.
   * Só pode ser chamado uma vez.
   */
  markPublished(at: Date): void {
    if (this._publishedAt !== undefined) {
      throw new OutboxAlreadyPublishedError(
        `OutboxMessage ${this.id} already published at ${this._publishedAt.toISOString()}`,
      );
    }
    this._publishedAt = at;
    this._nextAttemptAt = undefined;
  }

  /**
   * Incrementa attempts e calcula o próximo nextAttemptAt com backoff
   * exponencial. Backoff: 2^attempts segundos, capped em 1h.
   *
   *   attempts=1 → 2s
   *   attempts=2 → 4s
   *   attempts=3 → 8s
   *   ...
   *   attempts=12 → 4096s (cap)
   */
  scheduleRetry(now: Date): void {
    if (!this.isPending()) {
      throw new OutboxAlreadyPublishedError(
        `Cannot retry published OutboxMessage ${this.id}`,
      );
    }
    this._attempts += 1;
    const backoffSeconds = Math.min(Math.pow(2, this._attempts), 3600);
    this._nextAttemptAt = new Date(now.getTime() + backoffSeconds * 1000);
  }
}
