import { describe, expect, it } from 'vitest';
import { individualSessionFee } from './clients';

describe('individual session fee', () => {
  it('charges federal clients their copay, never the Individual price', () => {
    expect(individualSessionFee({ programtype: 'Federal SO', copay: '15.00' }, 80)).toBe(15);
    expect(individualSessionFee({ programtype: 'Fed Drug Test', copay: 10 }, 80)).toBe(10);
    expect(individualSessionFee({ programtype: 'Poly Only', copay: null }, 80)).toBe(0);
  });

  it('charges everyone else the Individual price', () => {
    expect(individualSessionFee({ programtype: 'State SO', copay: null }, 80)).toBe(80);
    expect(individualSessionFee({ programtype: 'Chaperon' }, 80)).toBe(80);
  });
});
