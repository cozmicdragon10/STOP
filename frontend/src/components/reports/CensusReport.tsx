import { useMemo, useState } from 'react';
import { getCensus } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { monthLabel, monthsAgo, rangeText, summarizeCensus } from '../../utils/directorReports';
import type { ReportTable } from '../../utils/directorReports';
import { DateRange, ExportButtons, fieldClass, Section, SimpleTable, StatCards, th } from './ReportControls';
import { useReportData } from '../../hooks/useReportData';
import { useTableSort } from '../../hooks/useTableSort';
import { sortRows } from '../../utils/tableSort';
import SortableTh from '../SortableTh';

// The By Month table's columns; the bar column has no header and does not sort
type MonthKey = 'month' | 'enrolled' | 'intakes' | 'discharged' | 'wentInactive' | 'seen';
const MONTH_COLUMNS: [MonthKey | null, string][] = [
  ['month', 'Month'], ['enrolled', 'Enrolled at Month End'], [null, ''], ['intakes', 'Intakes'], ['discharged', 'Discharged'],
  ['wentInactive', 'Went Inactive'], ['seen', 'Clients Seen'],
];

const loadCensus = (key: string) => {
  const [from, to] = key.split('|');
  return getCensus(from, to);
};
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

// Census (Business Administrators only): how many clients are enrolled each month, and how many came in and left
export default function CensusReport() {
  const [from, setFrom] = useState(() => monthsAgo(11));
  const [to, setTo] = useState(todayLocal);
  const [program, setProgram] = useState('');
  const key = from && to && from <= to ? `${from}|${to}` : null;
  const { data, status, error, loadedKey } = useReportData(key, loadCensus, 'Failed to load the census.');
  const s = useMemo(() => (data ? summarizeCensus(data, program) : null), [data, program]);
  const [shownFrom, shownTo] = (loadedKey ?? `${from}|${to}`).split('|');
  const subtitle = `${rangeText(shownFrom, shownTo)} · ${program || 'All programs'}`;
  // Tallest bar in the month table
  const peak = Math.max(1, ...(s?.months.map(m => m.enrolled) ?? []));
  const monthSort = useTableSort<MonthKey>();

  const tables = (): ReportTable[] => (s ? [
    {
      title: 'By Program',
      head: ['Program', 'Enrolled Now', 'Change', 'Intakes', 'Discharged', 'Seen (Last Month)'],
      rows: s.byProgram.map(p => [p.program, p.enrolled, signed(p.change), p.intakesTotal, p.dischargedTotal, p.seen]),
    },
    {
      title: 'By Month',
      head: ['Month', 'Enrolled at Month End', 'Intakes', 'Discharged', 'Went Inactive', 'Clients Seen'],
      rows: s.months.map(m => [monthLabel(m.month), m.enrolled, m.intakes, m.discharged, m.wentInactive, m.seen]),
      foot: ['Total', '', s.intakesTotal, s.dischargedTotal, s.inactiveTotal, ''],
    },
  ] : []);

  const avgSeen = s && s.months.length ? Math.round(s.months.reduce((t, m) => t + m.seen, 0) / s.months.length) : 0;
  const change = s?.first && s.last ? s.last.enrolled - s.first.enrolled : 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">Census</h3>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            Clients enrolled at the end of each month, new intakes (program start date), and clients who left.
            Clients Seen is everyone who checked in to anything that month.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <label className="text-xs text-slate-400">Program
            <select value={program} onChange={(e) => setProgram(e.target.value)} className={fieldClass}>
              <option value="">All programs</option>
              {(s?.programs ?? []).map(p => <option key={p}>{p}</option>)}
            </select>
          </label>
          <ExportButtons title="Census" subtitle={subtitle} fileName={`Census ${shownFrom} to ${shownTo}`} disabled={status !== 'ready'} tables={tables} />
        </div>
      </div>
      {status === 'error' && <p className="text-sm text-red-400">{error}</p>}
      {status === 'loading' && !s && <p className="text-sm text-slate-400">Loading…</p>}

      {s && (
        <div className={`space-y-5 ${status === 'loading' ? 'opacity-60' : ''}`}>
          <StatCards cards={[
            { label: 'Enrolled Now', value: String(s.last?.enrolled ?? 0), tone: 'text-blue-400', note: s.last ? `end of ${monthLabel(s.last.month)}` : undefined },
            { label: 'Change Over Range', value: signed(change), tone: change >= 0 ? 'text-emerald-400' : 'text-red-400', note: s.first ? `from ${s.first.enrolled} in ${monthLabel(s.first.month)}` : undefined },
            { label: 'New Intakes', value: String(s.intakesTotal), tone: 'text-emerald-400' },
            { label: 'Discharged', value: String(s.dischargedTotal), tone: 'text-amber-400', note: `${s.inactiveTotal} more went inactive` },
            { label: 'Clients Seen / Month', value: String(avgSeen), note: 'average' },
          ]} />

          {!program && (
            <Section title="By Program" note="Enrolled at the end of the last month shown, and the change since the first month.">
              <SimpleTable
                head={['Program', 'Enrolled Now', 'Change', 'Intakes', 'Discharged', 'Seen (Last Month)']}
                rows={s.byProgram.map(p => [p.program, p.enrolled,
                  <span className={p.change > 0 ? 'text-emerald-400' : p.change < 0 ? 'text-red-400' : ''}>{signed(p.change)}</span>,
                  p.intakesTotal, p.dischargedTotal, p.seen])}
                values={s.byProgram.map(p => [undefined, undefined, p.change])}
              />
            </Section>
          )}

          <Section title="By Month">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-800">
                {MONTH_COLUMNS.map(([k, h], i) => (k
                  ? <SortableTh key={k} k={k} table={monthSort} className={`${th} ${i > 0 ? 'text-right' : ''}`}>{h}</SortableTh>
                  : <th key={i} className={th} />
                ))}
              </tr></thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {sortRows(s.months, monthSort.sort, (m, k) => m[k]).map(m => (
                  <tr key={m.month}>
                    <td className="py-2 px-3 whitespace-nowrap">{monthLabel(m.month)}</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold">{m.enrolled}</td>
                    <td className="py-2 px-3 w-1/3">
                      <div className="h-2.5 rounded bg-blue-500/70" style={{ width: `${(m.enrolled / peak) * 100}%` }} aria-hidden />
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-emerald-400">{m.intakes}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-amber-400">{m.discharged}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{m.wentInactive}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{m.seen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <p className="text-xs text-slate-500">
            Clients who left before this app was in use mostly have no discharge record, so their leaving date is their last day attended.
            Inactive clients count as leaving on their last day attended.
          </p>
        </div>
      )}
    </div>
  );
}
