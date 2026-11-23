import { Fragment, useEffect, useState } from 'react';
import QuickRanges from './QuickRanges';
import { getUserCashDeposits } from '../../api';
import type { UserCashDepositRow } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';
import { idText } from '../../utils/clients';
import { paymentMethodText } from '../../utils/paymentMethods';

const NOT_RECORDED = 'Not recorded';

const money = (n: number) => `$${n.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100) / 100;
const cashOf = (r: UserCashDepositRow) => Number(r.amount) || 0;
const isDroppedOff = (r: UserCashDepositRow) => r.depositdate !== null;
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
const formatWhen = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });

// Cash payments taken outside a group session (account payments, assessments, individual sessions), who holds each
// now, and whether it was dropped off at the bank. Business Administrators see every payment; everyone else sees the
// ones they took or were handed (the server decides). Drop-offs are recorded on Money on Hand
// (components/moneyOnHand/MoneyOnHand.tsx).
export default function UserCashDepositReport({ userEmail, isAdmin }: { userEmail: string; isAdmin: boolean }) {
  const employeeLabel = useEmployeeLabel();
  // "Display Name (Role)"; payments from before this was recorded have no one
  const takenByOf = (r: UserCashDepositRow) => (r.enteredby ? employeeLabel(r.enteredby) : NOT_RECORDED);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(todayLocal);
  const [statusFilter, setStatusFilter] = useState<'all' | 'held' | 'dropped'>('all');
  const [takenByFilter, setTakenByFilter] = useState('');
  const [rows, setRows] = useState<UserCashDepositRow[]>([]);
  // The range the rows (or the error) were loaded for; an invalid range keeps showing the last one
  const [loaded, setLoaded] = useState<{ key: string; error: string } | null>(null);

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

  const input = 'block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs';
  const columns = 4;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">User Cash Deposits</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Cash payments taken outside a group session{isAdmin ? ', by who took them' : ' that you took'}: account payments, assessments, and individual sessions. Drop-offs are recorded on Money on Hand.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={input} />
          </label>
          <label className="text-xs text-slate-400">To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={input} />
          </label>
          <QuickRanges from={from} to={to} onPick={(f, t) => { setFrom(f); setTo(t); }} />
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
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))] gap-3 text-center">
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
                  return (
                    <tr key={id} className="hover:bg-slate-800/30 align-top">
                      <td className="p-3 pl-6 text-slate-200 whitespace-nowrap">{formatWhen(r.paidon)}</td>
                      <td className="p-3">
                        <span className="text-white">{r.lastname || r.firstname ? `${r.lastname}, ${r.firstname}` : '—'}</span>
                        <span className="block text-[0.6875rem] text-slate-500">{[paymentMethodText(r.paymentmethod || 'Cash', r.paymentsubtype, r.paymentreference), r.feetype, idText(r)].filter(Boolean).join(' · ')}</span>
                        {r.comments && <span className="block text-[0.6875rem] text-slate-500 max-w-md truncate" title={r.comments}>{r.comments}</span>}
                      </td>
                      <td className="p-3 text-right font-semibold text-white">{money(cashOf(r))}</td>
                      <td className="p-3 text-xs">
                        {dropped ? (
                          <span className="text-slate-300">
                            <span className="text-emerald-400 font-semibold">Dropped off</span> {formatDate(r.depositdate!)}
                            {r.recordedby && <span className="text-slate-500"> · by {employeeLabel(r.recordedby)}</span>}
                            {r.bankdepositid && <span className="text-slate-500"> · {r.slipnumber ? `slip ${r.slipnumber}` : `deposit #${r.bankdepositid}`}{r.bankchecked ? ', checked with bank' : ''}</span>}
                          </span>
                        ) : (
                          <span><span className="text-amber-400 font-semibold">Holding</span>
                            {r.holder && !sameEmail(r.holder, r.enteredby || '') && <span className="text-amber-300/80"> · handed to {r.holdername || employeeLabel(r.holder)}</span>}</span>
                        )}
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
