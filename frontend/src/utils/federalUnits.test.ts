import { describe, expect, it } from 'vitest';
import { bandsFor, outOfUnits, unitCodeForGroup, unitsLeft } from './federalUnits';

const fed = (units: Record<string, number | string> | null) => ({ programtype: 'Federal SO', federalunits: units });

describe('federal session units', () => {
  it('uses 6012 for individual groups and 6022 for every other group', () => {
    expect(unitCodeForGroup('INDIVIDUAL')).toBe('6012');
    expect(unitCodeForGroup('FED SO')).toBe('6022');
    expect(unitCodeForGroup('SO')).toBe('6022');
  });

  it('counts blank units as none, so the client is blocked', () => {
    expect(unitsLeft(fed(null), '6022')).toBe(0);
    expect(outOfUnits(fed(null), '6022')).toBe(true);
    expect(outOfUnits(fed({ '6022': '0.00' }), '6022')).toBe(true);
    expect(outOfUnits(fed({ '6022': 1 }), '6012')).toBe(true);
  });

  it('never blocks clients outside Federal SO', () => {
    expect(outOfUnits({ programtype: 'State SO', federalunits: null }, '6022')).toBe(false);
  });

  it('offers only the lengths the client has units for', () => {
    expect(bandsFor(fed({ '6022': 1 }), '6022').map(b => b.key)).toEqual(['under16', '16-30']);
    expect(bandsFor(fed({ '6022': '2.00' }), '6022').map(b => b.key)).toEqual(['under16', '16-30', '31-60']);
    expect(bandsFor(fed({ '6022': 5 }), '6022').map(b => b.units)).toEqual([0, 1, 2, 3]);
  });
});
