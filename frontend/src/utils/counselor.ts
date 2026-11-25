import { parseSchedule } from './schedule';

// Counselor helpers: which groups and clients are "mine" (the ones this counselor leads or assessed), and what My Day lists.
// Groups.Counselor and Clients.Assessor hold display names, so names are compared without case or extra spaces.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const sameName = (a: string | null | undefined, b: string | null | undefined) => {
  const x = (a || '').trim().toLowerCase();
  return x !== '' && x === (b || '').trim().toLowerCase();
};

export const weekdayName = (date: Date) => WEEKDAYS[date.getDay()];

// A group this counselor leads
export const isMyGroup = (group: { counselor?: string | null }, displayName: string) => sameName(group.counselor, displayName);

// The ids of the groups this counselor leads, as strings
export const myGroupIds = (groups: { groupid: number | string; counselor?: string | null }[], displayName: string) =>
  new Set(groups.filter(g => isMyGroup(g, displayName)).map(g => String(g.groupid)));

// What decides whether a client is mine
export interface ClientOwnership {
  groupid?: number | string | null;
  individualgroupid?: number | string | null;
  assessor?: string | null;
}

// A client in one of my groups (regular or individual), or one I assessed
export const isMyClient = (client: ClientOwnership, groupIds: Set<string>, displayName: string) => {
  const inMyGroup = (id: number | string | null | undefined) => id !== null && id !== undefined && id !== '' && groupIds.has(String(id));
  return inMyGroup(client.groupid) || inMyGroup(client.individualgroupid) || sameName(client.assessor, displayName);
};

// Clients to offer for an assessment time with this assessor: active clients only, those waiting to be assessed by them
// (Clients.Assessor) first and tagged, then everyone else, each part in the order given
export const assessmentPickList = <T extends { programstatus?: string | null; assessor?: string | null }>(clients: T[], assessor: string) => {
  const active = clients.filter(c => (c.programstatus || '') === 'Active');
  const waiting = active.filter(c => sameName(c.assessor, assessor));
  return [
    ...waiting.map(c => ({ ...c, tag: 'Waiting for assessment' })),
    ...active.filter(c => !sameName(c.assessor, assessor)).map(c => ({ ...c, tag: undefined })),
  ];
};

// Items split by counselor name (ignoring case and extra spaces), counselors A to Z with "No counselor" last; each
// counselor's items keep the order given
export const NO_COUNSELOR = 'No counselor';
export const groupByCounselor = <T>(items: T[], counselorOf: (item: T) => string | null | undefined) => {
  const sections = new Map<string, { counselor: string; items: T[] }>();
  for (const item of items) {
    const name = (counselorOf(item) || '').trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (!sections.has(key)) sections.set(key, { counselor: name || NO_COUNSELOR, items: [] });
    sections.get(key)!.items.push(item);
  }
  return [...sections.entries()]
    .sort(([a, x], [b, y]) => (a === '' ? 1 : b === '' ? -1 : x.counselor.localeCompare(y.counselor)))
    .map(([, section]) => section);
};

// Groups I lead that meet on the given weekday (schedules read like "Thursdays @ 7:00 PM"), by name
export const groupsMeetingOn = <T extends { groupname?: string | null; counselor?: string | null; schedule?: string | null; active?: boolean | null }>(
  groups: T[],
  displayName: string,
  day: string,
): T[] => groups
  .filter(g => g.active !== false && isMyGroup(g, displayName) && parseSchedule(g.schedule || '').day === day)
  .sort((a, b) => String(a.groupname || '').localeCompare(String(b.groupname || '')));

// Calendar helpers. Months are "YYYY-MM"; days are "YYYY-MM-DD" in local time.
const pad2 = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const monthOfDate = (d: Date) => dayKey(d).slice(0, 7);
// The Sunday of a day's week; weeks run Sunday to Saturday, like the calendars and the BIP once-a-week rule
export const weekStartOf = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(d - date.getDay());
  return dayKey(date);
};

// Days a group had a check-in, for the calendar: on (that exact day, "groupid|YYYY-MM-DD") and inWeek (the days it was
// held each week, keyed "groupid|<the week's Sunday>", in date order). A group held on another day of a week stands in
// for that week's regular meeting, so a counselor who forgot to reschedule doesn't show a meeting that never happened.
export const groupHeldDays = (days: { groupid: number | string; sessiondate: string }[]) => {
  const inWeek = new Map<string, string[]>();
  for (const d of [...days].sort((a, b) => a.sessiondate.localeCompare(b.sessiondate))) {
    const key = `${d.groupid}|${weekStartOf(d.sessiondate)}`;
    const held = inWeek.get(key) ?? [];
    if (!held.includes(d.sessiondate)) inWeek.set(key, [...held, d.sessiondate]);
  }
  return { on: new Set(days.map(d => `${d.groupid}|${d.sessiondate}`)), inWeek };
};

// The month before or after (delta -1 or 1) a "YYYY-MM"
export const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

// The month as a calendar grid, weeks starting Sunday: each day's key, or null for the blank cells around the month
export const monthGrid = (month: string): (string | null)[] => {
  const [y, m] = month.split('-').map(Number);
  const cells: (string | null)[] = Array.from({ length: new Date(y, m - 1, 1).getDay() }, () => null);
  const days = new Date(y, m, 0).getDate();
  for (let d = 1; d <= days; d++) cells.push(`${month}-${pad2(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

// Every date in a month (past days too) when one of my active groups meets (by its schedule), keyed by day
export const scheduledDatesIn = <T extends { groupname?: string | null; counselor?: string | null; schedule?: string | null; active?: boolean | null }>(
  groups: T[],
  displayName: string,
  month: string,
) => {
  const mine = groups.filter(g => g.active !== false && isMyGroup(g, displayName));
  const byDay = new Map<string, T[]>();
  for (const day of monthGrid(month)) {
    if (!day) continue;
    const [y, m, d] = day.split('-').map(Number);
    const meets = mine.filter(g => parseSchedule(g.schedule || '').day === weekdayName(new Date(y, m - 1, d)));
    if (meets.length > 0) byDay.set(day, meets);
  }
  return byDay;
};

// My active clients who have no attendance this month, by name
export const clientsNotAttendedThisMonth = <T extends { programstatus?: string | null; attendedthismonth?: boolean | null; lastname?: string | null; firstname?: string | null }>(
  clients: T[],
) => clients
  .filter(c => c.programstatus === 'Active' && !c.attendedthismonth)
  .sort((a, b) => `${a.lastname || ''} ${a.firstname || ''}`.localeCompare(`${b.lastname || ''} ${b.firstname || ''}`));
