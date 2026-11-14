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

// The dates in a month, from today on, when one of my active groups meets (by its schedule), keyed by day
export const scheduledDatesIn = <T extends { groupname?: string | null; counselor?: string | null; schedule?: string | null; active?: boolean | null }>(
  groups: T[],
  displayName: string,
  month: string,
  today: string,
) => {
  const mine = groups.filter(g => g.active !== false && isMyGroup(g, displayName));
  const byDay = new Map<string, T[]>();
  for (const day of monthGrid(month)) {
    if (!day || day < today) continue;
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
