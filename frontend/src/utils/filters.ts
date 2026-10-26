// Default list filters and helpers for grouping and filtering record lists
import { localYmd } from './dates';

// Group Directory filters; '' means all. Status starts on Active so inactive groups are hidden until asked for.
export const DEFAULT_GROUP_FILTERS = { location: '', counselor: '', programtype: '', status: 'Active' };
// Client drawer list filters. Dates are YYYY-MM-DD, inclusive; '' means no filter.
export const EMPTY_NOTE_FILTERS = { search: '', category: '', from: '', to: '', sort: 'newest' };
export const EMPTY_ATTENDANCE_FILTERS = { search: '', group: '', type: '', payment: '', from: '', to: '', sort: 'newest' };
export const EMPTY_LEDGER_FILTERS ={ search: '', type: '', feeType: '', method: '', from: '', to: '', sort: 'newest' };

export const sortedUnique = (values: unknown[]) => Array.from(new Set(values.filter(Boolean).map(String))).sort((a, b) => a.localeCompare(b));

// Splits dated records into months (YYYY-MM), newest month first unless sorting oldest first; rows keep their order within a month
export const groupByMonth = <T extends { date: string }>(rows: T[], sort: string) => {
  const byMonth = new Map<string, T[]>();
  for (const row of rows) {
    const key = localYmd(row.date).slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(row);
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => (sort === 'oldest' ? a.localeCompare(b) : b.localeCompare(a)))
    .map(([key, list]) => {
      const [y, m] = key.split('-').map(Number);
      return { key, label: new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }), rows: list };
    });
};

export const toggleInSet = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
};
