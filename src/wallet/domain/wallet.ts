import { Money } from '../../shared/money';
import { DomainError } from '../../shared/errors/domain-error';
import { WagerTransaction, LedgerDirection } from '../../wagering/domain/wager-transaction';

// ─────────────────────────────────────────────────────────────────────────────
//  Erros de domínio
// ─────────────────────────────────────────────────────────────────────────────

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';
}

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';
  constructor(public readonly currentBalance: string, public readonly required: string) {
    super(`Insufficient funds: balance=${currentBalance}, required=${required}`);
  }
}

export class NegativeAmountError extends DomainError {
  readonly code = 'NEGATIVE_AMOUNT';
  constructor(detail: string) {
    super(detail);
  }
}

export class ZeroAmountError extends DomainError {
  readonly code = 'ZERO_AMOUNT';
  constructor() {
    super('Operation amount must be positive');
  }
}

export class WalletClosedError extends DomainError {
  readonly code = 'WALLET_CLOSED';
  constructor() {
    super('Wallet is closed and cannot be operated on');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Estado reidratável
// ─────────────────────────────────────────────────────────────────────────────

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: { amount: string; currency: string };
  version: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | undefined;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  now?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MovementPlan — o que a wallet devolve para o use case persistir
// ─────────────────────────────────────────────────────────────────────────────

export interface MovementPlan {
  walletId: string;
  playerId: string;
  direction: LedgerDirection;
  money: Money;                  // valor movimentado
  balanceBefore: Money;
  balanceAfter: Money;
  newVersion: number;            // version DEPOIS do movimento
  newUpdatedAt: Date;
  entryProps: CreateLedgerEntryProps;
}

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyPropsLike;
  balanceBefore: MoneyPropsLike;
  balanceAfter: MoneyPropsLike;
  createdAt: Date;
}

interface MoneyPropsLike {
  amount: string;
  currency: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Aggregate Root
// ─────────────────────────────────────────────────────────────────────────────

export class Wallet {
  public readonly id: string;
  public readonly playerId: string;
  public readonly currency: string;
  public readonly createdAt: Date;
  private _balance: Money;
  private _version: number;
  private _updatedAt: Date;
  private _closedAt: Date | undefined;

  private constructor(state: WalletState) {
    this.id = state.id;
    this.playerId = state.playerId;
    this.currency = state.currency;
    this._balance = Money.from(state.balance.amount, state.balance.currency);
    this._version = state.version;
    this._updatedAt = state.updatedAt;
    this._closedAt = state.closedAt;
    this.createdAt = state.createdAt;
  }

  // ─── factories ──────────────────────────────────────────────────────────

  static open(props: OpenWalletProps): Wallet {
    if (props.initialBalance.isNegative()) {
      throw new NegativeAmountError('Initial balance cannot be negative');
    }

    const now = props.now ?? new Date();
    return new Wallet({
      id: props.id,
      playerId: props.playerId,
      currency: props.initialBalance.currency,
      balance: props.initialBalance.toJSON(),
      version: 1,
      createdAt: now,
      updatedAt: now,
      closedAt: undefined,
    });
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(state);
  }

  // ─── getters ────────────────────────────────────────────────────────────

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get closedAt(): Date | undefined {
    return this._closedAt;
  }

  isClosed(): boolean {
    return this._closedAt !== undefined;
  }


  // ─── operações de saldo ──────────────────────────────────────────────────

  debit(props: {
    money: Money;
    transactionId: string;
    entryId: string;
    now?: Date;
  }): MovementPlan {
    this.assertNotClosed();
    this.assertSameCurrency(props.money);
    this.assertPositive(props.money);

    const balanceAfter = this._balance.subtract(props.money);
    if (balanceAfter.isNegative()) {
      throw new InsufficientFundsError(
        this._balance.amount,
        props.money.amount,
      );
    }

    const balanceBefore = this._balance;
    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = props.now ?? new Date();

    return {
      walletId: this.id,
      playerId: this.playerId,
      direction: LedgerDirection.Debit,
      money: props.money,
      balanceBefore,
      balanceAfter,
      newVersion: this._version,
      newUpdatedAt: this._updatedAt,
      entryProps: {
        id: props.entryId,
        walletId: this.id,
        transactionId: props.transactionId,
        direction: LedgerDirection.Debit,
        money: props.money.toJSON(),
        balanceBefore: balanceBefore.toJSON(),
        balanceAfter: balanceAfter.toJSON(),
        createdAt: this._updatedAt,
      },
    };
  }

  credit(props: {
    money: Money;
    transactionId: string;
    entryId: string;
    now?: Date;
  }): MovementPlan {
    this.assertNotClosed();
    this.assertSameCurrency(props.money);
    this.assertPositive(props.money);

    const balanceBefore = this._balance;
    const balanceAfter = this._balance.add(props.money);
    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = props.now ?? new Date();

    return {
      walletId: this.id,
      playerId: this.playerId,
      direction: LedgerDirection.Credit,
      money: props.money,
      balanceBefore,
      balanceAfter,
      newVersion: this._version,
      newUpdatedAt: this._updatedAt,
      entryProps: {
        id: props.entryId,
        walletId: this.id,
        transactionId: props.transactionId,
        direction: LedgerDirection.Credit,
        money: props.money.toJSON(),
        balanceBefore: balanceBefore.toJSON(),
        balanceAfter: balanceAfter.toJSON(),
        createdAt: this._updatedAt,
      },
    };
  }

  // ─── invariantes privadas ───────────────────────────────────────────────

  private assertNotClosed(): void {
    if (this.isClosed()) {
      throw new WalletClosedError();
    }
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(
        `Wallet currency is ${this.currency}, operation is ${money.currency}`,
      );
    }
  }

  private assertPositive(money: Money): void {
    if (money.isZero()) {
      throw new ZeroAmountError();
    }
    if (money.isNegative()) {
      throw new NegativeAmountError(
        `Operation amount must be positive, got ${money.amount}`,
      );
    }
  }
}
