import { describe, expect, it } from 'vitest';
import { clientsNotAttendedThisMonth, groupsMeetingOn, isMyClient, myGroupIds, weekdayName } from './counselor';

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
