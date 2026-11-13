import { describe, expect, it } from 'vitest';
import { CHANGE_LOG_TYPES, changeLogFilters } from './clients';

describe('change log filters', () => {
  it('lists only the types the log has, in the usual order, then other types alphabetically', () => {
    const changes = ['Payment', '6022 Units', 'Name', 'Attendance Added', 'Payment', '6012 Units'].map(changetype => ({ changetype }));
    expect(changeLogFilters(changes).map(f => f.type)).toEqual(['Name', 'Attendance Added', 'Payment', '6012 Units', '6022 Units']);
  });

  it('keeps the friendly labels', () => {
    expect(changeLogFilters([{ changetype: 'Fee Override' }])).toEqual([{ type: 'Fee Override', label: 'Temporary Fee Override' }]);
  });

  it('has no filters for an empty log', () => {
    expect(changeLogFilters([])).toEqual([]);
  });

  it('lists each type once', () => {
    const types = CHANGE_LOG_TYPES.map(t => t.type);
    expect(new Set(types).size).toBe(types.length);
  });
});
