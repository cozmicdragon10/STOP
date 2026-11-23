// Closed Groups list filters (App.tsx, Attendance > Closed). The date range is sent to the server (GET /api/closed-groups
// from / to), so older sessions can be found; the search and counselor filters work on what it sent.
import type { ClosedGroupSession } from '../api';

export type ClosedRange = '7' | '30' | '90' | 'custom';
export const CLOSED_RANGES: { value: ClosedRange; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'custom', label: 'Pick dates' },
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The days a preset covers, ending today (today counts as one of them). A custom range is used as picked; an empty
// end means no limit that way.
export const closedRangeDates = (range: ClosedRange, today: string, custom: { from: string; to: string }) => {
  if (range === 'custom') return { from: custom.from, to: custom.to };
  const d = new Date(`${today}T00:00:00`);
  d.setDate(d.getDate() - (Number(range) - 1));
  return { from: ymd(d), to: today };
};

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
const norm = (s: string | null | undefined) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Sessions matching the search (every word found in the group name or a client's name) and the counselor ('' for all)
export const filterClosedGroups = (list: ClosedGroupSession[], search: string, counselor: string) => {
  const want = words(search);
  const who = norm(counselor);
  return list.filter(c => {
    if (who && norm(c.counselor) !== who) return false;
    if (!want.length) return true;
    const text = [c.groupname, ...c.entries.map(e => e.name)].join(' ').toLowerCase();
    return want.every(w => text.includes(w));
  });
};

// The counselors in the list, A to Z (for the counselor filter)
export const closedGroupCounselors = (list: ClosedGroupSession[]) => {
  const byKey = new Map<string, string>();
  for (const c of list) {
    const name = (c.counselor || '').trim().replace(/\s+/g, ' ');
    if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
};
