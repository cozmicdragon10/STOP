import { describe, expect, it } from 'vitest';
import { activeRange, dateRange } from './dateRanges';

describe('dateRange', () => {
  // Sunday, November 22, 2026
  const today = '2026-11-22';

  it('today, and this week from Sunday (a Sunday starts its week)', () => {
    expect(dateRange('today', today)).toEqual({ from: '2026-11-22', to: '2026-11-22' });
    expect(dateRange('thisWeek', today)).toEqual({ from: '2026-11-22', to: '2026-11-22' });
    expect(dateRange('thisWeek', '2026-11-28')).toEqual({ from: '2026-11-22', to: '2026-11-28' });
  });

  it('last week is the whole Sunday to Saturday before', () => {
    expect(dateRange('lastWeek', today)).toEqual({ from: '2026-11-15', to: '2026-11-21' });
    // Across a month and a year (Friday, January 2, 2026)
    expect(dateRange('lastWeek', '2026-01-02')).toEqual({ from: '2025-12-21', to: '2025-12-27' });
  });

  it('months: this month through today, last month whole', () => {
    expect(dateRange('thisMonth', today)).toEqual({ from: '2026-11-01', to: '2026-11-22' });
    expect(dateRange('lastMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(dateRange('lastMonth', '2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(dateRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('years: this year through today, last year whole', () => {
    expect(dateRange('thisYear', today)).toEqual({ from: '2026-01-01', to: '2026-11-22' });
    expect(dateRange('lastYear', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });
});

describe('activeRange', () => {
  it('names the range the dates match, else nothing', () => {
    const keys = ['today', 'thisWeek', 'lastMonth'] as const;
    expect(activeRange([...keys], '2026-10-01', '2026-10-31', '2026-11-22')).toBe('lastMonth');
    expect(activeRange([...keys], '2026-10-02', '2026-10-31', '2026-11-22')).toBeNull();
  });
});
