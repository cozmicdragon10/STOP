import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Printer } from 'lucide-react';
import { getGroupReport } from '../../api';
import type { GroupReportRow } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { escapeHtml } from '../../utils/receipt';

interface GroupTotals {
  key: string;
  name: string;
  counselor: string | null;
  rows: GroupReportRow[];
  sessions: number;
  clients: number;
  charged: number;
  collected: number;
  cash: number;
  card: number;
  // Paid at check-in before the payment method was saved on attendance, and not matchable to the ledger
  unrecorded: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const firstOfMonth = () => `${todayLocal().slice(0, 8)}01`;
// A group can meet more than once a day; each session is its own entry
const sessionKey = (r: GroupReportRow) => `${r.date}#${r.sessionnumber ?? 1}`;

const totalsFor = (key: string, rows: GroupReportRow[]): GroupTotals => {
  const totals: GroupTotals = {
    key, name: rows[0].groupname, counselor: rows[0].counselor, rows,
    sessions: new Set(rows.map(sessionKey)).size,
    clients: new Set(rows.map(r => r.clientid)).size,
    charged: 0, collected: 0, cash: 0, card: 0, unrecorded: 0,
  };
  for (const r of rows) {
    const paid = Number(r.accountpaid) || 0;
    totals.charged += Number(r.groupfee) || 0;
    totals.collected += paid;
    if (r.paymentmethod === 'Cash') totals.cash += paid;
    else if (r.paymentmethod === 'Credit Card') totals.card += paid;
    else totals.unrecorded += paid;
  }
  return totals;
};

export default function GroupIncomeReport() {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayLocal);
  // One date instead of a range; from and to are kept equal while it's on
  const [singleDay, setSingleDay] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [rows, setRows] = useState<GroupReportRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [printError, setPrintError] = useState('');

