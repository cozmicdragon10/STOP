import { Fragment, useEffect, useState } from 'react';
import { getGroupCashDeposits, setGroupCashDroppedOff } from '../../api';
import type { GroupCashDepositRow } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';

interface GroupTotals {
  key: string;
  name: string;
  counselor: string | null;
  rows: GroupCashDepositRow[];
  held: number;
  droppedOff: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100) / 100;
const cashOf = (r: GroupCashDepositRow) => Number(r.cash) || 0;
const isDroppedOff = (r: GroupCashDepositRow) => r.depositdate !== null;
const rowKey = (r: GroupCashDepositRow) => `${r.groupid}|${r.sessiondate}#${r.sessionnumber ?? 1}`;
const sameEmail = (a: string | null, b: string) => String(a || '').trim().toLowerCase() === b.trim().toLowerCase();

// First of the month two months back, so the last few months of held cash are in view
const defaultFrom = () => {
  const [y, m] = todayLocal().split('-').map(Number);
  const d = new Date(y, m - 3, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const formatDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return `${Number(m)}/${Number(d)}/${y}`;
};

// Cash collected at closed group sessions and whether it was dropped off at the bank. Business Administrators see
// and check off every session; everyone else sees and checks off the sessions they opened (the server checks too).
export default function GroupCashDepositReport({ userEmail, isAdmin }: { userEmail: string; isAdmin: boolean }) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(todayLocal);
  const [statusFilter, setStatusFilter] = useState<'all' | 'held' | 'dropped'>('all');
  const [openerFilter, setOpenerFilter] = useState('');
  // Date given to new check-offs
  const [dropOffDate, setDropOffDate] = useState(todayLocal);
  const [rows, setRows] = useState<GroupCashDepositRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<Set<string>>(() => new Set());
  // Shown under the session it belongs to
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    if (!from || !to || from > to) return;
    let cancelled = false;
    setStatus('loading');
    getGroupCashDeposits(from, to, userEmail)
      .then(data => { if (!cancelled) { setRows(data); setStatus('ready'); } })
      .catch(err => { if (!cancelled) { setError(err.message || 'Failed to load group cash deposits.'); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [from, to, userEmail]);

  const openerOf = (r: GroupCashDepositRow) => r.openedbyname || r.openedby || 'Unknown';
  const openerNames = Array.from(new Set(rows.map(openerOf))).sort((a, b) => a.localeCompare(b));

  const filtered = rows.filter(r =>
    (!openerFilter || openerOf(r) === openerFilter)
    && (statusFilter === 'all' || (statusFilter === 'dropped') === isDroppedOff(r)));

  const byGroup = new Map<string, GroupCashDepositRow[]>();
  for (const r of filtered) {
    const key = String(r.groupid);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(r);
  }
  const groups = Array.from(byGroup.entries()).map(([key, list]): GroupTotals => ({
    key, name: list[0].groupname, counselor: list[0].counselor, rows: list,
    held: cents(list.filter(r => !isDroppedOff(r)).reduce((t, r) => t + cashOf(r), 0)),
    droppedOff: cents(list.filter(isDroppedOff).reduce((t, r) => t + cashOf(r), 0)),
  })).sort((a, b) => a.name.localeCompare(b.name));

  const heldRows = filtered.filter(r => !isDroppedOff(r));
  const droppedRows = filtered.filter(isDroppedOff);
  const totalHeld = cents(heldRows.reduce((t, r) => t + cashOf(r), 0));
  const totalDropped = cents(droppedRows.reduce((t, r) => t + cashOf(r), 0));

  // Days with more than one session of the group get the session number
  const sessionLabel = (g: GroupTotals, r: GroupCashDepositRow) => {
    const multiple = g.rows.some(o => o.sessiondate === r.sessiondate && o.sessionnumber !== r.sessionnumber);
    return `${formatDate(r.sessiondate)}${multiple ? ` · Session ${r.sessionnumber ?? 1}` : ''}`;
  };

  // Non-admins can uncheck only the check-offs they made
  const canToggle = (r: GroupCashDepositRow) => isAdmin || !isDroppedOff(r) || sameEmail(r.recordedby, userEmail);

  const toggleDroppedOff = async (r: GroupCashDepositRow) => {
    const key = rowKey(r);
    const droppedOff = !isDroppedOff(r);
    if (!droppedOff && !window.confirm(`Uncheck this deposit? The ${money(cashOf(r))} will show as held again.`)) return;
    if (droppedOff && !dropOffDate) {
      setRowError({ key, message: 'Enter the drop-off date above first.' });
      return;
    }
    setRowError(null);
    setSaving(prev => new Set(prev).add(key));
    try {
      const deposit = await setGroupCashDroppedOff({
        groupId: r.groupid, sessionDate: r.sessiondate, sessionNumber: r.sessionnumber ?? 1,
        droppedOff, depositDate: dropOffDate, user: userEmail,
      });
      const cleared = { amountdeposited: null, depositdate: null, notes: null, recordedby: null, recordedbyname: null, recordedon: null };
      setRows(prev => prev.map(o => rowKey(o) === key ? { ...o, ...cleared, ...(deposit || {}) } : o));
    } catch (err: any) {
      setRowError({ key, message: err.message || 'Failed to update the deposit.' });
    } finally {
      setSaving(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const columns = isAdmin ? 6 : 5;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">Group Cash Deposits</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Cash collected at closed group sessions{isAdmin ? '' : ' you opened'}. Check a session off once its cash has been dropped off at the bank.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs" />
          </label>
          <label className="text-xs text-slate-400">To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs" />
          </label>
          <label className="text-xs text-slate-400">Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs">
              <option value="all">All</option>
              <option value="held">Holding</option>
              <option value="dropped">Dropped Off</option>
            </select>
          </label>
          {isAdmin && (
            <label className="text-xs text-slate-400">Opened By
              <select value={openerFilter} onChange={(e) => setOpenerFilter(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs">
                <option value="">Everyone</option>
                {openerNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}
          <label className="text-xs text-slate-400" title="The date given to sessions you check off">Drop-Off Date
            <input type="date" value={dropOffDate} max={todayLocal()} onChange={(e) => setDropOffDate(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs" />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        {[
          { label: 'Cash Held', value: money(totalHeld), tone: totalHeld > 0 ? 'text-amber-400' : 'text-white' },
          { label: 'Sessions Holding Cash', value: String(heldRows.length), tone: 'text-amber-400' },
          { label: 'Cash Dropped Off', value: money(totalDropped), tone: 'text-emerald-400' },
          { label: 'Sessions Dropped Off', value: String(droppedRows.length), tone: 'text-emerald-400' },
        ].map(card => (
          <div key={card.label} className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <p className="text-xs text-slate-400">{card.label}</p>
            <p className={`text-xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {status === 'error' && <p className="text-xs text-red-400">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <th className="p-3">Session</th>
              {isAdmin && <th className="p-3">Opened By</th>}
              <th className="p-3 text-right">Attendance</th>
              <th className="p-3 text-right">Cash</th>
              <th className="p-3 text-center">Dropped Off</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-sm">
            {status === 'ready' && groups.map(g => (
              <Fragment key={g.key}>
                <tr className="bg-slate-950/60">
                  <td colSpan={columns} className="p-3">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className="font-semibold text-white">{g.name}</span>
                      {g.counselor && <span className="text-xs text-slate-400">{g.counselor}</span>}
                      <span className="ml-auto text-xs">
                        <span className={g.held > 0 ? 'text-amber-400 font-semibold' : 'text-slate-400'}>Holding {money(g.held)}</span>
                        <span className="text-slate-500"> · </span>
                        <span className="text-emerald-400">Dropped off {money(g.droppedOff)}</span>
                      </span>
                    </div>
                  </td>
                </tr>
                {g.rows.map(r => {
                  const key = rowKey(r);
                  const dropped = isDroppedOff(r);
                  const deposited = Number(r.amountdeposited) || 0;
                  const variance = cents(deposited - cashOf(r));
                  const toggleable = canToggle(r);
                  return (
                    <tr key={key} className="hover:bg-slate-800/30">
                      <td className="p-3 pl-6 text-slate-200 whitespace-nowrap">{sessionLabel(g, r)}</td>
                      {isAdmin && <td className="p-3 text-slate-300 text-xs">{openerOf(r)}</td>}
                      <td className="p-3 text-right">{Number(r.attendance) || 0}</td>
                      <td className="p-3 text-right font-semibold text-white">{money(cashOf(r))}</td>
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={dropped}
                          disabled={saving.has(key) || !toggleable}
                          onChange={() => toggleDroppedOff(r)}
                          title={toggleable
                            ? (dropped ? 'Uncheck if this cash was not dropped off' : 'Check off once this cash is dropped off at the bank')
                            : 'Checked off by someone else. A Business Administrator can uncheck it.'}
                          className="h-4 w-4 rounded accent-emerald-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </td>
                      <td className="p-3 text-xs">
                        {dropped ? (
                          <span className="text-slate-300">
                            <span className="text-emerald-400 font-semibold">Dropped off</span> {formatDate(r.depositdate!)}
                            {(r.recordedbyname || r.recordedby) && <span className="text-slate-500"> · by {r.recordedbyname || r.recordedby}</span>}
                            {variance !== 0 && (
                              <span className={variance > 0 ? 'text-sky-400' : 'text-red-400'}> · {money(deposited)} deposited, {variance > 0 ? 'over' : 'short'} {money(Math.abs(variance))}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-amber-400 font-semibold">Holding</span>
                        )}
                        {rowError?.key === key && <p className="text-red-400 mt-1">{rowError.message}</p>}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {status === 'ready' && groups.length === 0 && (
              <tr>
                <td colSpan={columns} className="p-6 text-center text-slate-500 text-sm">
                  No closed group sessions{isAdmin ? '' : ' you opened'} took cash in this date range{statusFilter === 'all' ? '' : ' with this status'}.
                </td>
              </tr>
            )}
            {status === 'loading' && (
              <tr>
                <td colSpan={columns} className="p-6 text-center text-slate-500 text-sm">Loading…</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
