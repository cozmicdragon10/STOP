import { useEffect, useState } from 'react';
import { getMySessions } from '../../api';
import type { MyClosedSession, MyOpenSession } from '../../api';
import { dayKey, monthGrid, monthOfDate, scheduledDatesIn, shiftMonth } from '../../utils/counselor';

interface GroupRow {
  groupid: number | string;
  groupname?: string | null;
  counselor?: string | null;
  schedule?: string | null;
  active?: boolean | null;
  clientcount?: number | null;
}

interface Props {
  displayName: string;
  groups: GroupRow[];
  onOpenAttendance: () => void;
}

interface DayItem {
  key: string;
  kind: 'closed' | 'open' | 'scheduled';
  groupname: string;
  groupid: number | string;
}

const KIND_STYLE: Record<DayItem['kind'], string> = {
  closed: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
  open: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
  scheduled: 'bg-transparent border-dashed border-blue-400/60 text-blue-200',
};
const KIND_LABEL: Record<DayItem['kind'], string> = { closed: 'Closed', open: 'Open', scheduled: 'Scheduled' };
const MAX_CHIPS = 3;
const WEEKDAY_HEADINGS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "Closed by you", "Closed on your behalf", etc., from what the server says about the session
const closedTags = (s: MyClosedSession) => [
  s.openedbyme && 'You opened',
  s.closedbyme ? 'You closed' : s.coveredforme && 'Closed on your behalf',
].filter(Boolean) as string[];
const openTags = (s: MyOpenSession) => [
  s.openedbyme && 'You opened',
  s.coveredforme && "You're covering",
].filter(Boolean) as string[];

const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

// The counselor's home screen: a calendar of their groups for the month (closed, open, and what's coming up), and the
// sessions they opened, closed, or covered that month. No client or money figures here.
export default function MyDay({ displayName, groups, onOpenAttendance }: Props) {
  const todayKey = dayKey(new Date());
  const [month, setMonth] = useState(monthOfDate(new Date()));
  const [sessions, setSessions] = useState<{ closed: MyClosedSession[]; open: MyOpenSession[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getMySessions(month)
      .then(rows => { if (!cancelled) { setSessions(rows); setError(''); } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load your sessions.'); });
    return () => { cancelled = true; };
  }, [month]);

  // Calendar entries by day: sessions from the server, then the upcoming scheduled groups that haven't happened yet
  const byDay = new Map<string, DayItem[]>();
  const add = (day: string, item: DayItem) => byDay.set(day, [...(byDay.get(day) ?? []), item]);
  const taken = new Set<string>();
  for (const s of sessions?.closed ?? []) {
    taken.add(`${s.sessiondate}|${s.groupid}`);
    add(s.sessiondate, { key: `c${s.groupid}-${s.sessiondate}-${s.sessionnumber}`, kind: 'closed', groupname: s.groupname, groupid: s.groupid });
  }
  for (const s of sessions?.open ?? []) {
    taken.add(`${s.sessiondate}|${s.groupid}`);
    add(s.sessiondate, { key: `o${s.groupid}-${s.sessiondate}-${s.sessionnumber}`, kind: 'open', groupname: s.groupname, groupid: s.groupid });
  }
  for (const [day, meets] of scheduledDatesIn(groups, displayName, month, todayKey)) {
    for (const g of meets) {
      if (taken.has(`${day}|${g.groupid}`)) continue;
      add(day, { key: `s${g.groupid}-${day}`, kind: 'scheduled', groupname: g.groupname || '', groupid: g.groupid });
    }
  }

  const listed = [
    ...(sessions?.closed ?? []).map(s => ({ day: s.sessiondate, kind: 'closed' as const, groupname: s.groupname, tags: closedTags(s), clients: s.clients })),
    ...(sessions?.open ?? []).map(s => ({ day: s.sessiondate, kind: 'open' as const, groupname: s.groupname, tags: openTags(s), clients: null })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.groupname.localeCompare(b.groupname));

  const isCurrentMonth = month === monthOfDate(new Date());

  return (
    <section aria-label="My Day" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">My Day</h3>
          <p className="text-xs text-slate-400">Your groups for the month: what you opened, closed, or covered, and what's coming up.</p>
        </div>
        <button type="button" onClick={onOpenAttendance} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded text-xs font-semibold">Open Attendance & Sign-In</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month" className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-semibold">← Previous</button>
        <input
          type="month"
          value={month}
          onChange={e => { if (e.target.value) setMonth(e.target.value); }}
          aria-label="Month"
          className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs"
        />
        <button type="button" onClick={() => setMonth(m => shiftMonth(m, 1))} aria-label="Next month" className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-semibold">Next →</button>
        {!isCurrentMonth && (
          <button type="button" onClick={() => setMonth(monthOfDate(new Date()))} className="text-xs text-blue-300 hover:text-blue-200 underline px-2">This month</button>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">{error}</p>}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 md:p-4 overflow-x-auto">
        <div className="grid grid-cols-7 gap-1 min-w-[560px]">
          {WEEKDAY_HEADINGS.map(w => (
            <div key={w} className="text-[11px] uppercase tracking-wide text-slate-500 px-1 pb-1">{w}</div>
          ))}
          {monthGrid(month).map((day, i) => {
            if (!day) return <div key={`blank-${i}`} className="min-h-24" />;
            const items = byDay.get(day) ?? [];
            const isToday = day === todayKey;
            return (
              <div key={day} className={`min-h-24 rounded-lg border p-1.5 space-y-1 ${isToday ? 'border-blue-500/60 bg-blue-500/5' : 'border-slate-800 bg-slate-950/40'}`}>
                <p className={`text-xs ${isToday ? 'text-blue-300 font-semibold' : 'text-slate-400'}`}>{Number(day.slice(8))}</p>
                {items.slice(0, MAX_CHIPS).map(item => (
                  <p key={item.key} title={`${KIND_LABEL[item.kind]}: ${item.groupname}`} className={`text-[11px] leading-tight border rounded px-1 py-0.5 truncate ${KIND_STYLE[item.kind]}`}>
                    {item.groupname}
                  </p>
                ))}
                {items.length > MAX_CHIPS && <p className="text-[11px] text-slate-500">+{items.length - MAX_CHIPS} more</p>}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-4 text-[11px] text-slate-400 mt-3">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-emerald-500/40 bg-emerald-500/15" /> Closed</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-amber-500/40 bg-amber-500/15" /> Still open</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-dashed border-blue-400/60" /> Scheduled, coming up</span>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <p className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-800">
          Sessions this month {sessions ? `(${listed.length})` : ''}
        </p>
        {!sessions && !error && <p className="p-4 text-sm text-slate-500">Loading…</p>}
        {sessions && listed.length === 0 && <p className="p-4 text-sm text-slate-500">No sessions you opened, closed, or covered this month.</p>}
        <ul className="divide-y divide-slate-800">
          {listed.map(row => (
            <li key={`${row.kind}-${row.day}-${row.groupname}`} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="text-white">{row.groupname}</span>
                <span className="text-xs text-slate-400"> · {longDate(row.day)}{row.clients != null ? ` · ${row.clients} client${row.clients === 1 ? '' : 's'}` : ''}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className={`px-2 py-0.5 rounded border ${KIND_STYLE[row.kind]}`}>{KIND_LABEL[row.kind]}</span>
                {row.tags.map(t => <span key={t} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">{t}</span>)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
