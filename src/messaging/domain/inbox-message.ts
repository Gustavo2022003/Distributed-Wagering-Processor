// src/messaging/domain/inbox-message.ts
//
// InboxMessage é o registro de que uma mensagem de um consumer foi recebida
// e está sendo (ou foi) processada. Garante deduplicação at-least-once:
// se a mesma (consumerName, messageId) chegar de novo, a UNIQUE constraint
// do banco bloqueia a duplicata, e o consumer reconhece como replay.
//
// Seção 6.5 do README.

import { DomainError } from '../../shared/errors/domain-error';

export class InboxAlreadyProcessedError extends DomainError {
  readonly code = 'INBOX_ALREADY_PROCESSED';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Estado reidratável
// ─────────────────────────────────────────────────────────────────────────────

export interface InboxMessageState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | undefined;
}

export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  now?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Classe
// ─────────────────────────────────────────────────────────────────────────────

export class InboxMessage {
  public readonly messageId: string;
  public readonly consumerName: string;
  public readonly payloadHash: string;
  public readonly receivedAt: Date;
  private _processedAt: Date | undefined;

  private constructor(state: InboxMessageState) {
    this.messageId = state.messageId;
    this.consumerName = state.consumerName;
    this.payloadHash = state.payloadHash;
    this.receivedAt = state.receivedAt;
    this._processedAt = state.processedAt;
  }

  /**
   * Registra o recebimento de uma mensagem. Nasce ainda não processada.
   * A UNIQUE constraint do banco (consumer_name, message_id) garante que
   * uma segunda chamada com mesma chave falha com erro de constraint,
   * e o caller sabe que é replay.
   */
  static receive(props: ReceiveInboxProps): InboxMessage {
    if (!props.messageId || props.messageId.trim() === '') {
      throw new Error('InboxMessage.messageId must be non-empty');
    }
    if (!props.consumerName || props.consumerName.trim() === '') {
      throw new Error('InboxMessage.consumerName must be non-empty');
    }

    return new InboxMessage({
      messageId: props.messageId,
      consumerName: props.consumerName,
      payloadHash: props.payloadHash,
      receivedAt: props.now ?? new Date(),
      processedAt: undefined,
    });
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(state);
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  /**
   * Marca como processada após o commit do processamento principal.
   * Só pode ser chamado uma vez — segunda chamada é erro de programação.
   */
  markProcessed(at: Date): void {
    if (this._processedAt !== undefined) {
      throw new InboxAlreadyProcessedError(
        `InboxMessage ${this.consumerName}:${this.messageId} already processed at ${this._processedAt.toISOString()}`,
      );
    }
    this._processedAt = at;
  }
}
