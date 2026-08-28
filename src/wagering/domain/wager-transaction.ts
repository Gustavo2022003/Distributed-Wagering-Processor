import { createHash } from 'node:crypto';
import { Money, MoneyProps } from '../../shared/money';
import { DomainError } from '../../shared/errors/domain-error';
import { FailureCode } from '../../shared/failure-codes';

// ─────────────────────────────────────────────────────────────────────────────
//  Enums e tipos de contrato
// ─────────────────────────────────────────────────────────────────────────────

export enum WagerTransactionKind {
  Opening  = 'OPENING',
  Bet      = 'BET',
  Win      = 'WIN',
  Loss     = 'LOSS',
  Refund   = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending          = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed        = 'PROCESSED',
  Rejected         = 'REJECTED',
  Failed           = 'FAILED',
}

export enum LedgerDirection {
  Debit  = 'DEBIT',
  Credit = 'CREDIT',
}

// Payload

export interface WagerTransactionBusinessPayload {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Erros de domínio específicos
// ─────────────────────────────────────────────────────────────────────────────

export class InvalidTransactionStateError extends DomainError {
  readonly code = 'INVALID_TRANSACTION_STATE';
}

export class PayloadConflictError extends DomainError {
  readonly code = 'PAYLOAD_CONFLICT';
  constructor(public readonly existingHash: string, public readonly incomingHash: string) {
    super(
      `Idempotency key already used with a different payload. ` +
      `Existing hash: ${existingHash}, incoming: ${incomingHash}`,
    );
  }
}

export class OpeningNotAllowedError extends DomainError {
  readonly code = 'OPENING_NOT_ALLOWED';
  constructor() {
    super('OPENING is internal and cannot be created from external input');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Estados reidratáveis (shape que o repository entrega para `rehydrate`)
// ─────────────────────────────────────────────────────────────────────────────

// Validação de dados que vem e vão do banco de dados
export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  processedAt: Date | undefined;
  correlationId?: string;
  attempts?: number;
  nextAttemptAt?: Date;
}


// Validação de dados externos (HTTP/SQS)
export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  now?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Classe
// ─────────────────────────────────────────────────────────────────────────────

export class WagerTransaction {
  // Identidade e dados de proveniência
  public readonly id: string;
  public readonly providerId: string;
  public readonly externalTransactionId: string;
  public readonly idempotencyKey: string;
  public readonly payloadHash: string;
  public readonly walletId: string;
  public readonly playerId: string;
  public readonly roundId: string;
  public readonly gameId: string;
  public readonly kind: WagerTransactionKind;
  public readonly money: Money;
  public readonly referenceExternalTransactionId: string | undefined;
  public readonly createdAt: Date;
  public readonly correlationId?: string;

  // Estado mutável de transição (mas o objeto NÃO é mutável fora dos métodos)
  private _status: WagerTransactionStatus;
  private _referenceTransactionId: string | undefined;
  private _failureCode: FailureCode | undefined;
  private _processedAt: Date | undefined;
  private _attempts: number;
  private _nextAttemptAt: Date | undefined;

  // ─── factories ──────────────────────────────────────────────────────────

  private constructor(state: WagerTransactionState) {
    this.id = state.id;
    this.providerId = state.providerId;
    this.externalTransactionId = state.externalTransactionId;
    this.idempotencyKey = state.idempotencyKey;
    this.payloadHash = state.payloadHash;
    this.walletId = state.walletId;
    this.playerId = state.playerId;
    this.roundId = state.roundId;
    this.gameId = state.gameId;
    this.kind = state.kind;
    this.money = Money.from(state.money.amount, state.money.currency);
    this.referenceExternalTransactionId = state.referenceExternalTransactionId;
    this.createdAt = state.createdAt;
    this._status = state.status;
    this._referenceTransactionId = state.referenceTransactionId;
    this._failureCode = state.failureCode;
    this._processedAt = state.processedAt;
    this.correlationId = state.correlationId;
    this._attempts = state.attempts ?? 0;
    this._nextAttemptAt = state.nextAttemptAt;
  }


  static create(props: CreateWagerTransactionProps): WagerTransaction {

    if (props.kind === WagerTransactionKind.Opening) {
      throw new OpeningNotAllowedError();
    }

    if (
      (props.kind === WagerTransactionKind.Refund ||
        props.kind === WagerTransactionKind.Rollback) &&
      !props.referenceExternalTransactionId
    ) {
      throw new InvalidTransactionStateError(
        `${props.kind} requires referenceExternalTransactionId`,
      );
    }

    const now = props.now ?? new Date();

    return new WagerTransaction({
      id: props.id,
      providerId: props.providerId,
      externalTransactionId: props.externalTransactionId,
      idempotencyKey: props.idempotencyKey,
      payloadHash: props.payloadHash,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: props.roundId,
      gameId: props.gameId,
      kind: props.kind,
      money: props.money.toJSON(),
      referenceExternalTransactionId: props.referenceExternalTransactionId,
      createdAt: now,
      status: WagerTransactionStatus.Pending,
      referenceTransactionId: undefined,
      failureCode: undefined,
      processedAt: undefined,
    });
  }


