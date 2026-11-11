import { describe, expect, it } from 'vitest';
import { bandsFor, drugTestedOn, needsDuration, outOfUnits, unitCodeFor, unitsLeft } from './federalUnits';

const fed = (units: Record<string, number | string> | null) => ({ programtype: 'Federal SO', federalunits: units });
const drug = (units: Record<string, number | string> | null, lastdrugtest: string | null = null) =>
  ({ programtype: 'Fed Drug Test', federalunits: units, lastdrugtest });

describe('federal session units', () => {
  it('picks the code from the client program and the group', () => {
    expect(unitCodeFor(fed(null), 'INDIVIDUAL')).toBe('6012');
    expect(unitCodeFor(fed(null), 'FED SO')).toBe('6022');
    expect(unitCodeFor(drug(null), 'DRUG TEST')).toBe('1010');
    expect(unitCodeFor(drug(null), 'INDIVIDUAL')).toBeNull();
    expect(unitCodeFor({ programtype: 'State SO' }, 'SO')).toBeNull();
  });

  it('counts blank units as none, so the client is blocked', () => {
    expect(unitsLeft(fed(null), '6022')).toBe(0);
    expect(outOfUnits(fed(null), 'SO')).toBe(true);
    expect(outOfUnits(fed({ '6022': '0.00' }), 'SO')).toBe(true);
    expect(outOfUnits(fed({ '6022': 1 }), 'INDIVIDUAL')).toBe(true);
    expect(outOfUnits(drug(null), 'DRUG TEST')).toBe(true);
    expect(outOfUnits(drug({ '1010': 1 }), 'DRUG TEST')).toBe(false);
  });

  it('never blocks clients whose sessions use no units', () => {
    expect(outOfUnits({ programtype: 'State SO', federalunits: null }, 'SO')).toBe(false);
  });

  it('asks how long only for Federal SO sessions', () => {
    expect(needsDuration(fed(null), 'SO')).toBe(true);
    expect(needsDuration(drug({ '1010': 3 }), 'DRUG TEST')).toBe(false);
  });

  it('offers only the lengths the client has units for', () => {
    expect(bandsFor(fed({ '6022': 1 }), '6022').map(b => b.key)).toEqual(['under16', '16-30']);
    expect(bandsFor(fed({ '6022': '2.00' }), '6022').map(b => b.key)).toEqual(['under16', '16-30', '31-60']);
    expect(bandsFor(fed({ '6022': 5 }), '6022').map(b => b.units)).toEqual([0, 1, 2, 3]);
  });

  it('allows one drug test a day', () => {
    expect(drugTestedOn(drug({ '1010': 2 }, '2026-11-11'), 'DRUG TEST', '2026-11-11')).toBe(true);
    expect(drugTestedOn(drug({ '1010': 2 }, '2026-11-10'), 'DRUG TEST', '2026-11-11')).toBe(false);
    expect(drugTestedOn(drug({ '1010': 2 }, '2026-11-11'), 'INDIVIDUAL', '2026-11-11')).toBe(false);
  });
});
