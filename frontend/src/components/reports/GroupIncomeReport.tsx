import { Fragment, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Landmark, Pencil, Printer, Trash2 } from 'lucide-react';
import { deleteGroupDeposit, getGroupDeposits, getGroupReport, saveGroupDeposit } from '../../api';
import type { GroupDeposit, GroupReportRow } from '../../api';
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

// Cash deposits across a group's sessions. Variance is deposited minus cash, over the sessions that have a deposit.
interface DepositSummary {
  deposited: number;
  variance: number;
  // Sessions that took cash but have no deposit recorded yet
  pending: number;
  recorded: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100) / 100;
const firstOfMonth = () => `${todayLocal().slice(0, 8)}01`;
// A group can meet more than once a day; each session is its own entry
const sessionKey = (r: GroupReportRow) => `${r.date}#${r.sessionnumber ?? 1}`;
const depositKey = (groupId: string | number, date: string, sessionNumber: number | null) => `${groupId}|${date}#${sessionNumber ?? 1}`;

// "Accounted for", "Over $x", or "Short $x" for a deposit against the cash it covers
const varianceLabel = (variance: number) =>
  variance === 0 ? 'Accounted for' : `${variance > 0 ? 'Over' : 'Short'} ${money(Math.abs(variance))}`;
const varianceTone = (variance: number) => (variance === 0 ? 'text-emerald-400' : variance > 0 ? 'text-sky-400' : 'text-red-400');

const sumDeposits = (list: DepositSummary[]): DepositSummary => list.reduce(
  (t, d) => ({ deposited: cents(t.deposited + d.deposited), variance: cents(t.variance + d.variance), pending: t.pending + d.pending, recorded: t.recorded + d.recorded }),
  { deposited: 0, variance: 0, pending: 0, recorded: 0 }
);

const depositStatusText = (d: DepositSummary) => {
  if (d.recorded === 0 && d.pending === 0) return '—';
  const parts = [];
  if (d.pending > 0) parts.push(`${d.pending} pending`);
  if (d.recorded > 0 && (d.variance !== 0 || d.pending === 0)) parts.push(varianceLabel(d.variance));
  return parts.join(' · ');
};

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

