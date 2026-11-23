import { describe, expect, it } from 'vitest';
import { amountsValid, cardPart, cashPart, parseAmount, toggleSplit, type PaymentAmounts } from './splitPayment';

const row = (patch: Partial<PaymentAmounts>): PaymentAmounts => ({ payment: '', paymentMethod: 'Cash', split: false, cardAmount: '', ...patch });

describe('split payments at check-in', () => {
  it('parses amounts', () => {
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('12.50')).toBe(12.5);
    expect(parseAmount('-1')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('a single payment is all cash/other or all card', () => {
    expect(cashPart(row({ payment: '40' }))).toBe(40);
    expect(cardPart(row({ payment: '40' }))).toBe(0);
    expect(cashPart(row({ payment: '40', paymentMethod: 'Credit Card' }))).toBe(0);
    expect(cardPart(row({ payment: '40', paymentMethod: 'Credit Card' }))).toBe(40);
  });

  it('a split payment has a card part and a cash/other part', () => {
    const r = row({ split: true, cardAmount: '50', payment: '30', paymentMethod: 'Cash' });
    expect(cardPart(r)).toBe(50);
    expect(cashPart(r)).toBe(30);
    expect(amountsValid(r)).toBe(true);
    expect(amountsValid({ ...r, cardAmount: 'x' })).toBe(false);
  });

  it('turning split on keeps the amount already typed in the matching part', () => {
    expect(toggleSplit(row({ payment: '60', paymentMethod: 'Credit Card' }))).toEqual({ split: true, cardAmount: '60', payment: '', paymentMethod: 'Cash' });
    expect(toggleSplit(row({ payment: '60', paymentMethod: 'Other' }))).toEqual({ split: true, cardAmount: '', payment: '60', paymentMethod: 'Other' });
  });

  it('turning split off keeps the cash/other part as the single payment', () => {
    expect(toggleSplit(row({ split: true, cardAmount: '50', payment: '30', paymentMethod: 'Cash' })))
      .toEqual({ split: false, cardAmount: '', payment: '30', paymentMethod: 'Cash' });
  });
});
