import { describe, expect, it } from 'vitest';
import { assessmentPickList, clientsNotAttendedThisMonth, groupsMeetingOn, isMyClient, monthGrid, myGroupIds, scheduledDatesIn, shiftMonth, weekdayName } from './counselor';

const groups = [
  { groupid: 1, groupname: 'Tuesday Men', counselor: 'Ana Ruiz', schedule: 'Tuesdays @ 6:00 PM', active: true },
  { groupid: 2, groupname: 'Thursday Men', counselor: '  ana ruiz ', schedule: 'Thursdays @ 7:00 PM', active: true },
  { groupid: 3, groupname: 'Old Thursday', counselor: 'Ana Ruiz', schedule: 'Thursdays @ 5:00 PM', active: false },
  { groupid: 4, groupname: 'Covered by Bo', counselor: 'Bo Lee', schedule: 'Thursdays @ 8:00 PM', active: true },
];

describe('my groups', () => {
  it('match the counselor name regardless of case and spaces', () => {
    expect([...myGroupIds(groups, 'Ana Ruiz')].sort()).toEqual(['1', '2', '3']);
  });

  it('lists only my active groups that meet on the given day', () => {
    expect(groupsMeetingOn(groups, 'Ana Ruiz', 'Thursday').map(g => g.groupname)).toEqual(['Thursday Men']);
    expect(groupsMeetingOn(groups, 'Ana Ruiz', 'Monday')).toEqual([]);
  });

  it('names the weekday of a date', () => {
    expect(weekdayName(new Date(2026, 10, 12))).toBe('Thursday');
  });
});

describe('calendar', () => {
  it('lays a month out in weeks starting Sunday, with blank cells around it', () => {
    const cells = monthGrid('2026-11');
    expect(cells.length % 7).toBe(0);
    expect(cells[new Date(2026, 10, 1).getDay()]).toBe('2026-11-01');
    expect(cells.filter(Boolean)).toHaveLength(30);
  });

  it('moves between months across a year', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('puts my scheduled groups on their days from today on', () => {
    const byDay = scheduledDatesIn(groups, 'Ana Ruiz', '2026-11', '2026-11-10');
    // Ana leads a Tuesday group and a Thursday group (the Thursday one is inactive, so it's skipped)
    expect([...byDay.keys()]).toEqual(['2026-11-10', '2026-11-12', '2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26']);
    expect(byDay.get('2026-11-12')?.map(g => g.groupname)).toEqual(['Thursday Men']);
    expect(byDay.get('2026-11-11')).toBeUndefined();
  });
});

describe('my clients', () => {
  const mine = myGroupIds(groups, 'Ana Ruiz');

  it('includes clients in my groups, individual groups, or that I assessed', () => {
    expect(isMyClient({ groupid: 1 }, mine, 'Ana Ruiz')).toBe(true);
    expect(isMyClient({ groupid: null, individualgroupid: 3 }, mine, 'Ana Ruiz')).toBe(true);
    expect(isMyClient({ groupid: 4, assessor: 'ana ruiz' }, mine, 'Ana Ruiz')).toBe(true);
  });

  it('leaves out clients in other counselors\' groups with no assessment by me', () => {
    expect(isMyClient({ groupid: 4, assessor: 'Bo Lee' }, mine, 'Ana Ruiz')).toBe(false);
    expect(isMyClient({ groupid: null, individualgroupid: null, assessor: '' }, mine, 'Ana Ruiz')).toBe(false);
  });

  it('lists my active clients with no attendance this month, by name', () => {
    const rows = clientsNotAttendedThisMonth([
      { lastname: 'Zed', firstname: 'A', programstatus: 'Active', attendedthismonth: false },
      { lastname: 'Adams', firstname: 'B', programstatus: 'Active', attendedthismonth: true },
      { lastname: 'Baker', firstname: 'C', programstatus: 'Discharged', attendedthismonth: false },
      { lastname: 'Cole', firstname: 'D', programstatus: 'Active', attendedthismonth: null },
    ]);
    expect(rows.map(r => r.lastname)).toEqual(['Cole', 'Zed']);
  });
});

describe('assessment pick list', () => {
  const clients = [
    { clientid: 1, lastname: 'Adams', programstatus: 'Active', assessor: null },
    { clientid: 2, lastname: 'Baker', programstatus: 'Active', assessor: 'Bo Lee' },
    { clientid: 3, lastname: 'Cole', programstatus: 'Active', assessor: ' ana ruiz ' },
    { clientid: 4, lastname: 'Dunn', programstatus: 'Discharged', assessor: 'Ana Ruiz' },
    { clientid: 5, lastname: 'Evans', programstatus: 'Active', assessor: 'Ana Ruiz' },
  ];

  it('puts active clients waiting for this assessor first, tagged, then the rest in order', () => {
    const list = assessmentPickList(clients, 'Ana Ruiz');
    expect(list.map(c => c.clientid)).toEqual([3, 5, 1, 2]);
    expect(list.map(c => c.tag)).toEqual(['Waiting for assessment', 'Waiting for assessment', undefined, undefined]);
  });

  it('tags no one when no assessor is chosen', () => {
    expect(assessmentPickList(clients, '').every(c => !c.tag)).toBe(true);
  });
});
