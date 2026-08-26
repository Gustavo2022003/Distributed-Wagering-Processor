import { Money, MoneyProps } from '../../shared/money';
import { DomainError } from '../../shared/errors/domain-error';
import { LedgerDirection } from '../../wagering/domain/wager-transaction';

// ─────────────────────────────────────────────────────────────────────────────
//  Erro de domínio
// ─────────────────────────────────────────────────────────────────────────────

export class UnbalancedLedgerEntryError extends DomainError {
  readonly code = 'UNBALANCED_LEDGER_ENTRY';
  constructor(detail: string) {
    super(detail);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Estado reidratável
// ─────────────────────────────────────────────────────────────────────────────

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: Date;
}

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  now?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Classe
// ─────────────────────────────────────────────────────────────────────────────

export class WalletLedgerEntry {
  public readonly id: string;
  public readonly walletId: string;
  public readonly transactionId: string;
  public readonly direction: LedgerDirection;
  public readonly money: Money;
  public readonly balanceBefore: Money;
  public readonly balanceAfter: Money;
  public readonly createdAt: Date;

  private constructor(state: LedgerEntryState) {
    this.id = state.id;
    this.walletId = state.walletId;
    this.transactionId = state.transactionId;
    this.direction = state.direction;
    this.money = Money.from(state.money.amount, state.money.currency);
    this.balanceBefore = Money.from(state.balanceBefore.amount, state.balanceBefore.currency);
    this.balanceAfter = Money.from(state.balanceAfter.amount, state.balanceAfter.currency);
    this.createdAt = state.createdAt;
  }

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const money = Money.from(props.money.amount, props.money.currency);
    const before = Money.from(props.balanceBefore.amount, props.balanceBefore.currency);
    const after = Money.from(props.balanceAfter.amount, props.balanceAfter.currency);


    // Validação dos valores de entrada ou saída (credit/debit)
    if (money.currency !== before.currency || money.currency !== after.currency) {
      throw new UnbalancedLedgerEntryError(
        `Currency mismatch in entry: money=${money.currency}, ` +
        `before=${before.currency}, after=${after.currency}`,
      );
    }

    const expected = props.direction === LedgerDirection.Debit ? before.subtract(money) : before.add(money);

    if (!expected.equals(after)) {
      throw new UnbalancedLedgerEntryError(
        `Unbalanced entry: ${props.direction} of ${money.amount} ${money.currency} ` +
        `on balance ${before.amount} should result in ${expected.amount}, got ${after.amount}`,
      );
    }

    return new WalletLedgerEntry({
      id: props.id,
      walletId: props.walletId,
      transactionId: props.transactionId,
      direction: props.direction,
      money: props.money,
      balanceBefore: props.balanceBefore,
      balanceAfter: props.balanceAfter,
      createdAt: props.now ?? new Date(),
    });
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(state);
  }

  isBalanced(): boolean {
    const expected = this.direction === LedgerDirection.Debit
      ? this.balanceBefore.subtract(this.money)
      : this.balanceBefore.add(this.money);
    return expected.equals(this.balanceAfter);
  }
}
