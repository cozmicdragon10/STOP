import { describe, expect, it } from 'vitest';
import { formatPhase, isAttendanceOverdue } from './clients';
import { caseNoteLabel, parseGroupCallInNote } from './notes';
import { currentReportFor, reportTabsFor } from './reports';
import { SCHEDULE_TIMES, formatSchedule, parseSchedule } from './schedule';
import { groupByMonth, sortedUnique, toggleInSet } from './filters';
import { isMonthlyFeeClient } from './soPhases';

describe('client rules', () => {
  it('shows a BIP week number as a week', () => {
    expect(formatPhase('BIP', '3')).toBe('Week 3');
    expect(formatPhase('State SO', 'Phase 1 - Weekly')).toBe('Phase 1 - Weekly');
  });

  it('flags SO clients past their phase attendance limit', () => {
    const client = { programtype: 'State SO', phase: 'Phase 1 - Weekly', lastattended: '2026-01-10T12:00:00' };
    expect(isAttendanceOverdue(client, new Date(2026, 1, 10))).toBe(false);
    expect(isAttendanceOverdue(client, new Date(2026, 1, 11))).toBe(true);
    expect(isAttendanceOverdue({ ...client, programtype: 'BIP' }, new Date(2026, 5, 1))).toBe(false);
    expect(isAttendanceOverdue({ ...client, lastattended: null }, new Date(2026, 5, 1))).toBe(false);
  });

  it('charges the monthly fee only for State and Voluntary SO phases 1 and 2', () => {
    expect(isMonthlyFeeClient('State SO', 'Phase 2 - Monthly')).toBe(true);
    expect(isMonthlyFeeClient('Voluntary SO', 'Phase 1 - Weekly')).toBe(true);
    expect(isMonthlyFeeClient('Federal SO', 'Phase 1 - Weekly')).toBe(false);
    expect(isMonthlyFeeClient('State SO', 'Phase 3 - Quarterly')).toBe(false);
  });
});

describe('case notes', () => {
  it('reads the date a group call-in is for', () => {
    expect(parseGroupCallInNote('[Group Call-In Log] (For: 2026-03-04) (Reason: Work conflict): late')).toEqual({ forDate: '2026-03-04' });
    expect(parseGroupCallInNote('[Group Call-In Log]: late')).toEqual({ forDate: null });
    expect(parseGroupCallInNote('Called in')).toBeNull();
  });

  it('labels group call-ins and keeps other categories', () => {
    expect(caseNoteLabel({ category: 'Admin', comments: '' })).toBe('Admin');
    expect(caseNoteLabel({ category: 'Call-In', comments: '[Group Call-In Log]: late' })).toBe('Day Of · Group Call-In');
  });
});

describe('report tabs', () => {
  it('limits Counselors to the all-roles reports', () => {
    expect(reportTabsFor('Counselor').map(t => t.id)).toEqual(['cashDeposits']);
    expect(currentReportFor('agent', 'Counselor')).toBe('cashDeposits');
  });

  it('keeps the picked report when the role can see it', () => {
    expect(currentReportFor('deposit', 'Office Admin')).toBe('deposit');
    expect(currentReportFor(null, 'Business Administrator')).toBe('agent');
  });
});

describe('group schedules', () => {
  it('round-trips through the stored text', () => {
    expect(formatSchedule('Thursday', '7:00 PM')).toBe('Thursdays @ 7:00 PM');
    expect(parseSchedule('Thursdays @ 7:00 PM')).toEqual({ day: 'Thursday', time: '7:00 PM' });
    expect(parseSchedule('thursday @ 07:00 pm')).toEqual({ day: 'Thursday', time: '7:00 PM' });
  });

  it('returns empty picks for text it cannot read', () => {
    expect(parseSchedule('whenever')).toEqual({ day: '', time: '' });
    expect(formatSchedule('', '7:00 PM')).toBe('');
  });

  it('offers every quarter hour', () => {
    expect(SCHEDULE_TIMES).toHaveLength(96);
    expect(SCHEDULE_TIMES[0]).toBe('12:00 AM');
    expect(SCHEDULE_TIMES[95]).toBe('11:45 PM');
  });
});

describe('list helpers', () => {
  it('groups rows by month, newest first by default', () => {
    const rows = [{ date: '2026-03-05T12:00:00' }, { date: '2026-01-02T12:00:00' }, { date: '2026-03-01T12:00:00' }];
    expect(groupByMonth(rows, 'newest').map(g => [g.key, g.rows.length])).toEqual([['2026-03', 2], ['2026-01', 1]]);
    expect(groupByMonth(rows, 'oldest')[0].label).toBe('January 2026');
  });

  it('sorts unique non-empty values and toggles set members', () => {
    expect(sortedUnique(['b', 'a', '', null, 'b'])).toEqual(['a', 'b']);
    expect([...toggleInSet(new Set(['a']), 'a')]).toEqual([]);
    expect([...toggleInSet(new Set(['a']), 'b')]).toEqual(['a', 'b']);
  });
});
