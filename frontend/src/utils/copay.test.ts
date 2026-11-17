import { describe, expect, it } from 'vitest';
import { copayFieldsFor, copayText, federalPolyNeeds, individualSessionFee } from './clients';
import { polySchedulingNeeds } from './polygraph';

describe('individual session fee', () => {
  it('charges federal clients their individual copay, never the Individual price', () => {
    expect(individualSessionFee({ programtype: 'Federal SO', individualcopay: '15.00' }, 80)).toBe(15);
    expect(individualSessionFee({ programtype: 'Fed Drug Test', individualcopay: 10 }, 80)).toBe(10);
    expect(individualSessionFee({ programtype: 'Poly Only', individualcopay: null }, 80)).toBe(0);
  });

  it('charges everyone else the Individual price', () => {
    expect(individualSessionFee({ programtype: 'State SO', individualcopay: null }, 80)).toBe(80);
    expect(individualSessionFee({ programtype: 'Chaperon' }, 80)).toBe(80);
  });
});

describe('copay fields', () => {
  it('shows each federal program the copays it uses', () => {
    expect(copayFieldsFor('Federal SO').map(f => f.field)).toEqual(['groupcopay', 'individualcopay', 'polycopay']);
    expect(copayFieldsFor('Fed Drug Test').map(f => f.field)).toEqual(['groupcopay', 'individualcopay']);
    expect(copayFieldsFor('Poly Only').map(f => f.field)).toEqual(['individualcopay', 'polycopay']);
    expect(copayFieldsFor('State SO')).toEqual([]);
  });

  it('reads blank as None', () => {
    expect(copayText(null)).toBe('None');
    expect(copayText('')).toBe('None');
    expect(copayText('0')).toBe('$0.00');
    expect(copayText(12.5)).toBe('$12.50');
  });
});

describe('federal polygraph scheduling', () => {
  it('needs no vouchers or paid-up balance, and charges the copay', () => {
    const needs = polySchedulingNeeds({ programtype: 'Federal SO', polyfeevoucher: 0, accountbalance: '400', polycopay: '25' });
    expect(needs).toMatchObject({ met: true, short: false, polyDue: 0, balanceDue: 0, federalCopay: 25 });
  });

  it('is free with no copay', () => {
    expect(polySchedulingNeeds({ programtype: 'Poly Only', accountbalance: '400', polycopay: null })).toMatchObject({ met: true, federalCopay: 0 });
  });

  it('asks for a payment only when the copay would pass a max debt override', () => {
    expect(federalPolyNeeds(25, 90, 100)).toEqual({ copay: 25, amountDue: 15 });
    expect(federalPolyNeeds(25, 50, 100)).toEqual({ copay: 25, amountDue: 0 });
    expect(federalPolyNeeds(0, 500, 100)).toEqual({ copay: 0, amountDue: 0 });
    expect(polySchedulingNeeds({ programtype: 'Federal SO', accountbalance: 90, polycopay: 25, maxowed: '100.00' })).toMatchObject({ met: false, balanceDue: 15 });
  });

  it('leaves other programs on vouchers', () => {
    expect(polySchedulingNeeds({ programtype: 'State SO', polyfeevoucher: 0, polyfee: 250, accountbalance: 0 })).toMatchObject({ short: true, federalCopay: null });
  });
});
