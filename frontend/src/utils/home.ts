// Home page rules: the office counts and today's schedule for Business Administrators (and DEV, who sign in as one)
import { GROUP_TYPES_BY_PROGRAM } from './clients';
import { dayKey, weekdayName } from './counselor';
import { formatDisplayTime } from './dates';
import { parseSchedule } from './schedule';
import { slotStart } from './polygraph';

// An active client in a program that has group types (GROUP_TYPES_BY_PROGRAM) with neither a regular nor an individual
// group. Used by the Home count and the Client Roster's "Needs a group" filter, so the two always agree.
export const needsGroup = (c: { programstatus?: string | null; programtype?: string | null; groupid?: unknown; individualgroupid?: unknown }) =>
  c.programstatus === 'Active' && !!GROUP_TYPES_BY_PROGRAM[c.programtype || ''] && !c.groupid && !c.individualgroupid;

export interface HomeGroup {
  groupid: number | string;
  groupname?: string | null;
  counselor?: string | null;
  schedule?: string | null;
  active?: boolean | null;
}

export interface HomeScheduleChange {
  changeid: number;
  groupid: number | string;
  groupname: string;
  originaldate: string;
  action: 'Cancelled' | 'Rescheduled';
  newdate: string | null;
  newtime: string | null;
}

// One group meeting on the day. status: meeting as scheduled, moved here from another day, or called off / moved away.
export interface TodayMeeting {
  key: string;
  groupname: string;
  counselor: string;
  time: string;
  status: 'scheduled' | 'movedHere' | 'cancelled' | 'movedAway';
  note: string;
}

// '7:00 PM' or '19:00:00' -> minutes after midnight, for sorting; unreadable times go last
const minutesOf = (time: string) => {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*$/i.exec(time || '');
  if (!m) return 24 * 60;
  let h = parseInt(m[1], 10) % (m[3] ? 12 : 24);
  if (m[3]?.toLowerCase() === 'pm') h += 12;
  return h * 60 + Number(m[2]);
};

// 'YYYY-MM-DD' -> 'Nov 18'
const shortDate = (day: string) => {
  const [y, mo, d] = day.split('-').map(Number);
  return y && mo && d ? new Date(y, mo - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : day;
};

// Every active group's meeting on `today` (YYYY-MM-DD, local), with the day's cancellations and reschedules applied,
// sorted by time. A group that meets by its weekly schedule shows as cancelled or moved away when changed; a meeting
// rescheduled onto today shows as moved here.
export const meetingsOn = (groups: HomeGroup[], changes: HomeScheduleChange[], today: string): TodayMeeting[] => {
  const [y, m, d] = today.split('-').map(Number);
  const weekday = weekdayName(new Date(y, m - 1, d));
  const active = groups.filter(g => g.active !== false);
  const byId = new Map(active.map(g => [String(g.groupid), g]));
  const changeFor = new Map(changes.filter(c => c.originaldate === today).map(c => [String(c.groupid), c]));
  const list: TodayMeeting[] = [];

  for (const g of active) {
    const { day, time } = parseSchedule(g.schedule || '');
    if (day !== weekday) continue;
    const change = changeFor.get(String(g.groupid));
    const base = { groupname: g.groupname || 'Group', counselor: g.counselor || '', time };
    if (!change) list.push({ ...base, key: `g${g.groupid}`, status: 'scheduled', note: '' });
    else if (change.action === 'Cancelled') list.push({ ...base, key: `c${change.changeid}`, status: 'cancelled', note: 'Cancelled' });
    else list.push({
      ...base, key: `a${change.changeid}`, status: 'movedAway',
      note: `Moved to ${shortDate(change.newdate || '')}${change.newtime ? ` at ${formatDisplayTime(change.newtime)}` : ''}`,
    });
  }
  for (const c of changes) {
    if (c.action !== 'Rescheduled' || c.newdate !== today) continue;
    const g = byId.get(String(c.groupid));
    list.push({
      key: `h${c.changeid}`, groupname: c.groupname || g?.groupname || 'Group', counselor: g?.counselor || '',
      time: formatDisplayTime(c.newtime || ''), status: 'movedHere', note: `Moved here from ${shortDate(c.originaldate)}`,
    });
  }
  return list.sort((a, b) => minutesOf(a.time) - minutesOf(b.time) || a.groupname.localeCompare(b.groupname));
};

export interface HomeSlot {
  slotid: number;
  date: string;
  time: string;
  location?: string | null;
  polygrapher?: string | null;
  status?: string | null;
  assignedClientName?: string | null;
}

// The polygraph slots on `today` (YYYY-MM-DD), by time, and how many are open, booked or closed
export const polySlotsOn = <T extends HomeSlot>(slots: T[], today: string) => {
  const list = slots
    .filter(s => String(s.date || '').split('T')[0] === today)
    .map(s => ({ s, at: slotStart(s)?.getTime() ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.at - b.at)
    .map(x => x.s);
  const count = (st: string) => list.filter(s => (s.status || 'Open') === st).length;
  return { list, open: count('Open'), assigned: count('Assigned'), closed: count('Closed') };
};

// A day (YYYY-MM-DD, local) moved by delta days
export const shiftDay = (day: string, delta: number) => {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(y, m - 1, d + delta);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
};

// 'Today', 'Yesterday' or 'Tomorrow' when the day is one of those, otherwise ''
export const relativeDayName = (day: string, today: string) =>
  day === today ? 'Today' : day === shiftDay(today, -1) ? 'Yesterday' : day === shiftDay(today, 1) ? 'Tomorrow' : '';

// A Polygrapher's own slots (the examiner's email, compared without case), for their Home page:
// - needResult: booked appointments whose time has passed, still waiting on a result (oldest first). A booked slot
//   keeps the Assigned status until its result is recorded or it is cancelled.
// - bookedSoon: booked appointments from now through the next 7 days
// - openAhead: open slots from now on, not yet booked
export const polygrapherSlots = <T extends HomeSlot>(slots: T[], email: string, now = new Date()) => {
  const me = email.trim().toLowerCase();
  const mine = slots.filter(s => (s.polygrapher || '').trim().toLowerCase() === me);
  const today = dayKey(now);
  const weekEnd = shiftDay(today, 7);
  const dayOf = (s: T) => String(s.date || '').split('T')[0];
  // A slot without a readable time counts as passed once its day is over
  const passed = (s: T) => {
    const start = slotStart(s);
    return start ? start.getTime() <= now.getTime() : dayOf(s) < today;
  };
  const byTime = (a: T, b: T) => (slotStart(a)?.getTime() ?? 0) - (slotStart(b)?.getTime() ?? 0) || a.slotid - b.slotid;
  const booked = mine.filter(s => s.status === 'Assigned');
  return {
    mine,
    needResult: booked.filter(passed).sort(byTime),
    bookedSoon: booked.filter(s => !passed(s) && dayOf(s) < weekEnd).sort(byTime),
    openAhead: mine.filter(s => (s.status || 'Open') === 'Open' && !passed(s)).sort(byTime),
  };
};
