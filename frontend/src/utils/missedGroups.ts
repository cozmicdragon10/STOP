import type { MissedGroup } from '../api';
import { localYmd } from './dates';

// What a missed group row says on the Attendance tab. Phase 2/3/4 clients come once a month / quarter / half year, so
// their miss is a whole period with no group check-in (backend/lib/missedGroups.js).
export const missedGroupLabel = (m: Pick<MissedGroup, 'everymonths'>): string => {
  if (m.everymonths === 1) return 'No group check-in this month';
  if (m.everymonths === 3) return 'No group check-in this quarter';
  if (m.everymonths === 6) return 'No group check-in these six months';
  return 'Missed group';
};

// The Attendance tab's missed count: all of them, how many were called in, and how many in the last 90 days
export const missedGroupSummary = (rows: Pick<MissedGroup, 'date' | 'calledin'>[], today: Date = new Date()) => {
  const since = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 90);
  const sinceYmd = localYmd(since);
  const calledIn = rows.filter(m => m.calledin).length;
  return {
    total: rows.length,
    calledIn,
    noShows: rows.length - calledIn,
    last90: rows.filter(m => m.date >= sinceYmd).length,
    latest: rows.reduce<string | null>((max, m) => (!max || m.date > max ? m.date : max), null),
  };
};
