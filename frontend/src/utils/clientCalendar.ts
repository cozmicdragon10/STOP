import { formatDisplayTime, localYmd } from './dates';
import { monthGrid, weekdayName } from './counselor';
import { parseSchedule } from './schedule';
import type { CalendarTone } from './calendar';

// What a client's Attendance calendar shows besides their attendance: their group's meetings from today on (with any
// cancelled or moved), their booked assessment times and polygraphs, and the polygraphs they've taken.
// The data comes from GET /api/clients/:id/calendar.

export interface ClientCalendarData {
  today: string;
  phase: string | null;
  // Set only while the client is Active in an active group
  group: { groupid: number; groupname: string; schedule: string | null; counselor: string | null } | null;
  changes: { changeid: number; originaldate: string; action: 'Cancelled' | 'Rescheduled'; newdate: string | null; newtime: string | null; reason: string | null }[];
  assessments: { appointmentid: number; date: string; time: string | null; assessor: string | null; location: string | null }[];
  polygraphs: { appointmentid: number; date: string; time: string | null; type: string | null; location: string | null }[];
  polygraphsTaken: { resultid: number; date: string; time: string | null; type: string | null }[];
}

export interface ClientCalendarEntry {
  key: string;
  tone: CalendarTone;
  kind?: 'assessment' | 'polygraph';
  // Short chip text, and the hover text
  label: string;
  title: string;
}

// Phase 2/3/4 clients come to one group meeting a month / quarter / half year, not every week
const PERIODIC_PHASES: Record<string, string> = {
  'Phase 2 - Monthly': 'once a month',
  'Phase 3 - Quarterly': 'once a quarter',
  'Phase 4 - Semi Anual': 'once every six months',
};
export const phaseAttendanceNote = (phase: string | null | undefined) => {
  const often = PERIODIC_PHASES[phase || ''];
  return often ? `${phase}: comes to one of these group meetings ${often}.` : '';
};

const shortDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const at = (time: string | null | undefined) => (time ? ` at ${formatDisplayTime(time)}` : '');

/**
 * The entries for one month ('YYYY-MM'), by day.
 * checkedInDays: days the client already has a group check-in (a meeting today they've already attended isn't "coming up")
 * shownChangeIds: cancellations the calendar already shows from the client's case notes, so they aren't shown twice
 */
export function clientCalendarEntries(
  data: ClientCalendarData,
  month: string,
  checkedInDays: Set<string> = new Set(),
  shownChangeIds: Set<number> = new Set(),
): Map<string, ClientCalendarEntry[]> {
  const byDay = new Map<string, ClientCalendarEntry[]>();
  const add = (day: string, entry: ClientCalendarEntry) => {
    if (!day.startsWith(month)) return;
    byDay.set(day, [...(byDay.get(day) ?? []), entry]);
  };
  const { today, group } = data;

  if (group) {
    const { day: meetsOn, time } = parseSchedule(group.schedule || '');
    const name = group.groupname;
    const changeOn = new Map(data.changes.map(c => [c.originaldate, c]));
    if (meetsOn) {
      for (const day of monthGrid(month)) {
        if (!day || day < today || checkedInDays.has(day)) continue;
        const [y, m, d] = day.split('-').map(Number);
        if (weekdayName(new Date(y, m - 1, d)) !== meetsOn) continue;
        const change = changeOn.get(day);
        const why = change?.reason ? ` (${change.reason})` : '';
        if (!change) {
          add(day, { key: `g-${day}`, tone: 'booked', label: name, title: `${name}${time ? ` at ${time}` : ''}: coming up` });
        } else if (change.action === 'Cancelled') {
          if (!shownChangeIds.has(change.changeid)) {
            add(day, { key: `x-${change.changeid}`, tone: 'cancelled', label: name, title: `${name}: group cancelled${why}` });
          }
        } else if (change.newdate) {
          add(day, { key: `m-${change.changeid}`, tone: 'moved', label: `${name} → ${shortDate(change.newdate)}`, title: `${name}: moved to ${shortDate(change.newdate)}${at(change.newtime)}${why}` });
        }
      }
    }
    // Where a moved meeting went (its original day may be in another month)
    for (const c of data.changes) {
      if (c.action !== 'Rescheduled' || !c.newdate || c.newdate < today || checkedInDays.has(c.newdate)) continue;
      add(c.newdate, {
        key: `r-${c.changeid}`, tone: 'booked', label: `${c.newtime ? `${formatDisplayTime(c.newtime)} ` : ''}${name}`,
        title: `${name}${at(c.newtime)}: moved here from ${shortDate(c.originaldate)}`,
      });
    }
  }

  for (const a of data.assessments) {
    add(a.date, {
      key: `a-${a.appointmentid}`, tone: 'booked', kind: 'assessment', label: `${a.time ? `${formatDisplayTime(a.time)} ` : ''}Assessment`,
      title: `Assessment${at(a.time)}${a.assessor ? ` with ${a.assessor}` : ''}${a.location ? `, ${a.location}` : ''}`,
    });
  }

  // A polygraph taken shows as done; a booked one on the same day (its result is in) isn't shown again
  const takenDays = new Set(data.polygraphsTaken.map(p => p.date));
  for (const p of data.polygraphsTaken) {
    add(p.date, {
      key: `pt-${p.resultid}`, tone: 'done', kind: 'polygraph', label: `Polygraph${p.type ? `: ${p.type}` : ''}`,
      title: `Polygraph taken${p.type ? ` (${p.type})` : ''}${at(p.time)}`,
    });
  }
  for (const p of data.polygraphs) {
    if (takenDays.has(p.date)) continue;
    add(p.date, {
      key: `p-${p.appointmentid}`, tone: 'booked', kind: 'polygraph', label: `${p.time ? `${formatDisplayTime(p.time)} ` : ''}Polygraph`,
      title: `Polygraph${p.type ? ` (${p.type})` : ''}${at(p.time)}${p.location ? `, ${p.location}` : ''}`,
    });
  }
  return byDay;
}