  static createOpening(props: {
    id: string;
    walletId: string;
    playerId: string;
    money: Money;
    now?: Date;
  }): WagerTransaction {
    const now = props.now ?? new Date();
    const payloadHash = computeOpeningHash(props.id); // Idempotencia

    return new WagerTransaction({
      id: props.id,
      providerId: 'internal',
      externalTransactionId: props.id,
      idempotencyKey: `internal:opening:${props.id}`,
      payloadHash,
      walletId: props.walletId,
      playerId: props.playerId,
      roundId: 'opening',
      gameId: 'opening',
      kind: WagerTransactionKind.Opening,
      money: props.money.toJSON(),
      referenceExternalTransactionId: undefined,
      createdAt: now,
      status: WagerTransactionStatus.Processed,
      referenceTransactionId: undefined,
      failureCode: undefined,
      processedAt: now,
    });
  }


  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(state);
  }

  // ─── getters ────────────────────────────────────────────────────────────

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  // ─── transições ─────────────────────────────────────────────────────────

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        `Transaction ${this.id} is in terminal state ${this._status}; ` +
        `cannot transition`,
      );
    }
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._failureCode = undefined;
  }

  markPendingReference(now: Date, baseBackoffMs: number, maxBackoffMs: number): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.PendingReference;
    this._nextAttemptAt = computeNextAttempt(this.createdAt, now, this._attempts, baseBackoffMs, maxBackoffMs);
  }

  schedulePendingReferenceRetry(now: Date, baseBackoffMs: number, maxBackoffMs: number): void {
    this._attempts += 1;
    this._nextAttemptAt = computeNextAttempt(this.createdAt, now, this._attempts, baseBackoffMs, maxBackoffMs);
  }

  reject(code: FailureCode, at: Date): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = at;
  }

  fail(code: FailureCode, at: Date): void {
    this.assertNotTerminal();
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = at;
  }

  // ─── consultas de domínio ───────────────────────────────────────────────

  isTerminal(): boolean {
    return (
      this._status === WagerTransactionStatus.Processed ||
      this._status === WagerTransactionStatus.Rejected ||
      this._status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    if (this.isTerminal() && this._status !== WagerTransactionStatus.Processed) {
      return false;
    }
    if (this.kind === WagerTransactionKind.Loss) return false;
    if (this.kind === WagerTransactionKind.Opening) return true;
    return true;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund ||
      this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    if (this.kind === WagerTransactionKind.Opening) return LedgerDirection.Credit;
    if (this.kind === WagerTransactionKind.Bet)     return LedgerDirection.Debit;
    if (this.kind === WagerTransactionKind.Win)     return LedgerDirection.Credit;
    if (this.kind === WagerTransactionKind.Loss)    return LedgerDirection.Debit;
    if (!reference) {
      throw new InvalidTransactionStateError(
        `${this.kind} requires a resolved reference to compute ledger direction`,
      );
    }
    if (this.kind === WagerTransactionKind.Refund) {
      if (reference.kind !== WagerTransactionKind.Bet) {
        throw new InvalidTransactionStateError(
          `REFUND must reference a BET; got ${reference.kind}`,
        );
      }
      return LedgerDirection.Credit;
    }
    if (this.kind === WagerTransactionKind.Rollback) {
      return reference.ledgerDirectionFor() === LedgerDirection.Debit
        ? LedgerDirection.Credit
        : LedgerDirection.Debit;
    }
    throw new InvalidTransactionStateError(`Unknown kind: ${this.kind}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hash de payload canônico
// ─────────────────────────────────────────────────────────────────────────────

export function computePayloadHash(payload: WagerTransactionBusinessPayload): string {
  const canonical = canonicalize(payload);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

function computeOpeningHash(id: string): string {
  return createHash('sha256').update(`opening:${id}`).digest('hex');
}

export function computeNextAttempt(
  createdAt: Date,
  now: Date,
  attempts: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
): Date {
  const exp = Math.min(Math.pow(2, attempts) * baseBackoffMs, maxBackoffMs);
  return new Date(now.getTime() + exp);
}
