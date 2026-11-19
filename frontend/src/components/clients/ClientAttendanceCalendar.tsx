import { useState } from 'react';
import { CalendarX, ChevronLeft, ChevronRight, UserX } from 'lucide-react';
import { localYmd } from '../../utils/dates';
import { signedMoney } from '../../utils/ledger';

/* eslint-disable @typescript-eslint/no-explicit-any -- attendance rows are untyped throughout App */
interface Props {
  // Attendance rows, cancelled-group rows (cancellation: true) and missed-group rows (missed: true), already filtered
  rows: any[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Colors by session kind, matching the legend
const chipClass = (row: { cancellation?: boolean; missed?: boolean; type?: string }) => {
  if (row.missed) return 'bg-red-500/15 text-red-300 border-red-500/30';
  if (row.cancellation) return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (row.type === 'Assessment') return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
  if (row.type === 'Individual') return 'bg-teal-500/15 text-teal-300 border-teal-500/30';
  return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
};

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shiftMonth = (key: string, by: number) => {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + by, 1));
};

// The client's attendance as a month calendar: each day shows the sessions attended and any group meeting that was
// cancelled or missed. Opens on the month of the newest session (or this month when there are none).
export default function ClientAttendanceCalendar({ rows }: Props) {
  const today = localYmd(new Date());
  const [month, setMonth] = useState(() => {
    const newest = rows.map(r => localYmd(r.date)).filter(Boolean).sort().pop();
    return newest ? newest.slice(0, 7) : today.slice(0, 7);
  });

  // Rows by day (YYYY-MM-DD)
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const day = localYmd(r.date);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(r);
  }

  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  // Blank cells before the 1st, then each day, padded out to whole weeks
  const cells: (string | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7) cells.push(null);

  const inMonth = rows.filter(r => localYmd(r.date).startsWith(month));
  const sessions = inMonth.filter(r => !r.cancellation && !r.missed).length;
  const cancelled = inMonth.filter(r => r.cancellation).length;
  const missed = inMonth.filter(r => r.missed).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setMonth(k => shiftMonth(k, -1))} aria-label="Previous month" className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"><ChevronLeft size={16} /></button>
        <p className="font-bold text-white min-w-[9rem] text-center">{first.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</p>
        <button type="button" onClick={() => setMonth(k => shiftMonth(k, 1))} aria-label="Next month" className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"><ChevronRight size={16} /></button>
        {month !== today.slice(0, 7) && (
          <button type="button" onClick={() => setMonth(today.slice(0, 7))} className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300">This Month</button>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {sessions} session{sessions === 1 ? '' : 's'}{cancelled > 0 && ` · ${cancelled} group${cancelled === 1 ? '' : 's'} cancelled`}{missed > 0 && ` · ${missed} missed`}
        </span>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[0.6875rem]">
        {WEEKDAYS.map(d => <p key={d} className="text-center font-semibold uppercase tracking-wide text-slate-500 pb-1">{d}</p>)}
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} className="min-h-[4.5rem] rounded-lg bg-slate-950/40" />;
          const items = byDay.get(day) || [];
          return (
            <div key={day} className={`min-h-[4.5rem] rounded-lg border p-1 space-y-1 ${day === today ? 'border-blue-500/60 bg-slate-900' : 'border-slate-800 bg-slate-950'}`}>
              <p className={`text-right font-semibold ${day === today ? 'text-blue-300' : 'text-slate-500'}`}>{Number(day.slice(8))}</p>
              {items.map(r => {
                const name = r.cancellation || r.missed ? r.groupname : (r.groupname || 'Group Session');
                const detail = r.missed
                  ? `${r.missedLabel}: ${name}${r.calledin ? ` (called in${r.callinreason ? `: ${r.callinreason}` : ''})` : ''}`
                  : r.cancellation
                  ? `${name}: group cancelled${r.reason ? ` (${r.reason})` : ''}`
                  : `${name}${r.groupschedule ? ` · ${r.groupschedule}` : ''}\nFee ${signedMoney(Number(r.groupfee || 0))} · Paid ${signedMoney(Number(r.accountpaid || 0))}${r.comments ? `\n${r.comments}` : ''}`;
                return (
                  <p key={r.missed ? `missed-${r.groupid}-${r.date}` : r.cancellation ? `cancel-${r.changeid}` : r.attendanceid} title={detail} className={`border rounded px-1 py-0.5 truncate font-semibold flex items-center gap-1 ${chipClass(r)}`}>
                    {r.cancellation && <CalendarX size={11} className="shrink-0" />}
                    {r.missed && <UserX size={11} className="shrink-0" />}
                    <span className="truncate">{r.missed ? `Missed: ${name}` : r.cancellation ? `Cancelled: ${name}` : name}</span>
                  </p>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 text-[0.6875rem] text-slate-400">
        {[
          { label: 'Group', row: { type: 'Group' } },
          { label: 'Individual', row: { type: 'Individual' } },
          { label: 'Assessment', row: { type: 'Assessment' } },
          { label: 'Group Cancelled', row: { cancellation: true } },
          { label: 'Missed', row: { missed: true } },
        ].map(l => (
          <span key={l.label} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded border ${chipClass(l.row)}`} />{l.label}</span>
        ))}
      </div>
    </div>
  );
}
