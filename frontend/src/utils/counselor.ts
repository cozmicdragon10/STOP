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

// My active clients who have no attendance this month, by name
export const clientsNotAttendedThisMonth = <T extends { programstatus?: string | null; attendedthismonth?: boolean | null; lastname?: string | null; firstname?: string | null }>(
  clients: T[],
) => clients
  .filter(c => c.programstatus === 'Active' && !c.attendedthismonth)
  .sort((a, b) => `${a.lastname || ''} ${a.firstname || ''}`.localeCompare(`${b.lastname || ''} ${b.firstname || ''}`));
