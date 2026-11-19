import { useCallback, useEffect, useState } from 'react';
import { Printer, Landmark } from 'lucide-react';
import { dropOffHeldGroupCash, getHeldGroupCash } from '../../api';
import type { HeldGroupCash } from '../../api';
import { printCashDepositReceipt } from '../../utils/receipt';
import { todayLocal } from '../../hooks/useGroupCheckIn';

interface Props {
  isAdmin: boolean;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

interface Holder {
  email: string;
  name: string;
  sessions: HeldGroupCash[];
  total: number;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const cashOf = (s: HeldGroupCash) => Number(s.cash) || 0;

// Closed Groups > Cash (Total Cash Deposit): the cash from closed group sessions that hasn't been dropped off at the
// bank yet, with its total. Print Receipt prints the list and total to go with the cash; Drop Off Deposit checks every
// listed session off as dropped off (the Group Cash Deposits report shows the same check-offs). Business Administrators
// see each person's cash held separately.
export default function CashHeldPanel({ isAdmin, onSuccess, onError }: Props) {
  const [rows, setRows] = useState<HeldGroupCash[] | null>(null);
  const [loadError, setLoadError] = useState('');
  // The person whose drop-off is being confirmed, and the date it was dropped off
  const [confirming, setConfirming] = useState<{ email: string; date: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await getHeldGroupCash());
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error && err.message ? err.message : 'Failed to load the cash held.');
    }
  }, []);

  useEffect(() => {
    // load only sets state after its request finishes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const holders: Holder[] = [];
  for (const s of rows ?? []) {
    const key = s.responsible.toLowerCase();
    let h = holders.find(x => x.email.toLowerCase() === key);
    if (!h) holders.push(h = { email: s.responsible, name: s.responsiblename || s.responsible, sessions: [], total: 0 });
    h.sessions.push(s);
    h.total = Math.round((h.total + cashOf(s)) * 100) / 100;
  }
  const grandTotal = holders.reduce((t, h) => t + h.total, 0);

  const print = (h: Holder) => printCashDepositReceipt({
    heldBy: h.name,
    sessions: h.sessions.map(s => ({ groupName: s.groupname, sessionDate: s.sessiondate, sessionNumber: s.sessionnumber ?? 1, cash: cashOf(s) })),
  }, onError);

  const dropOff = async (h: Holder, date: string) => {
    setSaving(true);
    try {
      const r = await dropOffHeldGroupCash({
        depositDate: date,
        sessions: h.sessions.map(s => ({ groupId: s.groupid, sessionDate: s.sessiondate, sessionNumber: s.sessionnumber ?? 1, cash: cashOf(s) })),
      });
      onSuccess(`Deposit of ${money(r.total)} from ${r.count} group session(s) checked off as dropped off${isAdmin ? ` for ${h.name}` : ''}.`);
      setConfirming(null);
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Failed to record the drop-off.');
    } finally {
      setSaving(false);
      load();
    }
  };

  if (loadError) return <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{loadError}</p>;
  if (rows === null) return <div className="animate-pulse h-24 rounded-lg bg-slate-800/60" aria-label="Loading cash held" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400 leading-relaxed">
        Cash from closed groups that hasn't been dropped off at the bank{isAdmin ? ', by who is holding it' : ''}. Print the receipt to go
        with the cash, then press Drop Off Deposit when it's dropped off.
      </p>
      {holders.length === 0 ? (
        <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-lg p-4 text-center">No group cash is being held.</p>
      ) : (
        <>
          {isAdmin && holders.length > 1 && (
            <p className="flex justify-between text-sm font-semibold text-white bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
              <span>Total cash held</span><span>{money(grandTotal)}</span>
            </p>
          )}
          <ul className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
            {holders.map(h => {
              const open = confirming?.email === h.email;
              return (
                <li key={h.email} className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
                  <div className="flex justify-between items-baseline gap-2 mb-2">
                    <span className="text-sm font-semibold text-white truncate">{isAdmin ? h.name : 'Total Cash Deposit'}</span>
                    <span className="text-base font-bold text-emerald-400 shrink-0">{money(h.total)}</span>
                  </div>
                  <ul className="divide-y divide-slate-800 border-y border-slate-800">
                    {h.sessions.map(s => (
                      <li key={`${s.groupid}-${s.sessiondate}-${s.sessionnumber}`} className="flex justify-between gap-2 py-1.5">
                        <span className="text-slate-200 truncate">
                          {s.groupname}{(s.sessionnumber ?? 1) > 1 ? ` · Session ${s.sessionnumber}` : ''}
                          <span className="text-slate-500"> · {new Date(`${s.sessiondate}T00:00:00`).toLocaleDateString()}</span>
                        </span>
                        <span className="text-slate-300 shrink-0">{money(cashOf(s))}</span>
                      </li>
                    ))}
                  </ul>
                  {open ? (
                    <div className="mt-2 space-y-2">
                      <label className="flex items-center justify-between gap-2 text-slate-300">
                        Date dropped off
                        <input
                          type="date"
                          value={confirming.date}
                          max={todayLocal()}
                          onChange={e => setConfirming({ email: h.email, date: e.target.value })}
                          disabled={saving}
                          className="h-8 bg-slate-900 border border-slate-700 rounded px-2 text-white text-xs"
                        />
                      </label>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setConfirming(null)} disabled={saving}
                          className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded py-1.5 font-semibold disabled:opacity-40">
                          Cancel
                        </button>
                        <button type="button" onClick={() => dropOff(h, confirming.date)} disabled={saving || !confirming.date}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded py-1.5 font-semibold disabled:opacity-40">
                          {saving ? 'Saving...' : `Confirm ${money(h.total)}`}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => print(h)}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded py-1.5 font-semibold">
                        <Printer size={13} /> Print Receipt
                      </button>
                      <button type="button" onClick={() => setConfirming({ email: h.email, date: todayLocal() })}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded py-1.5 font-semibold">
                        <Landmark size={13} /> Drop Off Deposit
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
