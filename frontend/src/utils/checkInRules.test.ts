import { describe, expect, it } from 'vitest';
import { checkInPaymentRule, minimumCheckInPayment } from './balance';
import { federalGroupFee } from './clients';

describe('check-in payment rule', () => {
  it('BIP clients follow the SO rule: $0.00 or better at the first group check-in of the month', () => {
    for (const p of ['BIP', 'State SO', 'Voluntary SO']) expect(checkInPaymentRule(p)).toBe('first');
    expect(minimumCheckInPayment(checkInPaymentRule('BIP'), 500, 40, false)).toBe(500);
    expect(minimumCheckInPayment(checkInPaymentRule('BIP'), 500, 40, true)).toBe(0);
  });

  it('federal clients can owe any amount when no max debt override is set', () => {
    for (const p of ['Federal SO', 'Fed Drug Test', 'Poly Only']) expect(checkInPaymentRule(p)).toBe('federal');
    expect(minimumCheckInPayment('federal', 5000, 40, false)).toBe(0);
    expect(minimumCheckInPayment('federal', 5000, 40, false, null)).toBe(0);
  });

  it('a max debt override caps what a federal copay can leave the client owing', () => {
    expect(minimumCheckInPayment('federal', 80, 40, true, 100)).toBe(20);
    expect(minimumCheckInPayment('federal', 50, 40, false, '100.00')).toBe(0);
    // Nothing charged today: nothing to pay, even over the cap
    expect(minimumCheckInPayment('federal', 500, 0, false, 100)).toBe(0);
  });

  it('Chaperon clients pay each attendance the day of it, today\'s fee included', () => {
    expect(checkInPaymentRule('Chaperon')).toBe('each');
    expect(minimumCheckInPayment('each', 0, 40, true)).toBe(40);
    expect(minimumCheckInPayment('each', 10, 40, false)).toBe(50);
    expect(minimumCheckInPayment('each', -50, 40, false)).toBe(0);
  });

  it('everyone else pays their balance to $0 on the first group of the month, before today\'s fee', () => {
    expect(checkInPaymentRule('State SO')).toBe('first');
    expect(minimumCheckInPayment('first', 50, 180, false)).toBe(50);
    expect(minimumCheckInPayment('first', 0, 180, false)).toBe(0);
    expect(minimumCheckInPayment('first', 50, 180, true)).toBe(0);
  });

  it('lets a max debt override owe up to its amount', () => {
    expect(minimumCheckInPayment('first', 80, 40, false, 100)).toBe(0);
    expect(minimumCheckInPayment('first', 130, 40, false, '100.00')).toBe(30);
    expect(minimumCheckInPayment('each', 80, 40, true, 100)).toBe(20);
  });
});

describe('federal group fee', () => {
  it('charges Fed Drug Test clients their copay at every drug test', () => {
    expect(federalGroupFee('Fed Drug Test', '15.00', false)).toBe(15);
    expect(federalGroupFee('Fed Drug Test', '15.00', true)).toBe(15);
    expect(federalGroupFee('Fed Drug Test', null, false)).toBe(0);
  });

  it('charges Federal SO clients their copay on the first group of the month only', () => {
    expect(federalGroupFee('Federal SO', 25, false)).toBe(25);
    expect(federalGroupFee('Federal SO', 25, true)).toBe(0);
    expect(federalGroupFee('Federal SO', null, false)).toBe(0);
  });

  it('leaves everyone else to the treatment fee', () => {
    expect(federalGroupFee('State SO', 25, false)).toBeNull();
    expect(federalGroupFee('Chaperon', 25, false)).toBeNull();
  });
});
