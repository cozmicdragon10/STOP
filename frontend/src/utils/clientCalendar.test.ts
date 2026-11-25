import { describe, expect, it } from 'vitest';
import { clientCalendarEntries, groupCheckInDays, hasUpcoming, phaseAttendanceNote, upcomingItems, type ClientCalendarData } from './clientCalendar';
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
      '2026-12-15': ['assessment:1:30 PM Assessment'],
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

describe('upcomingItems', () => {
  const short = (items: ReturnType<typeof upcomingItems>) => items.map(i => `${i.day} ${i.tone} ${i.what}: ${i.detail}`);

  it('lists only the next group meeting, not every week', () => {
    expect(short(upcomingItems(base))).toEqual(['2026-12-10 booked Thursday PM: Next group meeting · 5:00 PM']);
  });

  it("skips today's meeting once the client has checked in", () => {
    expect(upcomingItems(base, new Set(['2026-12-10']))[0].day).toBe('2026-12-17');
  });

  it('shows cancelled and moved meetings coming up soon, and the next meeting after them', () => {
    const data = {
      ...base,
      changes: [
        { changeid: 1, originaldate: '2026-12-10', action: 'Cancelled' as const, newdate: null, newtime: null, reason: 'Holiday' },
        { changeid: 2, originaldate: '2026-12-17', action: 'Rescheduled' as const, newdate: '2026-12-19', newtime: '10:00', reason: null },
        // Past the four-week window: left off
        { changeid: 3, originaldate: '2027-01-28', action: 'Cancelled' as const, newdate: null, newtime: null, reason: null },
      ],
    };
    expect(short(upcomingItems(data))).toEqual([
      '2026-12-10 cancelled Thursday PM: Cancelled · Holiday',
      '2026-12-17 moved Thursday PM: Moved to Dec 19 at 10:00 AM',
      '2026-12-19 booked Thursday PM: Group meeting moved here from Dec 17 at 10:00 AM',
    ]);
  });

  it('lists every booked assessment and polygraph, soonest first', () => {
    const data: ClientCalendarData = {
      ...base,
      group: null,
      assessments: [{ appointmentid: 3, date: '2027-02-15', time: '13:30', assessor: 'Pat', location: 'Room 2' }],
      polygraphs: [{ appointmentid: 8, date: '2026-12-20', time: '09:00', type: 'Maintenance', location: 'Office' }],
    };
    expect(short(upcomingItems(data))).toEqual([
      '2026-12-20 booked Polygraph (Maintenance): 9:00 AM · Office',
      '2027-02-15 assessment Assessment: 1:30 PM · with Pat · Room 2',
    ]);
  });
});

describe('groupCheckInDays', () => {
  it('counts group and make-up check-ins, not cancelled or missed rows or other sessions', () => {
    const days = groupCheckInDays([
      { date: '2026-12-03T00:00:00', type: 'Group' },
      { date: '2026-12-04T00:00:00', type: 'Make-Up' },
      { date: '2026-12-05T00:00:00', type: 'Individual' },
      { date: '2026-12-10T00:00:00', type: 'Group Cancelled', cancellation: true },
    ]);
    expect([...days].sort()).toEqual(['2026-12-03', '2026-12-04']);
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
