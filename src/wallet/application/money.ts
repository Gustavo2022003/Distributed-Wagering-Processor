import { Money } from '../../shared/money';

export function moneyZero(currency: string): Money {
  return Money.from('0.00', currency);
}
