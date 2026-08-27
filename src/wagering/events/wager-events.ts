import { MoneyProps } from '../../shared/money';
import { IntegrationEvent, IntegrationEventProps } from '../../shared/events/integration-event';
import { LedgerDirection } from '../domain/wager-transaction';

// ─────────────────────────────────────────────────────────────────────────────
//  EventContext
// ─────────────────────────────────────────────────────────────────────────────

export interface EventContext {
  eventId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
//  WagerTransactionProcessed
// ─────────────────────────────────────────────────────────────────────────────

export interface WagerTransactionProcessedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  status: string;
  money: MoneyProps;
  referenceTransactionId?: string;
  referenceExternalTransactionId?: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(props: {
    transactionId: string;
    providerId: string;
    externalTransactionId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: MoneyProps;
    referenceTransactionId?: string;
    referenceExternalTransactionId?: string;
    ctx: EventContext;
  }): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      eventId: props.ctx.eventId,
      aggregateId: props.walletId,
      correlationId: props.ctx.correlationId,
      causationId: props.ctx.causationId,
      occurredAt: props.ctx.occurredAt,
      data: {
        transactionId: props.transactionId,
        providerId: props.providerId,
        externalTransactionId: props.externalTransactionId,
        playerId: props.playerId,
        walletId: props.walletId,
        roundId: props.roundId,
        gameId: props.gameId,
        kind: props.kind,
        status: 'PROCESSED',
        money: props.money,
        referenceTransactionId: props.referenceTransactionId,
        referenceExternalTransactionId: props.referenceExternalTransactionId,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  WagerTransactionRejected
// ─────────────────────────────────────────────────────────────────────────────

export interface WagerTransactionRejectedData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  status: string;
  failureCode: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(props: {
    transactionId: string;
    providerId: string;
    externalTransactionId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: string;
    failureCode: string;
    money: MoneyProps;
    referenceExternalTransactionId?: string;
    ctx: EventContext;
  }): WagerTransactionRejected {
    return new WagerTransactionRejected({
      eventId: props.ctx.eventId,
      aggregateId: props.walletId,
      correlationId: props.ctx.correlationId,
      causationId: props.ctx.causationId,
      occurredAt: props.ctx.occurredAt,
      data: {
        transactionId: props.transactionId,
        providerId: props.providerId,
        externalTransactionId: props.externalTransactionId,
        playerId: props.playerId,
        walletId: props.walletId,
        roundId: props.roundId,
        gameId: props.gameId,
        kind: props.kind,
        status: 'REJECTED',
        failureCode: props.failureCode,
        money: props.money,
        referenceExternalTransactionId: props.referenceExternalTransactionId,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  WagerTransactionPendingReference
// ─────────────────────────────────────────────────────────────────────────────

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(props: {
    transactionId: string;
    providerId: string;
    externalTransactionId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: string;
    money: MoneyProps;
    referenceExternalTransactionId: string;
    ctx: EventContext;
  }): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference({
      eventId: props.ctx.eventId,
      aggregateId: props.walletId,
      correlationId: props.ctx.correlationId,
      causationId: props.ctx.causationId,
      occurredAt: props.ctx.occurredAt,
      data: {
        transactionId: props.transactionId,
        providerId: props.providerId,
        externalTransactionId: props.externalTransactionId,
        playerId: props.playerId,
        walletId: props.walletId,
        roundId: props.roundId,
        gameId: props.gameId,
        kind: props.kind,
        money: props.money,
        referenceExternalTransactionId: props.referenceExternalTransactionId,
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  WalletBalanceChanged
// ─────────────────────────────────────────────────────────────────────────────

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(props: {
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    money: MoneyProps;
    balanceBefore: MoneyProps;
    balanceAfter: MoneyProps;
    walletVersion: number;
    ctx: EventContext;
  }): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: props.ctx.eventId,
      aggregateId: props.walletId,
      correlationId: props.ctx.correlationId,
      causationId: props.ctx.causationId,
      occurredAt: props.ctx.occurredAt,
      data: {
        walletId: props.walletId,
        transactionId: props.transactionId,
        direction: props.direction,
        money: props.money,
        balanceBefore: props.balanceBefore,
        balanceAfter: props.balanceAfter,
        walletVersion: props.walletVersion,
      },
    });
  }
}
