import { EntityManager } from '@mikro-orm/core';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../domain/wager-transaction';
import { WagerTransactionMapper } from './wager-transaction.mapper';
import { WagerTransactionEntity } from './wager-transaction.entity';

export class WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { id });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { idempotencyKey });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByProviderExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findExistingReversal(
    providerId: string,
    referenceExternalTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      referenceExternalTransactionId,
      kind,
      status: WagerTransactionStatus.Processed,
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async insert(tx: WagerTransaction): Promise<void> {
    const entity = WagerTransactionMapper.toEntity(tx);
    this.em.persist(entity);
  }

  async update(tx: WagerTransaction): Promise<void> {
    await this.em.execute(
      `UPDATE wager_transactions
          SET status = ?,
              reference_transaction_id = ?,
              failure_code = ?,
              processed_at = ?,
              correlation_id = ?,
              attempts = ?,
              next_attempt_at = ?
        WHERE id = ?::uuid`,
      [
        tx.status,
        tx.referenceTransactionId ?? null,
        tx.failureCode ?? null,
        tx.processedAt ?? null,
        tx.correlationId ?? null,
        tx.attempts,
        tx.nextAttemptAt ?? null,
        tx.id,
      ],
      'run',
    );
  }

  async findDuePendingReferences(now: Date, limit: number): Promise<WagerTransaction[]> {
    const rows: any[] = await this.em.getConnection().execute(
      `SELECT id, provider_id, external_transaction_id, idempotency_key, payload_hash,
              wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency,
              reference_external_transaction_id, reference_transaction_id, created_at,
              status, failure_code, processed_at, correlation_id, attempts, next_attempt_at
       FROM wager_transactions
       WHERE status = 'PENDING_REFERENCE'
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY next_attempt_at ASC NULLS FIRST
       LIMIT ?`,
      [now, limit],
    );
    console.log('DEBUG findDuePendingReferences rows:', rows.length, 'attempts:', rows.map(r => r.attempts));
    return rows.map((row) => WagerTransactionMapper.toDomain(this.rowToEntity(row)));
  }

  private rowToEntity(row: any): WagerTransactionEntity {
    const e = new WagerTransactionEntity();
    e.id = row.id;
    e.providerId = row.provider_id;
    e.externalTransactionId = row.external_transaction_id;
    e.idempotencyKey = row.idempotency_key;
    e.payloadHash = row.payload_hash;
    e.walletId = row.wallet_id;
    e.playerId = row.player_id;
    e.roundId = row.round_id;
    e.gameId = row.game_id;
    e.kind = row.kind;
    e.moneyAmount = row.money_amount;
    e.moneyCurrency = row.money_currency;
    e.referenceExternalTransactionId = row.reference_external_transaction_id;
    e.referenceTransactionId = row.reference_transaction_id;
    e.createdAt = row.created_at;
    e.status = row.status;
    e.failureCode = row.failure_code;
    e.processedAt = row.processed_at;
    e.correlationId = row.correlation_id;
    e.attempts = row.attempts !== undefined ? Number(row.attempts) : 0;
    e.nextAttemptAt = row.next_attempt_at ? new Date(row.next_attempt_at) : undefined;
    return e;
  }
}
