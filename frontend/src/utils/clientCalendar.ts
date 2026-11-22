import { formatDisplayTime } from './dates';
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

// Whether anything is on the calendar from today on, so it can open on this month
export const hasUpcoming = (data: ClientCalendarData | null) =>
  !!data && ((!!data.group && !!parseSchedule(data.group.schedule || '').day) || data.assessments.length > 0 || data.polygraphs.length > 0);
