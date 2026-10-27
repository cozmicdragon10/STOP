import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';
import { getUserActivity } from '../../api';
import type { UserActivityRow } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { escapeHtml } from '../../utils/receipt';

interface Props {
  userEmail: string;
  onOpenClient: (clientId: number) => void;
}

const NOT_RECORDED = 'Not recorded';

const money = (n: number) => `$${n.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100) / 100;
// Refunds and disputes take money back; a won dispute puts it back
const signedAmount = (r: UserActivityRow) => (r.detail === 'Refund' || r.detail === 'Dispute' ? -1 : 1) * Number(r.amount || 0);
const clientOf = (r: UserActivityRow) => (r.lastname || r.firstname ? `${r.lastname}, ${r.firstname}` : '—');
const formatWhen = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
const formatTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
// The local day (YYYY-MM-DD) an entry was made on, for grouping
const dayOf = (value: string) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabel = (ymd: string) => {
  const long = new Date(`${ymd}T00:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return ymd === todayLocal() ? `Today · ${long}` : long;
};

const firstOfMonth = () => `${todayLocal().slice(0, 7)}-01`;

// Payments and client notes entered in the system, with who entered them and when (Business Administrators and Office Admins)
export default function UserActivityReport({ userEmail, onOpenClient }: Props) {
  const employeeLabel = useEmployeeLabel();
  // "Display Name (Role)"; payments from before this was recorded have no one
  const enteredByOf = (r: UserActivityRow) => (r.enteredby ? employeeLabel(r.enteredby) : NOT_RECORDED);
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayLocal);
  const [kind, setKind] = useState<'' | 'Payment' | 'Note'>('');
  const [enteredBy, setEnteredBy] = useState('');
  const [detail, setDetail] = useState('');
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<UserActivityRow[]>([]);
  // The range the rows (or the error) were loaded for; an invalid range keeps showing the last one
  const [loaded, setLoaded] = useState<{ key: string; error: string } | null>(null);

  const rangeKey = from && to && from <= to ? `${from}|${to}|${userEmail}` : null;
  useEffect(() => {
    if (!rangeKey) return;
    let cancelled = false;
    getUserActivity(from, to, userEmail)
      .then(data => { if (!cancelled) { setRows(data); setLoaded({ key: rangeKey, error: '' }); } })
      .catch(err => { if (!cancelled) setLoaded({ key: rangeKey, error: err.message || 'Failed to load the user activity report.' }); });
    return () => { cancelled = true; };
  }, [rangeKey, from, to, userEmail]);
  const status = !loaded || (rangeKey && loaded.key !== rangeKey) ? 'loading' : loaded.error ? 'error' : 'ready';

  // Filter choices come from what was loaded; the type list follows the Show filter
  const kindRows = rows.filter(r => !kind || r.kind === kind);
  const enteredByNames = Array.from(new Set(rows.map(enteredByOf))).sort((a, b) => a.localeCompare(b));
  const details = Array.from(new Set(kindRows.map(r => r.detail).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const needle = search.trim().toLowerCase();

  const filtered = kindRows.filter(r =>
    (!enteredBy || enteredByOf(r) === enteredBy)
    && (!detail || r.detail === detail)
    && (!method || r.paymentmethod === method)
    && (!needle || [clientOf(r), r.docnumber, r.comments].some(v => String(v || '').toLowerCase().includes(needle))));

  const payments = filtered.filter(r => r.kind === 'Payment');
  const notes = filtered.filter(r => r.kind === 'Note');
  const netPayments = cents(payments.reduce((t, r) => t + signedAmount(r), 0));
  const filtersOn = Boolean(kind || enteredBy || detail || method || needle);

  // Entries come newest first, so each day's entries are already together
  const days: { day: string; rows: UserActivityRow[] }[] = [];
  for (const r of filtered) {
    const day = dayOf(r.enteredon);
    if (days[days.length - 1]?.day !== day) days.push({ day, rows: [] });
    days[days.length - 1].rows.push(r);
  }
  const daySummary = (list: UserActivityRow[]) => {
    const paid = list.filter(r => r.kind === 'Payment');
    const noteCount = list.length - paid.length;
    return [
      paid.length ? `${paid.length} payment${paid.length === 1 ? '' : 's'} (net ${money(cents(paid.reduce((t, r) => t + signedAmount(r), 0)))})` : '',
      noteCount ? `${noteCount} note${noteCount === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ');
  };
  const today = todayLocal();
  const showingToday = from === today && to === today;

  const openClient = (r: UserActivityRow) => {
    if (r.client) onOpenClient(r.client);
  };

  const printReport = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const filterText = [
      kind && `Show: ${kind}s`, enteredBy && `Entered by: ${enteredBy}`, detail && `Type: ${detail}`, method && `Method: ${method}`, needle && `Search: "${search.trim()}"`,
    ].filter(Boolean).join(' · ');
    win.document.write(`<!doctype html><html><head><title>User Activity Report</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-size:18px;margin:0}.sub{color:#555;margin:2px 0 12px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eee}.r{text-align:right;white-space:nowrap}.day{background:#f6f6f6;font-weight:bold;padding-top:8px}.day span{font-weight:normal;color:#555}
    </style></head><body>
      <h1>User Activity Report</h1>
      <p class="sub">${escapeHtml(from)} to ${escapeHtml(to)}${filterText ? ` · ${escapeHtml(filterText)}` : ''} · ${payments.length} payments (net ${money(netPayments)}), ${notes.length} notes · Printed ${new Date().toLocaleString()}</p>
      <table><thead><tr><th>Time</th><th>Entered By</th><th>Kind</th><th>Type</th><th>Client</th><th class="r">Amount</th><th>Method</th><th>Comments</th></tr></thead><tbody>
        ${days.map(({ day, rows: list }) => `<tr><td colspan="8" class="day">${escapeHtml(dayLabel(day))} <span>${escapeHtml(daySummary(list))}</span></td></tr>${list.map(r => `<tr><td>${escapeHtml(formatTime(r.enteredon))}</td><td>${escapeHtml(enteredByOf(r))}</td><td>${r.kind}</td><td>${escapeHtml(r.detail || '')}</td>
          <td>${escapeHtml(clientOf(r))}</td><td class="r">${r.kind === 'Payment' ? escapeHtml(money(signedAmount(r))) : ''}</td><td>${escapeHtml(r.paymentmethod || '')}</td><td>${escapeHtml(r.comments || '')}</td></tr>`).join('')}`).join('')}
      </tbody></table>
    </body></html>`);
    win.document.close();
    win.print();
  };

  const select = 'block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs';
  const card = (label: string, value: string, tone = 'text-white') => (
    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-xl font-bold mt-1 ${tone}`}>{value}</p>
    </div>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">User Activity</h3>
          <p className="text-xs text-slate-400 mt-0.5">Payments and client notes entered in the system, with who entered them and when. Click a row to open the client's account.</p>
        </div>
        <button type="button" onClick={printReport} disabled={status !== 'ready'} className="flex items-center gap-1.5 h-9 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-slate-200 px-3 rounded text-xs font-semibold">
          <Printer size={14} /> Print
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400">From
          <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className={select} />
        </label>
        <label className="text-xs text-slate-400">To
          <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={select} />
        </label>
        <button
          type="button"
          onClick={() => { setFrom(today); setTo(today); }}
          aria-pressed={showingToday}
          className={`h-9 px-3 rounded text-xs font-semibold border transition ${showingToday ? 'bg-blue-600 border-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'}`}
        >
          Today
        </button>
        <div className="text-xs text-slate-400">Show
          <div className="mt-1 flex h-9 bg-slate-950 p-1 rounded-lg border border-slate-700">
            {([['', 'All'], ['Payment', 'Payments'], ['Note', 'Notes']] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => { setKind(value); setDetail(''); if (value === 'Note') setMethod(''); }}
                aria-pressed={kind === value}
                className={`px-3 rounded text-xs font-semibold transition ${kind === value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="text-xs text-slate-400">Entered By
          <select value={enteredBy} onChange={e => setEnteredBy(e.target.value)} className={select}>
            <option value="">Everyone</option>
            {enteredByNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">{kind === 'Note' ? 'Category' : kind === 'Payment' ? 'Payment Type' : 'Type / Category'}
          <select value={detail} onChange={e => setDetail(e.target.value)} className={select}>
            <option value="">All</option>
            {details.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        {kind !== 'Note' && (
          <label className="text-xs text-slate-400">Method
            <select value={method} onChange={e => setMethod(e.target.value)} className={select}>
              <option value="">All</option>
              <option value="Cash">Cash</option>
              <option value="Credit Card">Credit Card</option>
            </select>
          </label>
        )}
        <label className="text-xs text-slate-400 flex-1 min-w-[12rem]">Search
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Client, DOC #, or comments" className={`${select} w-full`} />
        </label>
        {filtersOn && (
          <button type="button" onClick={() => { setKind(''); setEnteredBy(''); setDetail(''); setMethod(''); setSearch(''); }} className="h-9 text-xs text-slate-400 hover:text-white px-2">Clear filters</button>
        )}
      </div>

      {!rangeKey && <p className="text-xs text-amber-400">Pick a start date on or before the end date.</p>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {card('Payments', String(payments.length), 'text-blue-400')}
        {card('Net Payments', money(netPayments), netPayments < 0 ? 'text-red-400' : 'text-emerald-400')}
        {card('Notes', String(notes.length))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <th className="p-3 whitespace-nowrap">Time</th>
              <th className="p-3">Entered By</th>
              <th className="p-3">Type</th>
              <th className="p-3">Client</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3">Comments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-sm">
            {status === 'ready' && days.map(({ day, rows: list }) => [
              <tr key={day} className="bg-slate-950">
                <td colSpan={6} className="px-3 pt-4 pb-2">
                  <span className="text-sm font-semibold text-white">{dayLabel(day)}</span>
                  <span className="ml-3 text-xs text-slate-400">{daySummary(list)}</span>
                </td>
              </tr>,
              ...list.map(r => (
              <tr key={`${r.kind}-${r.id}`} onClick={() => openClient(r)} title="Open client account" className="cursor-pointer align-top transition hover:bg-slate-800/50">
                <td className="p-3 text-slate-300 whitespace-nowrap">{formatTime(r.enteredon)}</td>
                <td className={`p-3 whitespace-nowrap ${enteredByOf(r) === NOT_RECORDED ? 'text-slate-500 italic' : 'text-white'}`}>{enteredByOf(r)}</td>
                <td className="p-3 whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded text-xs ${r.kind === 'Payment' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'}`}>{r.kind === 'Payment' ? r.detail : `${r.detail} Note`}</span>
                </td>
                <td className="p-3 whitespace-nowrap">
                  <span className="text-white font-medium">{clientOf(r)}</span>
                  {r.docnumber && <span className="block text-[11px] text-slate-500 font-mono">{r.docnumber}</span>}
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  {r.kind === 'Payment' && (
                    <>
                      <span className={signedAmount(r) < 0 ? 'text-red-400' : 'text-emerald-400'}>{money(signedAmount(r))}</span>
                      <span className="block text-[11px] text-slate-500">{[r.paymentmethod, r.feetype].filter(Boolean).join(' · ')}</span>
                    </>
                  )}
                </td>
                <td className="p-3 text-slate-300 min-w-[16rem] whitespace-pre-wrap break-words">
                  {r.comments || <span className="text-slate-500">—</span>}
                  {r.editedon && <span className="block text-[11px] text-slate-500">Edited {formatWhen(r.editedon)}{r.editedby ? ` by ${employeeLabel(r.editedby)}` : ''}</span>}
                </td>
              </tr>
              )),
            ])}
            {(status !== 'ready' || filtered.length === 0) && (
              <tr><td colSpan={6} className="p-6 text-center text-slate-500 text-sm">
                {status === 'loading' ? 'Loading…' : status === 'error' ? <span className="text-red-400">{loaded?.error}</span> : 'Nothing entered for these filters.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">Payments entered before this report was added show "{NOT_RECORDED}" for who entered them unless they were taken at a check-in.</p>
    </div>
  );
}
