import { describe, expect, it } from 'vitest';
import { attendanceBalanceChange, cardPaymentStatus, ledgerBalanceChange, signedMoney } from './ledger';
import { formatBalance, toDisplayBalance } from './balance';

describe('balance display', () => {
  it('flips the stored sign: stored positive (owes) shows as negative', () => {
    expect(toDisplayBalance('12.5')).toBe(-12.5);
    expect(formatBalance(50)).toBe('-$50.00');
    expect(formatBalance(-20)).toBe('$20.00');
    expect(formatBalance(null)).toBe('$0.00');
  });

  it('signs money amounts', () => {
    expect(signedMoney(-3)).toBe('-$3.00');
    expect(signedMoney(4.5)).toBe('$4.50');
  });
});

describe('cardPaymentStatus', () => {
  const payment = { transactionid: 1, amount: 100, disputestatus: 'Open' };

  it('subtracts refunds and disputes on this payment only', () => {
    const ledger = [
      { relatedtransactionid: 1, type: 'Refund', amount: 20 },
      { relatedtransactionid: 1, type: 'Dispute', amount: 30 },
      { relatedtransactionid: 2, type: 'Refund', amount: 99 },
    ];
    expect(cardPaymentStatus(payment, ledger)).toEqual({ refunded: 20, kept: 50, openDispute: 30 });
  });

  it('puts a won dispute back', () => {
    const ledger = [
      { relatedtransactionid: 1, type: 'Dispute', amount: 30 },
      { relatedtransactionid: 1, type: 'Dispute Won', amount: 30 },
    ];
    expect(cardPaymentStatus({ ...payment, disputestatus: 'Won' }, ledger)).toEqual({ refunded: 0, kept: 100, openDispute: 0 });
  });
});

describe('ledgerBalanceChange', () => {
  it('works back from the stored balance after a payment', () => {
    expect(ledgerBalanceChange({ type: 'Payment', amount: 50, finalbalance: 100 }))
      .toEqual({ before: -150, after: -100, changesBalance: true });
  });

  it('treats charges and refunds as adding to what is owed', () => {
    expect(ledgerBalanceChange({ type: 'Charge', amount: 50, finalbalance: 100 })?.before).toBe(-50);
    expect(ledgerBalanceChange({ type: 'Refund', amount: 50, finalbalance: 100 })?.before).toBe(-50);
  });

  it('leaves the balance alone for poly fee payments', () => {
    expect(ledgerBalanceChange({ type: 'Payment', feetype: 'Poly Fee', amount: 50, finalbalance: 100 }))
      .toEqual({ before: -100, after: -100, changesBalance: false });
  });

  it('returns null when the row has no stored balance', () => {
    expect(ledgerBalanceChange({ type: 'Payment', amount: 50, finalbalance: null })).toBeNull();
  });
});

describe('attendanceBalanceChange', () => {
  it('rebuilds the balance before the session from the fee and payment', () => {
    expect(attendanceBalanceChange({ groupfee: 40, accountpaid: 25, accounttotal: 15 }))
      .toEqual({ fee: 40, paid: 25, before: -0, after: -15 });
  });
});
