// src/wagering/application/sqs-message.ts
//
// Schema da mensagem SQS (wager-transactions.fifo). Diferente do envelope
// de IntegrationEvent (genérico) — este é dedicado ao SQS do provedor,
// conforme seção 10 do README.

import { WagerTransactionKind } from '../domain/wager-transaction';
import { MoneyProps } from '../../shared/money';

export interface WagerTransactionRequestedMessage {
  messageId: string;
  type: 'WagerTransactionRequested';
  occurredAt: string;
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: MoneyProps;
    referenceExternalTransactionId?: string;
  };
}
