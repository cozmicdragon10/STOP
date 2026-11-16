import { describe, expect, it } from 'vitest';
import { checkInPaymentRule, minimumCheckInPayment } from './balance';
import { federalGroupFee } from './clients';

describe('check-in payment rule', () => {
  it('BIP, Federal SO and drug test clients have no balance requirement', () => {
    for (const p of ['BIP', 'Federal SO', 'Fed Drug Test']) {
      expect(checkInPaymentRule(p)).toBe('none');
      expect(minimumCheckInPayment('none', 500, 40, false)).toBe(0);
    }
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
