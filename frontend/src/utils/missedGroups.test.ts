import { describe, expect, it } from 'vitest';
import { missedGroupLabel, missedGroupSummary } from './missedGroups';

describe('missedGroupLabel', () => {
  it('names a weekly miss and a whole period with no check-in', () => {
    expect(missedGroupLabel({ everymonths: null })).toBe('Missed group');
    expect(missedGroupLabel({ everymonths: 1 })).toBe('No group check-in this month');
    expect(missedGroupLabel({ everymonths: 3 })).toBe('No group check-in this quarter');
    expect(missedGroupLabel({ everymonths: 6 })).toBe('No group check-in these six months');
  });
});

describe('missedGroupSummary', () => {
  it('counts all misses, called-in ones, the last 90 days, and the latest', () => {
    const rows = [
      { date: '2026-11-17', calledin: false },
      { date: '2026-09-01', calledin: true },
      { date: '2026-03-03', calledin: false },
    ];
    expect(missedGroupSummary(rows, new Date(2026, 10, 19))).toEqual({
      total: 3, calledIn: 1, noShows: 2, last90: 2, latest: '2026-11-17',
    });
  });

  it('is all zero with no misses', () => {
    expect(missedGroupSummary([], new Date(2026, 10, 19))).toEqual({ total: 0, calledIn: 0, noShows: 0, last90: 0, latest: null });
  });
});
