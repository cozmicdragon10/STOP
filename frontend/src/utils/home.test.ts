import { describe, expect, it } from 'vitest';
import { meetingsOn, needsGroup, polySlotsOn } from './home';

describe('needsGroup', () => {
  it('flags active clients in a program with groups who have no group of either kind', () => {
    expect(needsGroup({ programstatus: 'Active', programtype: 'State SO' })).toBe(true);
    expect(needsGroup({ programstatus: 'Active', programtype: 'State SO', groupid: 4 })).toBe(false);
    expect(needsGroup({ programstatus: 'Active', programtype: 'BIP', individualgroupid: 9 })).toBe(false);
  });

  it('leaves out inactive clients and programs without group types', () => {
    expect(needsGroup({ programstatus: 'Inactive', programtype: 'State SO' })).toBe(false);
    expect(needsGroup({ programstatus: 'Active', programtype: 'Something Else' })).toBe(false);
  });
});

// 2026-11-19 is a Thursday
const THURSDAY = '2026-11-19';
const groups = [
  { groupid: 1, groupname: 'Late Men', counselor: 'Ana Ruiz', schedule: 'Thursdays @ 7:00 PM', active: true },
  { groupid: 2, groupname: 'Early Men', counselor: 'Bo Lee', schedule: 'Thursdays @ 5:00 PM', active: true },
  { groupid: 3, groupname: 'Old Group', counselor: 'Bo Lee', schedule: 'Thursdays @ 6:00 PM', active: false },
  { groupid: 4, groupname: 'Tuesday Men', counselor: 'Ana Ruiz', schedule: 'Tuesdays @ 6:00 PM', active: true },
  { groupid: 5, groupname: 'Cancelled One', counselor: 'Cy Park', schedule: 'Thursdays @ 6:00 PM', active: true },
];

describe('meetingsOn', () => {
  it('lists every counselor\'s active groups meeting that weekday, by time', () => {
    expect(meetingsOn(groups, [], THURSDAY).map(m => [m.groupname, m.status]))
      .toEqual([['Early Men', 'scheduled'], ['Cancelled One', 'scheduled'], ['Late Men', 'scheduled']]);
  });

  it('applies the day\'s cancellations and reschedules', () => {
    const changes = [
      { changeid: 10, groupid: 5, groupname: 'Cancelled One', originaldate: THURSDAY, action: 'Cancelled' as const, newdate: null, newtime: null },
      { changeid: 11, groupid: 1, groupname: 'Late Men', originaldate: THURSDAY, action: 'Rescheduled' as const, newdate: '2026-11-20', newtime: '19:00' },
      { changeid: 12, groupid: 4, groupname: 'Tuesday Men', originaldate: '2026-11-17', action: 'Rescheduled' as const, newdate: THURSDAY, newtime: '16:00' },
    ];
    const list = meetingsOn(groups, changes, THURSDAY);
    expect(list.map(m => [m.groupname, m.status])).toEqual([
      ['Tuesday Men', 'movedHere'], ['Early Men', 'scheduled'], ['Cancelled One', 'cancelled'], ['Late Men', 'movedAway'],
    ]);
    expect(list[0].counselor).toBe('Ana Ruiz');
    expect(list[3].note).toMatch(/^Moved to /);
  });
});

describe('polySlotsOn', () => {
  it('keeps the day\'s slots by time and counts them by status', () => {
    const slots = [
      { slotid: 1, date: `${THURSDAY}T00:00:00.000Z`, time: '13:00:00', status: 'Open' as const },
      { slotid: 2, date: THURSDAY, time: '09:00:00', status: 'Assigned' as const },
      { slotid: 3, date: '2026-11-20', time: '09:00:00', status: 'Open' as const },
      { slotid: 4, date: THURSDAY, time: '', status: 'Closed' as const },
    ];
    const day = polySlotsOn(slots, THURSDAY);
    expect(day.list.map(s => s.slotid)).toEqual([2, 1, 4]);
    expect([day.open, day.assigned, day.closed]).toEqual([1, 1, 1]);
  });
});
