import { describe, it, expect } from 'bun:test';
import { Money, InvalidMoneyError, CurrencyMismatchError } from './money';

describe('Money', () => {
  it('creates from a valid decimal string', () => {
    const money = Money.from('25.00', 'BRL');
    expect(money.amount).toBe('25.00');
    expect(money.currency).toBe('BRL');
  });

  it('rejects invalid amount formats', () => {
    expect(() => Money.from('abc', 'BRL')).toThrow(InvalidMoneyError);
    expect(() => Money.from('1e10', 'BRL')).toThrow(InvalidMoneyError);
    expect(() => Money.from('25.123', 'BRL')).toThrow(InvalidMoneyError);
    expect(() => Money.from('', 'BRL')).toThrow(InvalidMoneyError);
  });

  it('adds two amounts of the same currency', () => {
    const a = Money.from('25.00', 'BRL');
    const b = Money.from('50.00', 'BRL');
    expect(a.add(b).amount).toBe('75.00');
  });

  it('throws on operations between different currencies', () => {
    const brl = Money.from('25.00', 'BRL');
    const usd = Money.from('25.00', 'USD');
    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
  });

  it('subtracts correctly', () => {
    const a = Money.from('100.00', 'BRL');
    const b = Money.from('30.00', 'BRL');
    expect(a.subtract(b).amount).toBe('70.00');
  });

  it('avoids classic float precision issues', () => {
    const a = Money.from('0.10', 'BRL');
    const b = Money.from('0.20', 'BRL');
    expect(a.add(b).amount).toBe('0.30');
  });

  it('compares amounts correctly', () => {
    const a = Money.from('10.00', 'BRL');
    const b = Money.from('20.00', 'BRL');
    expect(a.isLessThan(b)).toBe(true);
    expect(b.isLessThan(a)).toBe(false);
  });
});