// src/wagering/persistence/wager-transaction.mapper.ts

import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type WagerTransactionState,
} from '../domain/wager-transaction';
import { WagerTransactionEntity } from './wager-transaction.entity';

export const WagerTransactionMapper = {
  toDomain(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind as WagerTransactionKind,
      money: { amount: entity.moneyAmount, currency: entity.moneyCurrency },
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      createdAt: entity.createdAt,
      status: entity.status as WagerTransactionStatus,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: (entity.failureCode as any) ?? undefined,
      processedAt: entity.processedAt,
      correlationId: entity.correlationId,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt,
    });
  },

  toEntity(domain: WagerTransaction): WagerTransactionEntity {
    const e = new WagerTransactionEntity();
    e.id = domain.id;
    e.providerId = domain.providerId;
    e.externalTransactionId = domain.externalTransactionId;
    e.idempotencyKey = domain.idempotencyKey;
    e.payloadHash = domain.payloadHash;
    e.walletId = domain.walletId;
    e.playerId = domain.playerId;
    e.roundId = domain.roundId;
    e.gameId = domain.gameId;
    e.kind = domain.kind;
    e.moneyAmount = domain.money.amount;
    e.moneyCurrency = domain.money.currency;
    e.referenceExternalTransactionId = domain.referenceExternalTransactionId;
    e.referenceTransactionId = undefined;
    e.createdAt = domain.createdAt;
    e.status = domain.status;
    e.failureCode = domain.failureCode as any;
    e.processedAt = domain.processedAt;
    e.correlationId = domain.correlationId;
    e.attempts = domain.attempts;
    e.nextAttemptAt = domain.nextAttemptAt;
    return e;
  },

  toStateSnapshot(domain: WagerTransaction): WagerTransactionState {
    return {
      id: domain.id,
      providerId: domain.providerId,
      externalTransactionId: domain.externalTransactionId,
      idempotencyKey: domain.idempotencyKey,
      payloadHash: domain.payloadHash,
      walletId: domain.walletId,
      playerId: domain.playerId,
      roundId: domain.roundId,
      gameId: domain.gameId,
      kind: domain.kind,
      money: { amount: domain.money.amount, currency: domain.money.currency },
      referenceExternalTransactionId: domain.referenceExternalTransactionId,
      createdAt: domain.createdAt,
      status: domain.status,
      referenceTransactionId: undefined,
      failureCode: domain.failureCode,
      processedAt: domain.processedAt,
    };
  },
};
