// src/wagering/application/consume-wager-transaction.use-case.ts
//
// Orquestra o consumo de uma mensagem SQS do tipo WagerTransactionRequested:
//   1. dedup via inbox (consumer_name + message_id)
//   2. parse do body
//   3. delega ao ProcessWagerTransactionUseCase (reuso da Fase 3)
//   4. marca inbox como processado (commit)
//   5. ack no SQS (DEPOIS do commit)
//
// Erros:
//   - TerminalBusinessError: ack + skip (não adianta retry)
//   - TransientInfraError: nack (volta pra fila, retry com backoff)
//   - PermanentInfraError: ack (DLQ via redrive policy do SQS)

import { createHash } from 'node:crypto';
import { EntityManager } from '@mikro-orm/core';
import { v4 as uuid } from 'uuid';
import { Money } from '../../shared/money';
import { ProcessWagerTransactionUseCase, type ProcessWagerTransactionDto } from './process-wager-transaction.use-case';
import { TerminalBusinessError, TransientInfraError, PermanentInfraError } from './errors';
import type { SqsConsumer, SqsMessage } from '../../messaging/sqs-consumer.contract';
import { InboxMessageRepository } from '../../messaging/persistence/inbox-message.repository';
import { WagerTransactionRequestedMessage } from './sqs-message';

export const CONSUMER_NAME = 'wager-transaction-consumer';

export class ConsumeWagerTransactionUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly consumer: SqsConsumer,
    private readonly inboxRepo: InboxMessageRepository,
    private readonly processUseCase: ProcessWagerTransactionUseCase,
  ) {}

  async processOne(msg: SqsMessage): Promise<{ action: 'ack' | 'nack'; reason?: string }> {
    const payloadHash = sha256(msg.body);

    // 1. Inbox dedup
    const inboxResult = await this.inboxRepo.tryInsert(
      CONSUMER_NAME,
      msg.messageId,
      payloadHash,
      new Date(),
    );

    if (!inboxResult.inserted) {
      // Já vimos essa mensagem — ack sem reprocessar
      await this.consumer.delete(msg.receiptHandle);
      return { action: 'ack', reason: 'duplicate' };
    }

    // 2. Parse
    let parsed: WagerTransactionRequestedMessage;
    try {
      parsed = JSON.parse(msg.body) as WagerTransactionRequestedMessage;
    } catch {
      await this.inboxRepo.markProcessed(CONSUMER_NAME, msg.messageId, new Date());
      await this.consumer.delete(msg.receiptHandle);
      return { action: 'ack', reason: 'invalid-json' };
    }

    if (parsed.type !== 'WagerTransactionRequested') {
      await this.inboxRepo.markProcessed(CONSUMER_NAME, msg.messageId, new Date());
      await this.consumer.delete(msg.receiptHandle);
      return { action: 'ack', reason: 'wrong-type' };
    }

    // 3. Mapeia para o DTO do use case
    const dto: ProcessWagerTransactionDto = {
      id: uuid(),
      providerId: parsed.data.providerId,
      externalTransactionId: parsed.data.externalTransactionId,
      idempotencyKey: parsed.data.idempotencyKey,
      payloadHash,
      playerId: parsed.data.playerId,
      walletId: parsed.data.walletId,
      roundId: parsed.data.roundId,
      gameId: parsed.data.gameId,
      kind: parsed.data.kind,
      money: parsed.data.money,
      referenceExternalTransactionId: parsed.data.referenceExternalTransactionId,
      correlationId: msg.messageId,
      now: new Date(parsed.occurredAt),
    };

    // 4. Processa
    try {
      await this.processUseCase.execute(dto);
    } catch (err) {
      const e = err as Error;
      if (e instanceof TerminalBusinessError) {
        // Regras de negócio que não mudam com retry: ack e segue
        await this.inboxRepo.markProcessed(CONSUMER_NAME, msg.messageId, new Date());
        await this.consumer.delete(msg.receiptHandle);
        return { action: 'ack', reason: 'terminal-business' };
      }
      if (e instanceof TransientInfraError) {
        // Retry com backoff: nack (devolve pra fila imediatamente)
        // O inbox fica como está (não-processado) — se reprocessar,
        // o use case replay devolve o mesmo resultado
        await this.consumer.nack(msg.receiptHandle);
        return { action: 'nack', reason: 'transient-infra' };
      }
      if (e instanceof PermanentInfraError) {
        // Erro permanente: ack (SQS joga na DLQ via redrive policy após N tentativas
        // — mas como marcamos processed, a próxima vez é dedup)
        await this.inboxRepo.markProcessed(CONSUMER_NAME, msg.messageId, new Date());
        await this.consumer.delete(msg.receiptHandle);
        return { action: 'ack', reason: 'permanent-infra' };
      }
      // Erro desconhecido: tratar como transient
      await this.consumer.nack(msg.receiptHandle);
      return { action: 'nack', reason: 'unknown' };
    }

    // 5. Commit + ack
    await this.inboxRepo.markProcessed(CONSUMER_NAME, msg.messageId, new Date());
    await this.consumer.delete(msg.receiptHandle);
    return { action: 'ack' };
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
