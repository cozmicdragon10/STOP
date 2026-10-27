import { Fragment, useEffect, useState } from 'react';
import { getUserCashDeposits, setUserCashDroppedOff } from '../../api';
import type { UserCashDepositRow } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';

const NOT_RECORDED = 'Not recorded';

const money = (n: number) => `$${n.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100) / 100;
const cashOf = (r: UserCashDepositRow) => Number(r.amount) || 0;
const isDroppedOff = (r: UserCashDepositRow) => r.depositdate !== null;
const sameEmail = (a: string | null, b: string) => String(a || '').trim().toLowerCase() === b.trim().toLowerCase();
const takenByOf = (r: UserCashDepositRow) => r.enteredbyname || r.enteredby || NOT_RECORDED;

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
const formatWhen = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

// Cash payments taken outside a group session (account payments, assessments, individual sessions) and whether each
// was dropped off at the bank. Business Administrators see and check off every payment; everyone else sees and
// checks off the ones they took (the server decides).
export default function UserCashDepositReport({ userEmail, isAdmin }: { userEmail: string; isAdmin: boolean }) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(todayLocal);
  const [statusFilter, setStatusFilter] = useState<'all' | 'held' | 'dropped'>('all');
  const [takenByFilter, setTakenByFilter] = useState('');
  // Date given to new check-offs
  const [dropOffDate, setDropOffDate] = useState(todayLocal);
  const [rows, setRows] = useState<UserCashDepositRow[]>([]);
  // The range the rows (or the error) were loaded for; an invalid range keeps showing the last one
  const [loaded, setLoaded] = useState<{ key: string; error: string } | null>(null);
  const [saving, setSaving] = useState<Set<number>>(() => new Set());
  // Shown under the payment it belongs to
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  const rangeKey = from && to && from <= to ? `${from}|${to}|${userEmail}` : null;
  useEffect(() => {
    if (!rangeKey) return;
    let cancelled = false;
    getUserCashDeposits(from, to, userEmail)
      .then(data => { if (!cancelled) { setRows(data); setLoaded({ key: rangeKey, error: '' }); } })
      .catch(err => { if (!cancelled) setLoaded({ key: rangeKey, error: err.message || 'Failed to load user cash deposits.' }); });
    return () => { cancelled = true; };
  }, [rangeKey, from, to, userEmail]);
  const status = !loaded || (rangeKey && loaded.key !== rangeKey) ? 'loading' : loaded.error ? 'error' : 'ready';
  const error = loaded?.error ?? '';

  const takenByNames = Array.from(new Set(rows.map(takenByOf))).sort((a, b) => a.localeCompare(b));
  const filtered = rows.filter(r =>
    (!takenByFilter || takenByOf(r) === takenByFilter)
    && (statusFilter === 'all' || (statusFilter === 'dropped') === isDroppedOff(r)));

  // Grouped by who took the payment, people holding cash first
  const byPerson = new Map<string, UserCashDepositRow[]>();
  for (const r of filtered) {
    const key = takenByOf(r);
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key)!.push(r);
  }
  const people = Array.from(byPerson.entries()).map(([name, list]) => ({
    name, rows: list,
    held: cents(list.filter(r => !isDroppedOff(r)).reduce((t, r) => t + cashOf(r), 0)),
    droppedOff: cents(list.filter(isDroppedOff).reduce((t, r) => t + cashOf(r), 0)),
  })).sort((a, b) => (a.name === NOT_RECORDED ? 1 : b.name === NOT_RECORDED ? -1 : a.name.localeCompare(b.name)));

  const heldRows = filtered.filter(r => !isDroppedOff(r));
  const droppedRows = filtered.filter(isDroppedOff);
  const totalHeld = cents(heldRows.reduce((t, r) => t + cashOf(r), 0));
  const totalDropped = cents(droppedRows.reduce((t, r) => t + cashOf(r), 0));

  // Non-admins can uncheck only the check-offs they made
  const canToggle = (r: UserCashDepositRow) => isAdmin || !isDroppedOff(r) || sameEmail(r.recordedby, userEmail);

  const toggleDroppedOff = async (r: UserCashDepositRow) => {
    const id = r.transactionid;
    const droppedOff = !isDroppedOff(r);
    if (!droppedOff && !window.confirm(`Uncheck this deposit? The ${money(cashOf(r))} will show as held again.`)) return;
    if (droppedOff && !dropOffDate) {
      setRowError({ id, message: 'Enter the drop-off date above first.' });
      return;
    }
    setRowError(null);
    setSaving(prev => new Set(prev).add(id));
    try {
      const updated = await setUserCashDroppedOff({ transactionId: id, droppedOff, depositDate: dropOffDate, user: userEmail });
      setRows(prev => prev.map(o => (o.transactionid === id ? updated : o)));
    } catch (err: unknown) {
      setRowError({ id, message: err instanceof Error ? err.message : 'Failed to update the deposit.' });
    } finally {
      setSaving(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const input = 'block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs';
  const columns = 5;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">User Cash Deposits</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Cash payments taken outside a group session{isAdmin ? ', by who took them' : ' that you took'}: account payments, assessments, and individual sessions. Check a payment off once its cash has been dropped off at the bank.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={input} />
          </label>
          <label className="text-xs text-slate-400">To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={input} />
          </label>
          <label className="text-xs text-slate-400">Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={input}>
              <option value="all">All</option>
              <option value="held">Holding</option>
              <option value="dropped">Dropped Off</option>
            </select>
          </label>
          {isAdmin && (
            <label className="text-xs text-slate-400">Taken By
              <select value={takenByFilter} onChange={(e) => setTakenByFilter(e.target.value)} className={input}>
                <option value="">Everyone</option>
                {takenByNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}
          <label className="text-xs text-slate-400" title="The date given to payments you check off">Drop-Off Date
            <input type="date" value={dropOffDate} max={todayLocal()} onChange={(e) => setDropOffDate(e.target.value)} className={input} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        {[
          { label: 'Cash Held', value: money(totalHeld), tone: totalHeld > 0 ? 'text-amber-400' : 'text-white' },
          { label: 'Payments Holding Cash', value: String(heldRows.length), tone: 'text-amber-400' },
          { label: 'Cash Dropped Off', value: money(totalDropped), tone: 'text-emerald-400' },
          { label: 'Payments Dropped Off', value: String(droppedRows.length), tone: 'text-emerald-400' },
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
              <th className="p-3">Taken</th>
              <th className="p-3">Client</th>
              <th className="p-3 text-right">Cash</th>
              <th className="p-3 text-center">Dropped Off</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-sm">
            {status === 'ready' && people.map(p => (
              <Fragment key={p.name}>
                <tr className="bg-slate-950/60">
                  <td colSpan={columns} className="p-3">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className={`font-semibold ${p.name === NOT_RECORDED ? 'text-slate-400 italic' : 'text-white'}`}>{p.name === NOT_RECORDED ? 'Taken by: not recorded' : p.name}</span>
                      <span className="ml-auto text-xs">
                        <span className={p.held > 0 ? 'text-amber-400 font-semibold' : 'text-slate-400'}>Holding {money(p.held)}</span>
                        <span className="text-slate-500"> · </span>
                        <span className="text-emerald-400">Dropped off {money(p.droppedOff)}</span>
                      </span>
                    </div>
                  </td>
                </tr>
                {p.rows.map(r => {
                  const id = r.transactionid;
                  const dropped = isDroppedOff(r);
                  const toggleable = canToggle(r);
                  return (
                    <tr key={id} className="hover:bg-slate-800/30 align-top">
                      <td className="p-3 pl-6 text-slate-200 whitespace-nowrap">{formatWhen(r.paidon)}</td>
                      <td className="p-3">
                        <span className="text-white">{r.lastname || r.firstname ? `${r.lastname}, ${r.firstname}` : '—'}</span>
                        <span className="block text-[11px] text-slate-500">{[r.feetype, r.docnumber].filter(Boolean).join(' · ')}</span>
                        {r.comments && <span className="block text-[11px] text-slate-500 max-w-md truncate" title={r.comments}>{r.comments}</span>}
                      </td>
                      <td className="p-3 text-right font-semibold text-white">{money(cashOf(r))}</td>
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={dropped}
                          disabled={saving.has(id) || !toggleable}
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
                          </span>
                        ) : (
                          <span className="text-amber-400 font-semibold">Holding</span>
                        )}
                        {rowError?.id === id && <p className="text-red-400 mt-1">{rowError.message}</p>}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {status === 'ready' && people.length === 0 && (
              <tr>
                <td colSpan={columns} className="p-6 text-center text-slate-500 text-sm">
                  No cash payments{isAdmin ? '' : ' you took'} outside a group in this date range{statusFilter === 'all' ? '' : ' with this status'}.
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