// Only Business Administrators record, edit, or remove deposits; everyone else sees the status (the server checks too)
export default function GroupIncomeReport({ userEmail, canRecordDeposits }: { userEmail: string; canRecordDeposits: boolean }) {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayLocal);
  // One date instead of a range; from and to are kept equal while it's on
  const [singleDay, setSingleDay] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [counselorFilter, setCounselorFilter] = useState('');
  const [rows, setRows] = useState<GroupReportRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [printError, setPrintError] = useState('');
  const [deposits, setDeposits] = useState<Map<string, GroupDeposit>>(() => new Map());
  const [depositsError, setDepositsError] = useState('');
  // The session whose deposit form is open, by depositKey
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ amount: '', date: '', notes: '' });
  const [saving, setSaving] = useState(false);
  // Shown under the session it belongs to
  const [formError, setFormError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    if (!from || !to || from > to) return;
    let cancelled = false;
    setStatus('loading');
    getGroupReport(from, to)
      .then(data => { if (!cancelled) { setRows(data); setStatus('ready'); } })
      .catch(err => { if (!cancelled) { setError(err.message || 'Failed to load the group report.'); setStatus('error'); } });
    // Loaded on their own so the report still shows if deposits can't be read
    setDepositsError('');
    getGroupDeposits(from, to)
      .then(list => { if (!cancelled) setDeposits(new Map(list.map(d => [depositKey(d.groupid, d.sessiondate, d.sessionnumber), d]))); })
      .catch(err => { if (!cancelled) { setDeposits(new Map()); setDepositsError(err.message || 'Failed to load group deposits.'); } });
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

  const counselorOf = (g: GroupTotals) => g.counselor || 'No counselor';
  const counselorNames = Array.from(new Set(groups.map(counselorOf))).sort((a, b) => a.localeCompare(b));
  const groupOptions = counselorFilter ? groups.filter(g => counselorOf(g) === counselorFilter) : groups;
  const shown = groupFilter ? groupOptions.filter(g => g.key === groupFilter) : groupOptions;
  const sum = (field: 'charged' | 'collected' | 'cash' | 'card' | 'unrecorded') => shown.reduce((t, g) => t + g[field], 0);
  const attendanceCount = shown.reduce((t, g) => t + g.rows.length, 0);
  // Attendance with no group isn't a group
  const groupCount = shown.filter(g => g.key !== 'none').length;
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

  // Attendance with no group can't be tied to a deposit
  const sessionDepositKey = (g: GroupTotals, attendees: GroupReportRow[]) => depositKey(g.key, attendees[0].date, attendees[0].sessionnumber);

  const depositSummary = (g: GroupTotals): DepositSummary => {
    const d: DepositSummary = { deposited: 0, variance: 0, pending: 0, recorded: 0 };
    if (g.key === 'none') return d;
    for (const [key, attendees] of sessionsOf(g)) {
      const cash = totalsFor(key, attendees).cash;
      const deposit = deposits.get(sessionDepositKey(g, attendees));
      if (deposit) {
        const amount = Number(deposit.amountdeposited) || 0;
        d.deposited += amount;
        d.variance += amount - cash;
        d.recorded++;
      } else if (cash > 0) d.pending++;
    }
    d.deposited = cents(d.deposited);
    d.variance = cents(d.variance);
    return d;
  };

  const depositTotals = sumDeposits(shown.map(depositSummary));

  // The shown groups rolled up by the counselor who runs them
  const counselorTotals = Array.from(
    shown.reduce((m, g) => m.set(counselorOf(g), [...(m.get(counselorOf(g)) || []), g]), new Map<string, GroupTotals[]>())
  ).map(([name, list]) => {
    const total = (field: 'sessions' | 'charged' | 'collected' | 'cash' | 'card' | 'unrecorded') => list.reduce((t, g) => t + g[field], 0);
    const deposit = sumDeposits(list.map(depositSummary));
    return {
      name, groups: list.length, sessions: total('sessions'),
      attendance: list.reduce((t, g) => t + g.rows.length, 0),
      clients: new Set(list.flatMap(g => g.rows.map(r => r.clientid))).size,
      charged: total('charged'), collected: total('collected'), cash: total('cash'), card: total('card'), unrecorded: total('unrecorded'),
      deposit,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // One session's deposit for the printed report
  const sessionDepositText = (g: GroupTotals, key: string, attendees: GroupReportRow[]) => {
    const deposit = deposits.get(sessionDepositKey(g, attendees));
    const cash = totalsFor(key, attendees).cash;
    if (!deposit) return cash > 0 && g.key !== 'none' ? 'Pending' : '—';
    const amount = Number(deposit.amountdeposited) || 0;
    return `${money(amount)} on ${formatDate(deposit.depositdate)} · ${varianceLabel(cents(amount - cash))}`;
  };

  const openDepositForm = (key: string, cash: number, existing?: GroupDeposit) => {
    setEditing(key);
    setFormError(null);
    setForm(existing
      ? { amount: (Number(existing.amountdeposited) || 0).toFixed(2), date: existing.depositdate, notes: existing.notes || '' }
      : { amount: cash.toFixed(2), date: todayLocal(), notes: '' });
  };

  const sessionRef = (g: GroupTotals, attendees: GroupReportRow[]) =>
    ({ groupId: Number(g.key), sessionDate: attendees[0].date, sessionNumber: attendees[0].sessionnumber ?? 1 });

  const submitDeposit = async (g: GroupTotals, attendees: GroupReportRow[]) => {
    const key = sessionDepositKey(g, attendees);
    const amount = Number(form.amount);
    if (form.amount.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      setFormError({ key, message: 'Enter the amount deposited ($0.00 or more).' });
      return;
    }
    if (!form.date) {
      setFormError({ key, message: 'Enter the date the deposit was made.' });
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const saved = await saveGroupDeposit({ ...sessionRef(g, attendees), amountDeposited: cents(amount), depositDate: form.date, notes: form.notes, user: userEmail });
      setDeposits(prev => new Map(prev).set(key, saved));
      setEditing(null);
    } catch (err: any) {
      setFormError({ key, message: err.message || 'Failed to save the deposit.' });
    } finally {
      setSaving(false);
    }
  };

  const removeDeposit = async (g: GroupTotals, attendees: GroupReportRow[]) => {
    if (!window.confirm('Remove this deposit? The session will show as pending again.')) return;
    const key = sessionDepositKey(g, attendees);
    setFormError(null);
    try {
      await deleteGroupDeposit({ ...sessionRef(g, attendees), user: userEmail });
      setDeposits(prev => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    } catch (err: any) {
      setFormError({ key, message: err.message || 'Failed to remove the deposit.' });
    }
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
    const groupName = [counselorFilter, groupFilter ? shown[0]?.name ?? 'Selected group' : 'All Groups'].filter(Boolean).join(' · ');
    const counselorRows = counselorTotals.map(c => `<tr>
      <td>${escapeHtml(c.name)}</td><td class="r">${c.groups}</td><td class="r">${c.sessions}</td><td class="r">${c.attendance}</td><td class="r">${c.clients}</td>
      <td class="r">${money(c.charged)}</td><td class="r">${money(c.collected)}</td><td class="r">${money(c.cash)}</td><td class="r">${money(c.card)}</td>
      ${anyUnrecorded ? `<td class="r">${money(c.unrecorded)}</td>` : ''}
      <td class="r">${money(c.deposit.deposited)}</td><td>${escapeHtml(depositStatusText(c.deposit))}</td></tr>`).join('');
    const cols = anyUnrecorded ? 11 : 10;
    const groupRows = shown.map(g => `
      <tr class="group">
        <td>${escapeHtml(g.name)}</td><td>${escapeHtml(g.counselor || '—')}</td>
        <td class="r">${g.sessions}</td><td class="r">${g.rows.length}</td><td class="r">${g.clients}</td>
        <td class="r">${money(g.charged)}</td><td class="r">${money(g.collected)}</td>
        <td class="r">${money(g.cash)}</td><td class="r">${money(g.card)}</td>
        ${anyUnrecorded ? `<td class="r">${money(g.unrecorded)}</td>` : ''}
        <td>${escapeHtml(depositStatusText(depositSummary(g)))}</td>
      </tr>
      ${!detailed ? sessionsOf(g).map(([key, attendees]) => {
        const s = totalsFor(key, attendees);
        return `<tr class="sess">
          <td class="indent">${escapeHtml(sessionLabel(g, attendees))}</td><td></td><td></td>
          <td class="r">${attendees.length}</td><td class="r">${s.clients}</td>
          <td class="r">${money(s.charged)}</td><td class="r">${money(s.collected)}</td>
          <td class="r">${money(s.cash)}</td><td class="r">${money(s.card)}</td>
          ${anyUnrecorded ? `<td class="r">${money(s.unrecorded)}</td>` : ''}
          <td>${escapeHtml(sessionDepositText(g, key, attendees))}</td>
        </tr>`;
      }).join('') : ''}
      ${detailed ? `<tr><td colspan="${cols}" class="detail">${sessionsOf(g).map(([key, attendees]) => {
        const s = totalsFor(key, attendees);
        const deposit = deposits.get(sessionDepositKey(g, attendees));
        return `<p class="session">${escapeHtml(sessionLabel(g, attendees))} · ${attendees.length} attended · Deposit: ${escapeHtml(sessionDepositText(g, key, attendees))}${deposit?.notes ? ` (${escapeHtml(deposit.notes)})` : ''}</p>
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
        h1{font-size:18px;margin:0}.muted{color:#555;margin:2px 0}h2{font-size:14px;margin:16px 0 4px}
        .counselors td{border-top:1px solid #ddd}
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
        <div>Cash Deposited<b>${money(depositTotals.deposited)}</b>${escapeHtml(depositStatusText(depositTotals))}</div>
        <div>Groups<b>${groupCount}</b></div><div>Attendance<b>${attendanceCount}</b></div>
      </div>
      ${anyUnrecorded ? `<p class="note">${money(sum('unrecorded'))} was collected at check-ins saved before the payment method was recorded; it is in Total Collected but not under Cash or Credit Card.</p>` : ''}
      ${counselorRows ? `<h2>By Counselor</h2>
      <table class="main counselors"><thead><tr>
        <th>Counselor</th><th class="r">Groups</th><th class="r">Sessions</th><th class="r">Attendance</th><th class="r">Clients</th>
        <th class="r">Fees Charged</th><th class="r">Collected</th><th class="r">Cash</th><th class="r">Credit Card</th>
        ${anyUnrecorded ? '<th class="r">Unrecorded</th>' : ''}<th class="r">Deposited</th><th>Deposit</th>
      </tr></thead><tbody>${counselorRows}</tbody></table>
      <h2>By Group</h2>` : ''}
      <table class="main"><thead><tr>
        <th>Group</th><th>Counselor</th><th class="r">Sessions</th><th class="r">Attendance</th><th class="r">Clients</th>
        <th class="r">Fees Charged</th><th class="r">Collected</th><th class="r">Cash</th><th class="r">Credit Card</th>
        ${anyUnrecorded ? '<th class="r">Unrecorded</th>' : ''}<th>Deposit</th>
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
          <p className="text-xs text-slate-400 mt-0.5">Fees, payments, and attendance by group. Click a group to see who attended each session{canRecordDeposits ? ' and to record its cash deposits' : ''}.</p>
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
          <button
            type="button"
            onClick={() => { setSingleDay(false); setFrom(firstOfMonth()); setTo(todayLocal()); }}
            title="The 1st of this month through today"
            className="h-9 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 rounded text-xs font-semibold"
          >
            This Month
          </button>
          <label className="text-xs text-slate-400">Counselor
            <select value={counselorFilter} onChange={(e) => { setCounselorFilter(e.target.value); setGroupFilter(''); }} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs">
              <option value="">All Counselors</option>
              {counselorNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Group
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs">
              <option value="">All Groups</option>
              {groupOptions.map(g => <option key={g.key} value={g.key}>{g.name}</option>)}
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

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 text-center">
        {[
          { label: 'Fees Charged', value: money(sum('charged')), tone: 'text-amber-400' },
          { label: 'Total Collected', value: money(sum('collected')), tone: 'text-emerald-400' },
          { label: 'Cash', value: money(sum('cash')), tone: 'text-white' },
          { label: 'Credit Card', value: money(sum('card')), tone: 'text-white' },
          {
            label: 'Cash Deposited', value: money(depositTotals.deposited), tone: 'text-white',
            note: depositStatusText(depositTotals), noteTone: depositTotals.pending > 0 ? 'text-amber-400' : varianceTone(depositTotals.variance),
          },
          { label: 'Groups', value: String(groupCount), tone: 'text-blue-400' },
          { label: 'Attendance', value: String(attendanceCount), tone: 'text-blue-400' },
        ].map(card => (
          <div key={card.label} className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <p className="text-xs text-slate-400">{card.label}</p>
            <p className={`text-xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
            {'note' in card && card.note !== '—' && <p className={`text-xs mt-1 ${card.noteTone}`}>{card.note}</p>}
          </div>
        ))}
      </div>

      {depositsError && <p className="text-xs text-red-400">{depositsError}</p>}

      {anyUnrecorded && (
        <p className="text-xs text-amber-400">{money(sum('unrecorded'))} was collected at check-ins saved before the payment method was recorded on attendance. It's counted in Total Collected but not under Cash or Credit Card.</p>
      )}

      {status === 'error' && <p className="text-xs text-red-400">{error}</p>}

      {status === 'ready' && counselorTotals.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">By Counselor</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <th className="p-3">Counselor</th>
                  <th className="p-3 text-right">Groups</th>
                  <th className="p-3 text-right">Sessions</th>
                  <th className="p-3 text-right">Attendance</th>
                  <th className="p-3 text-right">Clients</th>
                  <th className="p-3 text-right">Fees Charged</th>
                  <th className="p-3 text-right">Collected</th>
                  <th className="p-3 text-right">Cash</th>
                  <th className="p-3 text-right">Credit Card</th>
                  {anyUnrecorded && <th className="p-3 text-right">Unrecorded</th>}
                  <th className="p-3 text-right">Deposited</th>
                  <th className="p-3">Deposit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-sm">
                {counselorTotals.map(c => (
                  <tr
                    key={c.name}
                    onClick={() => { setCounselorFilter(counselorFilter === c.name ? '' : c.name); setGroupFilter(''); }}
                    title={counselorFilter === c.name ? 'Show all counselors' : `Show only ${c.name}'s groups`}
                    className={`cursor-pointer transition hover:bg-slate-800/50 ${counselorFilter === c.name ? 'bg-blue-500/10' : ''}`}
                  >
                    <td className="p-3 font-medium text-white whitespace-nowrap">{c.name}</td>
                    <td className="p-3 text-right">{c.groups}</td>
                    <td className="p-3 text-right">{c.sessions}</td>
                    <td className="p-3 text-right">{c.attendance}</td>
                    <td className="p-3 text-right">{c.clients}</td>
                    <td className="p-3 text-right text-amber-400">{money(c.charged)}</td>
                    <td className="p-3 text-right font-semibold text-emerald-400">{money(c.collected)}</td>
                    <td className="p-3 text-right">{money(c.cash)}</td>
                    <td className="p-3 text-right">{money(c.card)}</td>
                    {anyUnrecorded && <td className="p-3 text-right text-slate-400">{money(c.unrecorded)}</td>}
                    <td className="p-3 text-right">{money(c.deposit.deposited)}</td>
                    <td className={`p-3 text-xs font-semibold whitespace-nowrap ${c.deposit.pending > 0 ? 'text-amber-400' : c.deposit.recorded > 0 ? varianceTone(c.deposit.variance) : 'text-slate-500'}`}>
                      {depositStatusText(c.deposit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
              <th className="p-3">Deposit</th>
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
                  {(() => {
                    const d = depositSummary(g);
                    const tone = d.pending > 0 ? 'text-amber-400' : d.recorded > 0 ? varianceTone(d.variance) : 'text-slate-500';
                    return (
                      <td className={`p-3 text-xs font-semibold whitespace-nowrap ${tone}`}>
                        {d.pending > 0 ? (
                          // Opens the group so each pending session's Record Deposit button is in view
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setExpanded(prev => new Set(prev).add(g.key)); }}
                            title={canRecordDeposits ? 'Show the sessions waiting on a deposit' : 'Show the sessions'}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 hover:bg-amber-500/20"
                          >
                            <Landmark size={12} /> {depositStatusText(d)}
                          </button>
                        ) : (
                          <>
                            {d.recorded > 0 && d.variance === 0 && <CheckCircle2 size={13} className="inline mr-1 -mt-0.5" />}
                            {depositStatusText(d)}
                          </>
                        )}
                      </td>
                    );
                  })()}
                </tr>
                {expanded.has(g.key) && (
                  <tr>
                    <td colSpan={anyUnrecorded ? 11 : 10} className="p-0 bg-slate-950/60">
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
                            {g.key !== 'none' && (() => {
                              const dKey = sessionDepositKey(g, attendees);
                              const deposit = deposits.get(dKey);
                              if (!deposit && session.cash === 0 && editing !== dKey) return null;
                              const deposited = Number(deposit?.amountdeposited) || 0;
                              const formVariance = cents((Number(form.amount) || 0) - session.cash);
                              return (
                                <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs">
                                  {editing === dKey ? (
                                    <form onSubmit={(e) => { e.preventDefault(); submitDeposit(g, attendees); }} className="flex flex-wrap items-end gap-3">
                                      <div className="text-slate-400">Cash Collected
                                        <p className="mt-1 h-8 flex items-center font-semibold text-white">{money(session.cash)}</p>
                                      </div>
                                      <label className="text-slate-400">Amount Deposited
                                        <input type="number" min="0" step="0.01" value={form.amount} autoFocus onChange={(e) => setForm({ ...form, amount: e.target.value })} className="block mt-1 h-8 w-28 bg-slate-950 border border-slate-700 rounded px-2 text-white" />
                                      </label>
                                      <label className="text-slate-400">Deposit Date
                                        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="block mt-1 h-8 bg-slate-950 border border-slate-700 rounded px-2 text-white" />
                                      </label>
                                      <label className="text-slate-400 flex-1 min-w-[180px]">Notes
                                        <input type="text" value={form.notes} placeholder="Deposit slip #, reason for a difference…" onChange={(e) => setForm({ ...form, notes: e.target.value })} className="block mt-1 h-8 w-full bg-slate-950 border border-slate-700 rounded px-2 text-white" />
                                      </label>
                                      <p className={`h-8 flex items-center font-semibold ${varianceTone(formVariance)}`}>{varianceLabel(formVariance)}</p>
                                      <div className="flex gap-2 h-8">
                                        <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 rounded font-semibold">{saving ? 'Saving…' : 'Save Deposit'}</button>
                                        <button type="button" onClick={() => { setEditing(null); setFormError(null); }} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 rounded">Cancel</button>
                                      </div>
                                    </form>
                                  ) : deposit ? (
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                      <span className={`inline-flex items-center gap-1 font-semibold ${varianceTone(cents(deposited - session.cash))}`}>
                                        <CheckCircle2 size={14} /> {varianceLabel(cents(deposited - session.cash))}
                                      </span>
                                      <span className="text-slate-300">
                                        Deposited {money(deposited)} of {money(session.cash)} cash on {formatDate(deposit.depositdate)}
                                        {deposit.recordedby && <span className="text-slate-500"> · recorded by {deposit.recordedby}</span>}
                                      </span>
                                      {deposit.notes && <span className="text-slate-400 italic">{deposit.notes}</span>}
                                      {canRecordDeposits && (
                                        <span className="ml-auto flex gap-2">
                                          <button type="button" onClick={() => openDepositForm(dKey, session.cash, deposit)} className="inline-flex items-center gap-1 text-slate-300 hover:text-white"><Pencil size={12} /> Edit</button>
                                          <button type="button" onClick={() => removeDeposit(g, attendees)} className="inline-flex items-center gap-1 text-slate-400 hover:text-red-400"><Trash2 size={12} /> Remove</button>
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap items-center gap-3">
                                      <span className="font-semibold text-amber-400">Deposit pending</span>
                                      <span className="text-slate-300">{money(session.cash)} cash collected</span>
                                      {canRecordDeposits && (
                                        <button type="button" onClick={() => openDepositForm(dKey, session.cash)} className="ml-auto inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded font-semibold">
                                          <Landmark size={13} /> Record Deposit
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {formError?.key === dKey && <p className="text-red-400 mt-1.5">{formError.message}</p>}
                                </div>
                              );
                            })()}
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
                <td colSpan={anyUnrecorded ? 11 : 10} className="p-6 text-center text-slate-500 text-sm">No attendance in this date range.</td>
              </tr>
            )}
            {status === 'loading' && (
              <tr>
                <td colSpan={anyUnrecorded ? 11 : 10} className="p-6 text-center text-slate-500 text-sm">Loading…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
