// src/shared/money.ts

import Decimal from 'decimal.js';
import { DomainError } from './errors/domain-error';

export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(a: string, b: string) {
    super(`Cannot operate on different currencies: ${a} vs ${b}`);
  }
}

export interface MoneyProps {
  amount: string;
  currency: string;
}

const DECIMAL_PLACES = 2;
const AMOUNT_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export class Money {
  private readonly value: Decimal;
  private readonly currencyCode: string;

  private constructor(value: Decimal, currency: string) {
    this.value = value;
    this.currencyCode = currency;
  }

  static from(amount: string, currency: string): Money {
    this.assertValidCurrency(currency);
    this.assertValidAmountString(amount);

    const decimal = new Decimal(amount).toDecimalPlaces(
      DECIMAL_PLACES,
      Decimal.ROUND_HALF_UP,
    );

    return new Money(decimal, currency.toUpperCase());
  }

  static zero(currency: string): Money {
    return Money.from('0.00', currency);
  }

  private static assertValidCurrency(currency: string): void {
    if (!currency || !/^[A-Z]{3}$/i.test(currency)) {
      throw new InvalidMoneyError(`Invalid currency code: "${currency}"`);
    }
  }

  private static assertValidAmountString(amount: string): void {
    if (typeof amount !== 'string' || amount.trim() === '') {
      throw new InvalidMoneyError('Amount must be a non-empty string');
    }

    if (!AMOUNT_PATTERN.test(amount)) {
      throw new InvalidMoneyError(
        `Invalid amount format: "${amount}". Expected a non-negative decimal string with up to 2 decimal places, no scientific notation, no leading minus sign.`,
      );
    }
  }

  private assertSameCurrency(other: Money): void {
    if (this.currencyCode !== other.currencyCode) {
      throw new CurrencyMismatchError(this.currencyCode, other.currencyCode);
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currencyCode);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currencyCode);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currencyCode);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  isGreaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.greaterThanOrEqualTo(other.value);
  }

  equals(other: Money): boolean {
    return (
      this.currencyCode === other.currencyCode &&
      this.value.equals(other.value)
    );
  }

  get currency(): string {
    return this.currencyCode;
  }

  get amount(): string {
    return this.value.toFixed(DECIMAL_PLACES);
  }

  toJSON(): MoneyProps {
    return { amount: this.amount, currency: this.currencyCode };
  }

  toString(): string {
    return `${this.amount} ${this.currencyCode}`;
  }
}