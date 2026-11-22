import { describe, expect, it } from 'vitest';
import { clientCalendarEntries, hasUpcoming, phaseAttendanceNote, type ClientCalendarData } from './clientCalendar';
import { dayWhen } from './calendar';

// Thursdays in December 2026: 3, 10, 17, 24, 31
const base: ClientCalendarData = {
  today: '2026-12-10',
  phase: 'Phase 1 - Weekly',
  group: { groupid: 4, groupname: 'Thursday PM', schedule: 'Thursdays @ 5:00 PM', counselor: 'Pat' },
  changes: [],
  assessments: [],
  polygraphs: [],
  polygraphsTaken: [],
};
const labels = (map: Map<string, { label: string; tone: string }[]>) =>
  Object.fromEntries([...map.entries()].sort().map(([d, e]) => [d, e.map(x => `${x.tone}:${x.label}`)]));

describe('clientCalendarEntries', () => {
  it("shows the group's meetings from today on, not before", () => {
    expect(labels(clientCalendarEntries(base, '2026-12'))).toEqual({
      '2026-12-10': ['booked:Thursday PM'],
      '2026-12-17': ['booked:Thursday PM'],
      '2026-12-24': ['booked:Thursday PM'],
      '2026-12-31': ['booked:Thursday PM'],
    });
  });

  it("leaves out today's meeting once the client has checked in", () => {
    const map = clientCalendarEntries(base, '2026-12', new Set(['2026-12-10']));
    expect(map.has('2026-12-10')).toBe(false);
  });

  it('shows cancelled and moved meetings, and where a moved one went', () => {
    const data = {
      ...base,
      changes: [
        { changeid: 1, originaldate: '2026-12-24', action: 'Cancelled' as const, newdate: null, newtime: null, reason: 'Holiday' },
        { changeid: 2, originaldate: '2026-12-31', action: 'Rescheduled' as const, newdate: '2027-01-02', newtime: '10:00', reason: null },
      ],
    };
    const dec = labels(clientCalendarEntries(data, '2026-12'));
    expect(dec['2026-12-24']).toEqual(['cancelled:Thursday PM']);
    expect(dec['2026-12-31']).toEqual(['moved:Thursday PM → Jan 2']);
    const jan = labels(clientCalendarEntries(data, '2027-01'));
    expect(jan['2027-01-02']).toEqual(['booked:10:00 AM Thursday PM']);
  });

  it('does not show a cancellation twice when the case notes already show it', () => {
    const data = { ...base, changes: [{ changeid: 7, originaldate: '2026-12-17', action: 'Cancelled' as const, newdate: null, newtime: null, reason: null }] };
    expect(clientCalendarEntries(data, '2026-12', new Set(), new Set([7])).has('2026-12-17')).toBe(false);
  });

  it('shows booked assessments and polygraphs, and polygraphs taken', () => {
    const data: ClientCalendarData = {
      ...base,
      group: null,
      assessments: [{ appointmentid: 3, date: '2026-12-15', time: '13:30', assessor: 'Pat', location: 'Room 2' }],
      polygraphs: [
        { appointmentid: 8, date: '2026-12-20', time: '09:00', type: 'Maintenance', location: 'Office' },
        { appointmentid: 9, date: '2026-12-02', time: '09:00', type: 'Maintenance', location: 'Office' },
      ],
      polygraphsTaken: [{ resultid: 5, date: '2026-12-02', time: '09:00', type: 'Maintenance' }],
    };
    const map = clientCalendarEntries(data, '2026-12');
    expect(labels(map)).toEqual({
      '2026-12-02': ['done:Polygraph: Maintenance'],
      '2026-12-15': ['booked:1:30 PM Assessment'],
      '2026-12-20': ['booked:9:00 AM Polygraph'],
    });
    expect(map.get('2026-12-15')![0].title).toBe('Assessment at 1:30 PM with Pat, Room 2');
  });

  it('shows no group meetings for a group without a weekly day and time', () => {
    const data = { ...base, group: { ...base.group!, schedule: 'By Appointment' } };
    expect(clientCalendarEntries(data, '2026-12').size).toBe(0);
    expect(hasUpcoming(data)).toBe(false);
    expect(hasUpcoming(base)).toBe(true);
  });
});

describe('phaseAttendanceNote', () => {
  it('explains that Phase 2/3/4 clients come less often than weekly', () => {
    expect(phaseAttendanceNote('Phase 2 - Monthly')).toBe('Phase 2 - Monthly: comes to one of these group meetings once a month.');
    expect(phaseAttendanceNote('Phase 1 - Weekly')).toBe('');
    expect(phaseAttendanceNote(null)).toBe('');
  });
});

describe('dayWhen', () => {
  it('tells past, today and future apart', () => {
    expect(dayWhen('2026-12-09', '2026-12-10')).toBe('past');
    expect(dayWhen('2026-12-10', '2026-12-10')).toBe('today');
    expect(dayWhen('2026-12-11', '2026-12-10')).toBe('future');
  });
});
