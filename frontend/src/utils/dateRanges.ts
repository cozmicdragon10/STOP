// Quick date ranges for the reports' From/To boxes ("This Month", "Last Week", ...). Days are 'YYYY-MM-DD' (local);
// weeks run Monday to Sunday, like the rest of the app (missed groups count by Monday-to-Sunday weeks).

export type RangeKey = 'today' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear';

export const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'Today',
  thisWeek: 'This Week',
  lastWeek: 'Last Week',
  thisMonth: 'This Month',
  lastMonth: 'Last Month',
  thisYear: 'This Year',
  lastYear: 'Last Year',
};

// The set most reports offer; the Financial Summary uses months and years instead
export const DAY_TO_DAY_RANGES: RangeKey[] = ['today', 'thisWeek', 'lastWeek', 'thisMonth', 'lastMonth'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// From and To for a quick range, as of today. Ranges that include today end today, not later.
export function dateRange(key: RangeKey, today: string): { from: string; to: string } {
  const t = parse(today);
  const y = t.getFullYear();
  const m = t.getMonth();
  // Monday of this week (Sunday counts as the end of the week before it starts again)
  const monday = new Date(y, m, t.getDate() - ((t.getDay() + 6) % 7));
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'thisWeek': return { from: ymd(monday), to: today };
    case 'lastWeek': {
      const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7);
      const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1);
      return { from: ymd(start), to: ymd(end) };
    }
    case 'thisMonth': return { from: ymd(new Date(y, m, 1)), to: today };
    case 'lastMonth': return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case 'thisYear': return { from: `${y}-01-01`, to: today };
    case 'lastYear': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
}

// Which quick range From and To are showing, if any (so its button can show as on)
export const activeRange = (keys: RangeKey[], from: string, to: string, today: string): RangeKey | null =>
  keys.find(k => {
    const r = dateRange(k, today);
    return r.from === from && r.to === to;
  }) ?? null;