  useEffect(() => {
    if (!from || !to || from > to) return;
    let cancelled = false;
    setStatus('loading');
    getGroupReport(from, to)
      .then(data => { if (!cancelled) { setRows(data); setStatus('ready'); } })
      .catch(err => { if (!cancelled) { setError(err.message || 'Failed to load the group report.'); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [from, to]);

  const groups = useMemo(() => {
    const byKey = new Map<string, GroupReportRow[]>();
    for (const r of rows) {
      const key = String(r.groupid ?? 'none');
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(r);
    }
    return Array.from(byKey.entries()).map(([key, list]) => totalsFor(key, list)).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const shown = groupFilter ? groups.filter(g => g.key === groupFilter) : groups;
  const sum = (field: 'charged' | 'collected' | 'cash' | 'card' | 'unrecorded') => shown.reduce((t, g) => t + g[field], 0);
  const attendanceCount = shown.reduce((t, g) => t + g.rows.length, 0);
  const anyUnrecorded = shown.some(g => g.unrecorded > 0);

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Attendees of one group, split by session (newest first; rows arrive sorted)
  const sessionsOf = (g: GroupTotals) => {
    const bySession = new Map<string, GroupReportRow[]>();
    for (const r of g.rows) {
      const key = sessionKey(r);
      if (!bySession.has(key)) bySession.set(key, []);
      bySession.get(key)!.push(r);
    }
    return Array.from(bySession.entries());
  };
  // Days with more than one session of the group get the session number in their heading
  const sessionLabel = (g: GroupTotals, attendees: GroupReportRow[]) => {
    const { date, sessionnumber } = attendees[0];
    const multiple = g.rows.some(r => r.date === date && (r.sessionnumber ?? 1) !== (sessionnumber ?? 1));
    return `${formatDate(date)}${multiple ? ` · Session ${sessionnumber ?? 1}` : ''}`;
  };

  const formatDate = (ymd: string) => {
    const [y, m, d] = ymd.split('-');
    return `${Number(m)}/${Number(d)}/${y}`;
  };

  // Opens the report as currently filtered in a plain black-on-white window and prints it. Pop-ups must be allowed.
  // Simple lists each group's sessions by date with their totals; detailed also lists the clients who attended each one.
  const printReport = (detailed: boolean) => {
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) {
      setPrintError('Allow pop-ups for this site to print the report.');
      return;
    }
    setPrintError('');
    const range = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
    const groupName = groupFilter ? shown[0]?.name ?? 'Selected group' : 'All Groups';
    const cols = anyUnrecorded ? 10 : 9;
    const groupRows = shown.map(g => `
      <tr class="group">
        <td>${escapeHtml(g.name)}</td><td>${escapeHtml(g.counselor || '—')}</td>
        <td class="r">${g.sessions}</td><td class="r">${g.rows.length}</td><td class="r">${g.clients}</td>
        <td class="r">${money(g.charged)}</td><td class="r">${money(g.collected)}</td>
        <td class="r">${money(g.cash)}</td><td class="r">${money(g.card)}</td>
        ${anyUnrecorded ? `<td class="r">${money(g.unrecorded)}</td>` : ''}
      </tr>
      ${!detailed ? sessionsOf(g).map(([key, attendees]) => {
        const s = totalsFor(key, attendees);
        return `<tr class="sess">
          <td class="indent">${escapeHtml(sessionLabel(g, attendees))}</td><td></td><td></td>
          <td class="r">${attendees.length}</td><td class="r">${s.clients}</td>
          <td class="r">${money(s.charged)}</td><td class="r">${money(s.collected)}</td>
          <td class="r">${money(s.cash)}</td><td class="r">${money(s.card)}</td>
          ${anyUnrecorded ? `<td class="r">${money(s.unrecorded)}</td>` : ''}
        </tr>`;
      }).join('') : ''}
      ${detailed ? `<tr><td colspan="${cols}" class="detail">${sessionsOf(g).map(([key, attendees]) => {
        const s = totalsFor(key, attendees);
        return `<p class="session">${escapeHtml(sessionLabel(g, attendees))} · ${attendees.length} attended</p>
          <table class="attendees"><thead><tr><th>Client</th><th>DOC #</th><th>Type</th><th class="r">Fee</th><th class="r">Paid</th><th>Method</th></tr></thead><tbody>
          ${attendees.map(r => {
            const paid = Number(r.accountpaid) || 0;
            return `<tr><td>${escapeHtml(`${r.lastname}, ${r.firstname}`)}</td><td>${escapeHtml(r.docnumber || '—')}</td>
              <td>${escapeHtml(r.type)}${r.voucherused ? ' · Voucher' : ''}</td><td class="r">${money(Number(r.groupfee) || 0)}</td>
              <td class="r">${money(paid)}</td><td>${paid > 0 ? escapeHtml(r.paymentmethod || 'Not recorded') : '—'}</td></tr>`;
          }).join('')}
          </tbody><tfoot><tr><td colspan="3">Session Total</td><td class="r">${money(s.charged)}</td><td class="r">${money(s.collected)}</td>
          <td>Cash ${money(s.cash)} · CC ${money(s.card)}${s.unrecorded > 0 ? ` · Unrecorded ${money(s.unrecorded)}` : ''}</td></tr></tfoot></table>`;
      }).join('')}</td></tr>` : ''}`).join('');

    win.document.write(`<!doctype html><html><head><title>Group Income Report ${escapeHtml(range)}</title>
      <style>
        body{font-family:Arial,sans-serif;color:#000;padding:24px;font-size:12px}
        h1{font-size:18px;margin:0}.muted{color:#555;margin:2px 0}
        .summary{display:flex;gap:8px;margin:14px 0}.summary div{flex:1;border:1px solid #bbb;border-radius:4px;padding:8px;text-align:center}
        .summary b{display:block;font-size:15px;margin-top:2px}
        table{width:100%;border-collapse:collapse}th,td{padding:4px 6px;text-align:left;vertical-align:top}
        .main>thead th{border-bottom:2px solid #000;font-size:11px;text-transform:uppercase}
        tr.group td{border-top:1px solid #999;font-weight:bold}.r{text-align:right}
        tr.sess td{color:#333;border-top:1px dotted #ddd}td.indent{padding-left:24px}
        td.detail{padding:4px 6px 10px 24px}.session{font-weight:bold;margin:8px 0 2px}
        .attendees th{border-bottom:1px solid #999;font-size:10px;text-transform:uppercase;color:#333}
        .attendees td{border-bottom:1px solid #e3e3e3}.attendees tfoot td{border-top:1px solid #999;border-bottom:0;font-weight:bold}
        .note{color:#555;font-size:11px;margin:6px 0}
        tr{page-break-inside:avoid}
      </style></head><body>
      <h1>Group Income Report${detailed ? ' (Detailed)' : ''}</h1>
      <p class="muted">${escapeHtml(range)} · ${escapeHtml(groupName)}</p>
      <p class="muted">Printed ${escapeHtml(new Date().toLocaleString())}</p>
      <div class="summary">
        <div>Fees Charged<b>${money(sum('charged'))}</b></div><div>Total Collected<b>${money(sum('collected'))}</b></div>
        <div>Cash<b>${money(sum('cash'))}</b></div><div>Credit Card<b>${money(sum('card'))}</b></div>
        <div>Attendance<b>${attendanceCount}</b></div>
      </div>
      ${anyUnrecorded ? `<p class="note">${money(sum('unrecorded'))} was collected at check-ins saved before the payment method was recorded; it is in Total Collected but not under Cash or Credit Card.</p>` : ''}
      <table class="main"><thead><tr>
        <th>Group</th><th>Counselor</th><th class="r">Sessions</th><th class="r">Attendance</th><th class="r">Clients</th>
        <th class="r">Fees Charged</th><th class="r">Collected</th><th class="r">Cash</th><th class="r">Credit Card</th>
        ${anyUnrecorded ? '<th class="r">Unrecorded</th>' : ''}
      </tr></thead><tbody>
      ${groupRows || `<tr><td colspan="${cols}">No attendance in this date range.</td></tr>`}
      </tbody></table>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">Group Income Report</h3>
          <p className="text-xs text-slate-400 mt-0.5">Fees, payments, and attendance by group. Click a group to see who attended each session.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {singleDay ? (
            <label className="text-xs text-slate-400">Date
              <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setTo(e.target.value); }} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs" />
            </label>
          ) : (
            <>
              <label className="text-xs text-slate-400">From
                <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs" />
              </label>
              <label className="text-xs text-slate-400">To
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs" />
              </label>
            </>
          )}
          <label className="flex items-center gap-2 h-9 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={singleDay}
              onChange={(e) => {
                setSingleDay(e.target.checked);
                // Turning it on keeps the To date (usually today) as the day; turning it off leaves that one-day range in place
                if (e.target.checked) setFrom(to);
              }}
              className="rounded accent-blue-500"
            />
            Single Day
          </label>
          <label className="text-xs text-slate-400">Group
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs">
              <option value="">All Groups</option>
              {groups.map(g => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2 h-9">
            <button
              type="button"
              onClick={() => printReport(false)}
              disabled={status !== 'ready'}
              title="Each group with its session dates and totals"
              className="flex items-center gap-1.5 h-9 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 px-3 rounded text-xs font-semibold"
            >
              <Printer size={14} /> Print Simple
            </button>
            <button
              type="button"
              onClick={() => printReport(true)}
              disabled={status !== 'ready'}
              title="Group totals plus the clients who attended each session"
              className="flex items-center gap-1.5 h-9 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 px-3 rounded text-xs font-semibold"
            >
              <Printer size={14} /> Print Detailed
            </button>
          </div>
        </div>
      </div>
      {printError && <p className="text-xs text-red-400">{printError}</p>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
        {[
          { label: 'Fees Charged', value: money(sum('charged')), tone: 'text-amber-400' },
          { label: 'Total Collected', value: money(sum('collected')), tone: 'text-emerald-400' },
          { label: 'Cash', value: money(sum('cash')), tone: 'text-white' },
          { label: 'Credit Card', value: money(sum('card')), tone: 'text-white' },
          { label: 'Attendance', value: String(attendanceCount), tone: 'text-blue-400' },
        ].map(card => (
          <div key={card.label} className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <p className="text-xs text-slate-400">{card.label}</p>
            <p className={`text-xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {anyUnrecorded && (
        <p className="text-xs text-amber-400">{money(sum('unrecorded'))} was collected at check-ins saved before the payment method was recorded on attendance. It's counted in Total Collected but not under Cash or Credit Card.</p>
      )}

      {status === 'error' && <p className="text-xs text-red-400">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <th className="p-3">Group</th>
              <th className="p-3">Counselor</th>
              <th className="p-3 text-right">Sessions</th>
              <th className="p-3 text-right">Attendance</th>
              <th className="p-3 text-right">Clients</th>
              <th className="p-3 text-right">Fees Charged</th>
              <th className="p-3 text-right">Collected</th>
              <th className="p-3 text-right">Cash</th>
              <th className="p-3 text-right">Credit Card</th>
              {anyUnrecorded && <th className="p-3 text-right">Unrecorded</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-sm">
            {shown.map(g => (
              <Fragment key={g.key}>
                <tr onClick={() => toggle(g.key)} className="hover:bg-slate-800/50 cursor-pointer transition">
                  <td className="p-3 font-medium text-white whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">{expanded.has(g.key) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{g.name}</span>
                  </td>
                  <td className="p-3 text-slate-300 text-xs">{g.counselor || '—'}</td>
                  <td className="p-3 text-right">{g.sessions}</td>
                  <td className="p-3 text-right">{g.rows.length}</td>
                  <td className="p-3 text-right">{g.clients}</td>
                  <td className="p-3 text-right text-amber-400">{money(g.charged)}</td>
                  <td className="p-3 text-right font-semibold text-emerald-400">{money(g.collected)}</td>
                  <td className="p-3 text-right">{money(g.cash)}</td>
                  <td className="p-3 text-right">{money(g.card)}</td>
                  {anyUnrecorded && <td className="p-3 text-right text-slate-400">{money(g.unrecorded)}</td>}
                </tr>
                {expanded.has(g.key) && (
                  <tr>
                    <td colSpan={anyUnrecorded ? 10 : 9} className="p-0 bg-slate-950/60">
                      <div className="p-4 space-y-4">
                        {sessionsOf(g).map(([key, attendees]) => {
                          const session = totalsFor(key, attendees);
                          return (
                          <div key={key}>
                            <p className="text-xs font-semibold text-blue-400 mb-2">{sessionLabel(g, attendees)} · {attendees.length} attended</p>
                            {/* Fixed widths keep the columns lined up from one session to the next */}
                            <table className="w-full text-xs table-fixed">
                              <colgroup>
                                <col className="w-[28%]" />
                                <col className="w-[14%]" />
                                <col className="w-[14%]" />
                                <col className="w-[14%]" />
                                <col className="w-[14%]" />
                                <col className="w-[16%]" />
                              </colgroup>
                              <thead>
                                <tr className="text-slate-500 uppercase">
                                  <th className="py-1.5 pr-3 text-left">Client</th>
                                  <th className="py-1.5 pr-3 text-left">DOC #</th>
                                  <th className="py-1.5 pr-3 text-left">Type</th>
                                  <th className="py-1.5 pr-3 text-right">Fee</th>
                                  <th className="py-1.5 pr-3 text-right">Paid</th>
                                  <th className="py-1.5 text-left">Method</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {attendees.map(r => {
                                  const paid = Number(r.accountpaid) || 0;
                                  return (
                                    <tr key={r.attendanceid} className="text-slate-300">
                                      <td className="py-1.5 pr-3 text-white">{r.lastname}, {r.firstname}</td>
                                      <td className="py-1.5 pr-3 font-mono">{r.docnumber || '—'}</td>
                                      <td className="py-1.5 pr-3">{r.type}{r.voucherused ? ' · Voucher' : ''}</td>
                                      <td className="py-1.5 pr-3 text-right">{money(Number(r.groupfee) || 0)}</td>
                                      <td className="py-1.5 pr-3 text-right">{money(paid)}</td>
                                      <td className="py-1.5">{paid > 0 ? (r.paymentmethod || 'Not recorded') : '—'}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t border-slate-700 font-semibold">
                                  <td className="py-2 pr-3 text-slate-300" colSpan={3}>Session Total</td>
                                  <td className="py-2 pr-3 text-right text-amber-400">{money(session.charged)}</td>
                                  <td className="py-2 pr-3 text-right text-emerald-400">{money(session.collected)}</td>
                                  <td className="py-2 text-slate-300 font-normal">
                                    Cash {money(session.cash)} · CC {money(session.card)}
                                    {session.unrecorded > 0 && <span className="text-slate-500"> · Unrecorded {money(session.unrecorded)}</span>}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {status !== 'loading' && shown.length === 0 && (
              <tr>
                <td colSpan={anyUnrecorded ? 10 : 9} className="p-6 text-center text-slate-500 text-sm">No attendance in this date range.</td>
              </tr>
            )}
            {status === 'loading' && (
              <tr>
                <td colSpan={anyUnrecorded ? 10 : 9} className="p-6 text-center text-slate-500 text-sm">Loading…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
