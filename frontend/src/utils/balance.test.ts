import { describe, expect, it } from 'vitest';
import { balanceColor, balancePillColor } from './balance';

// Stored sign: positive = owes, negative = credit
describe('balanceColor', () => {
  it('is red when owed, green for a credit, plain at $0.00', () => {
    expect(balanceColor(180)).toBe('text-red-400');
    expect(balanceColor('-55.00')).toBe('text-emerald-400');
    expect(balanceColor(0)).toBe('text-slate-200');
    expect(balanceColor('0.00')).toBe('text-slate-200');
    expect(balanceColor(null)).toBe('text-slate-200');
  });

  it('treats anything that shows as $0.00 as plain', () => {
    expect(balanceColor(0.001)).toBe('text-slate-200');
    expect(balanceColor(-0.004)).toBe('text-slate-200');
    expect(balanceColor(0.01)).toBe('text-red-400');
  });
});

describe('balancePillColor', () => {
  it('matches balanceColor for owed, credit and $0.00', () => {
    expect(balancePillColor(5)).toContain('text-red-400');
    expect(balancePillColor(-5)).toContain('text-emerald-400');
    expect(balancePillColor(0)).toContain('text-slate-200');
  });
});
