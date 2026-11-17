import { describe, expect, it } from 'vitest';
import { meetingsOn, needsGroup, polySlotsOn, polygrapherSlots, relativeDayName, shiftDay } from './home';

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

describe('day picker', () => {
  it('moves across month and year ends', () => {
    expect(shiftDay('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDay('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDay('2026-11-17', 7)).toBe('2026-11-24');
  });

  it('names today and the days either side', () => {
    expect(relativeDayName('2026-11-17', '2026-11-17')).toBe('Today');
    expect(relativeDayName('2026-11-16', '2026-11-17')).toBe('Yesterday');
    expect(relativeDayName('2026-11-18', '2026-11-17')).toBe('Tomorrow');
    expect(relativeDayName('2026-11-20', '2026-11-17')).toBe('');
  });
});

describe('polygrapherSlots', () => {
  // Tuesday 2026-11-17 at 12:00 local
  const now = new Date(2026, 10, 17, 12, 0);
  const slots = [
    { slotid: 1, date: '2026-11-17', time: '09:00:00', polygrapher: 'Kelly@Office.com', status: 'Assigned' },
    { slotid: 2, date: '2026-11-10', time: '10:00:00', polygrapher: 'kelly@office.com', status: 'Assigned' },
    { slotid: 3, date: '2026-11-17', time: '15:00:00', polygrapher: 'kelly@office.com', status: 'Assigned' },
    { slotid: 4, date: '2026-11-24', time: '09:00:00', polygrapher: 'kelly@office.com', status: 'Assigned' },
    { slotid: 5, date: '2026-11-19', time: '09:00:00', polygrapher: 'kelly@office.com', status: 'Open' },
    { slotid: 6, date: '2026-11-17', time: '08:00:00', polygrapher: 'kelly@office.com', status: 'Closed' },
    { slotid: 7, date: '2026-11-16', time: '09:00:00', polygrapher: 'other@office.com', status: 'Assigned' },
  ];

  it('keeps only my slots and sorts out what needs a result, what is booked this week, and what is open', () => {
    const mine = polygrapherSlots(slots, ' kelly@office.com ', now);
    expect(mine.mine.map(s => s.slotid)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mine.needResult.map(s => s.slotid)).toEqual([2, 1]);
    // Slot 4 is exactly 7 days out, so not within the next 7 days
    expect(mine.bookedSoon.map(s => s.slotid)).toEqual([3]);
    expect(mine.openAhead.map(s => s.slotid)).toEqual([5]);
  });
});
