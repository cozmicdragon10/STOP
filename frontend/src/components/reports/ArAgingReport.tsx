import { useMemo, useState } from 'react';
import { getArAging } from '../../api';
import { idText } from '../../utils/clients';
import { formatDate, money, pct, summarizeAging } from '../../utils/directorReports';
import type { AgingRow, ReportTable } from '../../utils/directorReports';
import { ExportButtons, fieldClass, num, Section, SimpleTable, StatCards, td, th } from './ReportControls';
import { useReportData } from '../../hooks/useReportData';

const loadAging = () => getArAging();
const PAGE = 100;

// Accounts receivable aging (Business Administrators only): who owes money today and how old the debt is
export default function ArAgingReport({ onOpenClient }: { onOpenClient: (clientId: number) => void }) {
  const { data, status, error } = useReportData('today', loadAging, 'Failed to load the aging report.');
  const [group, setGroup] = useState('');
  const [program, setProgram] = useState('');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);

  const s = useMemo(() => (data ? summarizeAging(data, { group, program, search }) : null), [data, group, program, search]);
  const programs = useMemo(() => [...new Set((data?.clients ?? []).map(c => c.programtype))].sort(), [data]);
  const keys = data?.buckets.map(b => b.key) ?? [];
  const filterText = [group || 'All statuses', program || 'All programs', search && `matching "${search}"`].filter(Boolean).join(' · ');

  const bucketTable = (title: string, rows: AgingRow[]): ReportTable => ({
    title,
    head: ['', 'Clients', 'Owed', ...(s?.bucketLabels ?? [])],
    rows: rows.map(r => [r.label, r.clients, money(r.balance), ...r.buckets.map(money)]),
    foot: s ? ['All clients', s.total.clients, money(s.total.balance), ...s.total.buckets.map(money)] : undefined,
  });
  const tables = (): ReportTable[] => (s ? [
    bucketTable('By Status', s.byGroup),
    bucketTable('By Program', s.byProgram),
    {
      title: 'Clients',
      head: ['Client', 'ID', 'Program', 'Status', 'Last Attended', 'Last Payment', 'Owed', ...s.bucketLabels],
      rows: s.clients.map(c => [`${c.lastname}, ${c.firstname}`, idText(c), c.programtype, c.programstatus,
        c.lastattended ?? '', c.lastpayment ?? '', money(Number(c.balance)), ...keys.map(k => money(Number(c[k]) || 0))]),
    },
  ] : []);

  const b = s?.total.buckets ?? [];
  const sumOf = (from: number, to: number) => b.slice(from, to).reduce((t, v) => t + v, 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">Accounts Receivable Aging</h3>
          <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
            What clients owe today, by how old the unpaid charges are. Payments are counted against the oldest charges first, so
            a balance is made of the client's most recent charges. Debt carried over from the old system with no charges behind it counts as over a year.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">Status
            <select value={group} onChange={(e) => { setGroup(e.target.value); setShown(PAGE); }} className={fieldClass}>
              <option value="">All statuses</option><option>Active</option><option>Inactive</option><option>Discharged</option>
            </select>
          </label>
          <label className="text-xs text-slate-400">Program
            <select value={program} onChange={(e) => { setProgram(e.target.value); setShown(PAGE); }} className={fieldClass}>
              <option value="">All programs</option>
              {programs.map(p => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Client
            <input value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }} placeholder="Name or ID" className={`${fieldClass} w-40`} />
          </label>
          <ExportButtons title="Accounts Receivable Aging" subtitle={`As of ${formatDate(new Date().toLocaleDateString('en-CA'))} · ${filterText}`}
            fileName={`AR Aging ${new Date().toLocaleDateString('en-CA')}`} disabled={status !== 'ready'} tables={tables} />
        </div>
      </div>
      {status === 'error' && <p className="text-sm text-red-400">{error}</p>}
      {status === 'loading' && !s && <p className="text-sm text-slate-400">Loading…</p>}

      {s && (
        <>
          <StatCards cards={[
            { label: 'Total Owed', value: money(s.total.balance), note: `${s.total.clients} client(s)` },
            { label: '0–30 Days', value: money(sumOf(0, 1)), tone: 'text-emerald-400', note: pct(sumOf(0, 1), s.total.balance) },
            { label: '31–90 Days', value: money(sumOf(1, 3)), tone: 'text-amber-400', note: pct(sumOf(1, 3), s.total.balance) },
            { label: '91–365 Days', value: money(sumOf(3, 5)), tone: 'text-orange-400', note: pct(sumOf(3, 5), s.total.balance) },
            { label: 'Over 1 Year', value: money(sumOf(5, 6)), tone: 'text-red-400', note: `${pct(sumOf(5, 6), s.total.balance)} · hardest to collect` },
          ]} />

          {([
            { title: 'By Status', rows: s.byGroup, note: 'Active clients are still coming in; discharged clients are the hardest to collect from.' },
            { title: 'By Program', rows: s.byProgram },
          ] as { title: string; rows: AgingRow[]; note?: string }[]).map(({ title, rows, note }) => (
            <Section key={title} title={title} note={note}>
              <SimpleTable
                head={['', 'Clients', 'Owed', ...s.bucketLabels]}
                rows={rows.map(r => [r.label, r.clients, money(r.balance), ...r.buckets.map(money)])}
                foot={['All', s.total.clients, money(s.total.balance), ...s.total.buckets.map(money)]}
                empty="No one owes money."
              />
            </Section>
          ))}

          <Section title={`Clients (${s.clients.length})`} note="Largest balances first. Click a name to open the account.">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-800">
                <th className={th}>Client</th><th className={th}>Program</th><th className={th}>Status</th>
                <th className={th}>Last Attended</th><th className={th}>Last Payment</th><th className={`${th} ${num}`}>Owed</th>
                {s.bucketLabels.map(l => <th key={l} className={`${th} ${num}`}>{l}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {s.clients.length === 0 && <tr><td colSpan={6 + keys.length} className={`${td} text-slate-500`}>No clients match.</td></tr>}
                {s.clients.slice(0, shown).map(c => (
                  <tr key={c.clientid}>
                    <td className={td}>
                      <button type="button" onClick={() => onOpenClient(c.clientid)} className="text-blue-400 hover:underline text-left">{c.lastname}, {c.firstname}</button>
                      {idText(c) && <span className="block text-xs text-slate-500">{idText(c)}</span>}
                    </td>
                    <td className={td}>{c.programtype}</td>
                    <td className={td}>{c.programstatus}</td>
                    <td className={`${td} whitespace-nowrap`}>{c.lastattended ? formatDate(c.lastattended) : '—'}</td>
                    <td className={`${td} whitespace-nowrap`}>{c.lastpayment ? formatDate(c.lastpayment) : 'Never'}</td>
                    <td className={`${td} ${num} font-semibold`}>{money(Number(c.balance))}</td>
                    {keys.map(k => <td key={k} className={`${td} ${num} ${Number(c[k]) ? '' : 'text-slate-600'}`}>{money(Number(c[k]) || 0)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {s.clients.length > shown && (
              <div className="p-3 text-center">
                <button type="button" onClick={() => setShown(n => n + PAGE)} className="text-xs text-blue-400 hover:underline">
                  Show {Math.min(PAGE, s.clients.length - shown)} more of {s.clients.length - shown} remaining
                </button>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
