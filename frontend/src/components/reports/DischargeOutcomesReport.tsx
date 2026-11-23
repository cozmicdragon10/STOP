import { useMemo, useState } from 'react';
import { getDischargeOutcomes } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { monthLabel, NEUTRAL_OUTCOMES, pct, rangeText, summarizeOutcomes } from '../../utils/directorReports';
import type { ReportTable } from '../../utils/directorReports';
import { DateRange, ExportButtons, fieldClass, Section, SimpleTable, StatCards } from './ReportControls';
import { useReportData } from '../../hooks/useReportData';

const loadOutcomes = (key: string) => {
  const [from, to] = key.split('|');
  return getDischargeOutcomes(from, to);
};
const days = (n: number | null) => (n === null ? '—' : n >= 60 ? `${Math.round(n / 30.4)} mo` : `${n} days`);
const TYPE_TONE: Record<string, string> = {
  Completed: 'text-emerald-400', 'Program Failed': 'text-red-400', Revoked: 'text-red-400', Terminated: 'text-red-400',
  'Discharged Supervision': 'text-sky-400',
};

// Discharge outcomes (Business Administrators only): how clients left the program, why, and after how long
export default function DischargeOutcomesReport() {
  const [from, setFrom] = useState(() => `${todayLocal().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(todayLocal);
  const [program, setProgram] = useState('');
  const [includeEstimated, setIncludeEstimated] = useState(true);
  const key = from && to && from <= to ? `${from}|${to}` : null;
  const { data, status, error, loadedKey } = useReportData(key, loadOutcomes, 'Failed to load discharge outcomes.');
  const s = useMemo(() => (data ? summarizeOutcomes(data, program, includeEstimated) : null), [data, program, includeEstimated]);
  const programs = useMemo(() => [...new Set((data ?? []).map(r => r.programtype))].sort(), [data]);
  const [shownFrom, shownTo] = (loadedKey ?? `${from}|${to}`).split('|');
  const subtitle = `${rangeText(shownFrom, shownTo)} · ${program || 'All programs'}${includeEstimated ? '' : ' · discharge records only'}`;

  const failed = s ? s.byType.filter(t => ['Program Failed', 'Revoked', 'Terminated'].includes(t.label)).reduce((n, t) => n + t.count, 0) : 0;
  const completedDays = s?.byType.find(t => t.label === 'Completed')?.avgDays ?? null;

  const tables = (): ReportTable[] => (s ? [
    { title: 'By Outcome', head: ['Outcome', 'Clients', 'Share', 'Avg Time in Program'], rows: s.byType.map(t => [t.label, t.count, pct(t.count, s.total), days(t.avgDays)]), foot: ['Total', s.total, '', ''] },
    { title: 'Reasons', head: ['Outcome', 'Reason', 'Clients', 'Avg Time in Program'], rows: s.reasons.map(r => [r.type, r.label, r.count, days(r.avgDays)]) },
    {
      title: 'By Program', head: ['Program', 'Discharges', 'Completion Rate', ...s.types],
      rows: s.byProgram.map(p => [p.program, p.total, pct(p.completed, p.counted), ...s.types.map(t => p.byType[t] ?? 0)]),
    },
    { title: 'By Month', head: ['Month', 'Discharges', ...s.types], rows: s.months.map(m => [monthLabel(m.month), m.total, ...s.types.map(t => m.byType[t] ?? 0)]) },
  ] : []);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">Discharge Outcomes</h3>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            How clients left the program in this date range, the reasons recorded, and how long they were in the program.
            The completion rate leaves out transfers and deaths.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <label className="text-xs text-slate-400">Program
            <select value={program} onChange={(e) => setProgram(e.target.value)} className={fieldClass}>
              <option value="">All programs</option>
              {programs.map(p => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 h-9 text-xs text-slate-300 cursor-pointer" title="Clients discharged without a discharge record (mostly in the old system), dated by their last day attended">
            <input type="checkbox" checked={includeEstimated} onChange={(e) => setIncludeEstimated(e.target.checked)} className="rounded accent-blue-500" />
            Include estimated
          </label>
          <ExportButtons title="Discharge Outcomes" subtitle={subtitle} fileName={`Discharge Outcomes ${shownFrom} to ${shownTo}`} disabled={status !== 'ready'} tables={tables} />
        </div>
      </div>
      {status === 'error' && <p className="text-sm text-red-400">{error}</p>}
      {status === 'loading' && !s && <p className="text-sm text-slate-400">Loading…</p>}

      {s && (
        <div className={`space-y-5 ${status === 'loading' ? 'opacity-60' : ''}`}>
          <StatCards cards={[
            { label: 'Discharges', value: String(s.total), tone: 'text-blue-400', note: s.estimated ? `${s.estimated} estimated` : undefined },
            { label: 'Completion Rate', value: pct(s.completed, s.counted), tone: 'text-emerald-400', note: `${s.completed} of ${s.counted}` },
            { label: 'Completed', value: String(s.completed), tone: 'text-emerald-400' },
            { label: 'Failed, Revoked, or Terminated', value: String(failed), tone: 'text-red-400', note: pct(failed, s.counted) },
            { label: 'Avg Time to Complete', value: days(completedDays) },
          ]} />

          <div className="grid lg:grid-cols-2 gap-5">
            <Section title="By Outcome" note={`Transfers and deaths (${NEUTRAL_OUTCOMES.join(', ').toLowerCase()}) are shown but not counted against the completion rate.`}>
              <SimpleTable
                head={['Outcome', 'Clients', 'Share', 'Avg Time in Program']}
                rows={s.byType.map(t => [<span className={TYPE_TONE[t.label] ?? ''}>{t.label}</span>, t.count, pct(t.count, s.total), days(t.avgDays)])}
                values={s.byType.map(t => [t.label, undefined, undefined, t.avgDays])}
                foot={['Total', s.total, '', '']}
                empty="No discharges in this range."
              />
            </Section>
            <Section title="Reasons" note="Recorded on Program Failed, Revoked, and Terminated discharges. A discharge with two reasons counts under both.">
              <SimpleTable
                head={['Outcome', 'Reason', 'Clients', 'Avg Time']}
                rows={s.reasons.map(r => [r.type, r.label, r.count, days(r.avgDays)])}
                values={s.reasons.map(r => [undefined, undefined, undefined, r.avgDays])}
                empty="No failed, revoked, or terminated discharges."
              />
            </Section>
          </div>

          {!program && (
            <Section title="By Program">
              <SimpleTable
                head={['Program', 'Discharges', 'Completion Rate', ...s.types]}
                rows={s.byProgram.map(p => [p.program, p.total, pct(p.completed, p.counted), ...s.types.map(t => p.byType[t] ?? 0)])}
              />
            </Section>
          )}

          <Section title="By Month">
            <SimpleTable
              head={['Month', 'Discharges', ...s.types]}
              rows={s.months.map(m => [monthLabel(m.month), m.total, ...s.types.map(t => m.byType[t] ?? 0)])}
              values={s.months.map(m => [m.month])}
              empty="No discharges in this range."
            />
          </Section>
          {s.estimated > 0 && (
            <p className="text-xs text-slate-500">
              {s.estimated} discharge(s) have no discharge record (mostly clients discharged in the old system). They are counted by their current
              status on their last day attended, with no reason. Uncheck Include estimated to see only discharges recorded in this app.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
