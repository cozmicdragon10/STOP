import { describe, expect, it } from 'vitest';
import type { ClosedGroupSession } from '../api';
import { closedGroupCounselors, closedRangeDates, filterClosedGroups } from './closedGroups';

const session = (over: Partial<ClosedGroupSession>): ClosedGroupSession => ({
  groupid: 1, groupname: 'Okmulgee SO', counselor: 'Alicia Martinez', sessiondate: '2026-11-20', sessionnumber: 1,
  openedby: null, closedby: null, closedon: null, entries: [], ...over,
});
const client = (name: string) => ({ client: 1, name, groupFee: 0, accountPaid: 0, paymentMethod: null, attendanceId: 1, programType: null, note: null });

describe('closed groups filters', () => {
  it('turns a preset into dates ending today, across a month end', () => {
    expect(closedRangeDates('7', '2026-11-03', { from: '', to: '' })).toEqual({ from: '2026-10-28', to: '2026-11-03' });
    expect(closedRangeDates('30', '2026-11-22', { from: '', to: '' })).toEqual({ from: '2026-10-24', to: '2026-11-22' });
    expect(closedRangeDates('custom', '2026-11-22', { from: '2026-01-01', to: '' })).toEqual({ from: '2026-01-01', to: '' });
  });

  it('finds sessions by group or client name, and by counselor', () => {
    const list = [
      session({ groupid: 1, groupname: 'Okmulgee SO', entries: [client('Smith, John')] }),
      session({ groupid: 2, groupname: 'Shawnee Th-BIP', counselor: ' bob  lee ', entries: [client('Doe, Jane')] }),
    ];
    expect(filterClosedGroups(list, '', '').map(c => c.groupid)).toEqual([1, 2]);
    expect(filterClosedGroups(list, 'shawnee', '').map(c => c.groupid)).toEqual([2]);
    expect(filterClosedGroups(list, 'john smith', '').map(c => c.groupid)).toEqual([1]);
    expect(filterClosedGroups(list, '', 'Bob Lee').map(c => c.groupid)).toEqual([2]);
    expect(filterClosedGroups(list, 'smith', 'Bob Lee')).toEqual([]);
  });

  it('lists each counselor once, A to Z', () => {
    expect(closedGroupCounselors([
      session({ counselor: 'Zed' }), session({ counselor: 'alicia martinez' }), session({ counselor: 'Alicia Martinez' }), session({ counselor: null }),
    ])).toEqual(['alicia martinez', 'Zed']);
  });
});