// Attendance types that mean the client came to group that day (a meeting that day isn't still "coming up")
const GROUP_CHECK_IN_TYPES = new Set(['Group', 'Make-Up']);
// The days the client has a group check-in, from their attendance rows (cancelled and missed rows aren't check-ins)
export const groupCheckInDays = (rows: { date?: unknown; type?: string; cancellation?: boolean; missed?: boolean }[]) =>
  new Set(rows.filter(r => !r.cancellation && !r.missed && GROUP_CHECK_IN_TYPES.has(r.type || '')).map(r => localYmd(r.date)));

// One line of the "Coming up" box on a client's Attendance tab
export interface UpcomingItem {
  key: string;
  day: string;
  // HH:MM, '' when unknown; for sorting a day's items
  sort: string;
  tone: CalendarTone;
  kind?: 'assessment' | 'polygraph';
  what: string;
  detail: string;
}

const addDays = (ymd: string, days: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(y, m - 1, d + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
};
// '5:30 PM' -> '17:30'
const to24h = (time: string) => {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time);
  return match ? `${String((Number(match[1]) % 12) + (match[3] === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[2]}` : '';
};

/**
 * What's next for the client, soonest first: their next group meeting (only the next one, since they repeat weekly),
 * any of their group's meetings cancelled or moved in the next `windowDays`, and every booked assessment and polygraph.
 * checkedInDays: days they already checked in to group (today's meeting is then done, not next)
 */
export function upcomingItems(data: ClientCalendarData, checkedInDays: Set<string> = new Set(), windowDays = 28): UpcomingItem[] {
  const { today, group } = data;
  const until = addDays(today, windowDays);
  const items: UpcomingItem[] = [];

  if (group) {
    const { day: meetsOn, time } = parseSchedule(group.schedule || '');
    const name = group.groupname;
    const changeOn = new Map(data.changes.map(c => [c.originaldate, c]));
    // Meetings that will happen: regular ones not changed, and moved ones on their new day
    const meetings: { day: string; sort: string; detail: string }[] = [];
    if (meetsOn) {
      // A quarter ahead is plenty to find the next meeting, even after a few cancellations
      for (let i = 0; i < 92; i++) {
        const day = addDays(today, i);
        const [y, m, d] = day.split('-').map(Number);
        if (weekdayName(new Date(y, m - 1, d)) !== meetsOn || checkedInDays.has(day)) continue;
        const change = changeOn.get(day);
        const why = change?.reason ? ` · ${change.reason}` : '';
        if (!change) meetings.push({ day, sort: to24h(time), detail: `Next group meeting${time ? ` · ${time}` : ''}` });
        else if (day <= until && change.action === 'Cancelled') {
          items.push({ key: `x-${change.changeid}`, day, sort: to24h(time), tone: 'cancelled', what: name, detail: `Cancelled${why}` });
        } else if (day <= until && change.newdate) {
          items.push({
            key: `m-${change.changeid}`, day, sort: to24h(time), tone: 'moved', what: name,
            detail: `Moved to ${shortDate(change.newdate)}${at(change.newtime)}${why}`,
          });
        }
      }
    }
    for (const c of data.changes) {
      if (c.action !== 'Rescheduled' || !c.newdate || c.newdate < today || checkedInDays.has(c.newdate)) continue;
      meetings.push({ day: c.newdate, sort: c.newtime || '', detail: `Group meeting moved here from ${shortDate(c.originaldate)}${at(c.newtime)}` });
    }
    const next = meetings.sort((a, b) => a.day.localeCompare(b.day) || a.sort.localeCompare(b.sort))[0];
    if (next) items.push({ key: `g-${next.day}`, day: next.day, sort: next.sort, tone: 'booked', what: name, detail: next.detail });
  }

  for (const a of data.assessments) {
    items.push({
      key: `a-${a.appointmentid}`, day: a.date, sort: a.time || '', tone: 'booked', kind: 'assessment', what: 'Assessment',
      detail: [a.time && formatDisplayTime(a.time), a.assessor && `with ${a.assessor}`, a.location].filter(Boolean).join(' · '),
    });
  }
  const takenDays = new Set(data.polygraphsTaken.map(p => p.date));
  for (const p of data.polygraphs) {
    if (takenDays.has(p.date)) continue;
    items.push({
      key: `p-${p.appointmentid}`, day: p.date, sort: p.time || '', tone: 'booked', kind: 'polygraph', what: `Polygraph${p.type ? ` (${p.type})` : ''}`,
      detail: [p.time && formatDisplayTime(p.time), p.location].filter(Boolean).join(' · '),
    });
  }
  return items.sort((a, b) => a.day.localeCompare(b.day) || a.sort.localeCompare(b.sort));
}

// Whether anything is on the calendar from today on, so it can open on this month
export const hasUpcoming = (data: ClientCalendarData | null) =>
  !!data && ((!!data.group && !!parseSchedule(data.group.schedule || '').day) || data.assessments.length > 0 || data.polygraphs.length > 0);
