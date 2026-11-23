import { describe, expect, it } from 'vitest';
import { nextSort, phaseValue, sortRows, timeValue, valueFromText } from './tableSort';
import { SO_PHASES } from './soPhases';

describe('nextSort', () => {
  it('goes ascending, then descending, then back to the table order', () => {
    const a = nextSort(null, 'name');
    expect(a).toEqual({ key: 'name', dir: 'asc' });
    const b = nextSort(a, 'name');
    expect(b).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort(b, 'name')).toBeNull();
  });
  it('starts ascending on a different column', () => {
    expect(nextSort({ key: 'name', dir: 'desc' }, 'owed')).toEqual({ key: 'owed', dir: 'asc' });
  });
});

describe('sortRows', () => {
  const rows = [
    { name: 'Smith', owed: 20 },
    { name: 'adams', owed: null },
    { name: 'Brown', owed: 5 },
    { name: 'Clark', owed: 20 },
  ];
  const value = (r: typeof rows[number], k: 'name' | 'owed') => r[k];

  it('keeps the table order with no sort', () => {
    expect(sortRows(rows, null, value)).toEqual(rows);
  });
  it('sorts text without caring about capitals', () => {
    expect(sortRows(rows, { key: 'name', dir: 'asc' }, value).map(r => r.name)).toEqual(['adams', 'Brown', 'Clark', 'Smith']);
  });
  it('sorts numbers by size, keeps ties in table order, and puts empty cells last both ways', () => {
    expect(sortRows(rows, { key: 'owed', dir: 'asc' }, value).map(r => r.name)).toEqual(['Brown', 'Smith', 'Clark', 'adams']);
    expect(sortRows(rows, { key: 'owed', dir: 'desc' }, value).map(r => r.name)).toEqual(['Smith', 'Clark', 'Brown', 'adams']);
  });
  it('does not change the rows passed in', () => {
    const copy = [...rows];
    sortRows(rows, { key: 'name', dir: 'desc' }, value);
    expect(rows).toEqual(copy);
  });
  it('sorts numbers inside text in number order', () => {
    const groups = [{ g: 'Group 10' }, { g: 'Group 9' }];
    expect(sortRows(groups, { key: 'g', dir: 'asc' }, (r) => r.g).map(r => r.g)).toEqual(['Group 9', 'Group 10']);
  });
});

describe('valueFromText', () => {
  it('reads amounts, counts, changes and percents as numbers', () => {
    expect(valueFromText('$1,234.50')).toBe(1234.5);
    expect(valueFromText('-$20.00')).toBe(-20);
    expect(valueFromText('+3')).toBe(3);
    expect(valueFromText('12.5%')).toBe(12.5);
    expect(valueFromText(7)).toBe(7);
  });
  it('reads M/D/YYYY dates in date order', () => {
    expect(Number(valueFromText('12/1/2025'))).toBeLessThan(Number(valueFromText('1/2/2026')));
  });
  it('treats a dash or blank as empty and leaves other text alone', () => {
    expect(valueFromText('—')).toBeNull();
    expect(valueFromText('')).toBeNull();
    expect(valueFromText('Active')).toBe('Active');
  });
});

describe('phaseValue', () => {
  it('puts the SO phases in program order, numbered phases after, and no phase empty', () => {
    const phases = [...SO_PHASES].reverse();
    const sorted = sortRows(['12', ...phases, '3', ''], { key: 'p', dir: 'asc' }, (p) => phaseValue(p));
    expect(sorted).toEqual([...SO_PHASES, '3', '12', '']);
  });
});

describe('timeValue', () => {
  it('orders dates and timestamps, and is empty for nothing', () => {
    expect(Number(timeValue('2026-01-02'))).toBeGreaterThan(Number(timeValue('2025-12-31')));
    expect(timeValue('2026-01-02T10:00:00Z')).toBe(Date.parse('2026-01-02T10:00:00Z'));
    expect(timeValue(null)).toBeNull();
    expect(timeValue('not a date')).toBeNull();
  });
});
