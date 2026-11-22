import { describe, expect, it } from 'vitest';
import { applyProgramFees, standardTreatmentFee } from './soPhases';

describe('standardTreatmentFee', () => {
  it('gives the price list group fee for the program and phase', () => {
    applyProgramFees([{ feekey: 'BIP', fee: '35.00' }, { feekey: 'Phase 2 - Monthly', fee: '100.00' }]);
    expect(standardTreatmentFee('BIP', '0')).toBe(35);
    expect(standardTreatmentFee('BIP', '12')).toBe(35);
    expect(standardTreatmentFee('State SO', 'Phase 2 - Monthly')).toBe(100);
    expect(standardTreatmentFee('Voluntary SO', 'Phase 2 - Monthly')).toBe(100);
    expect(standardTreatmentFee('Federal SO', 'Phase 1 - Weekly')).toBe(0);
  });

  it('is null when the price list sets no fee', () => {
    expect(standardTreatmentFee('State SO', 'Old phase 9')).toBeNull();
    expect(standardTreatmentFee('Poly Only', '')).toBeNull();
    expect(standardTreatmentFee(null, null)).toBeNull();
  });
});
