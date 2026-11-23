import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, ChevronDown, ChevronRight, History, Landmark, Printer, RefreshCw } from 'lucide-react';
import { getMoneyOnHand, handOffMoney, makeBankDeposit, resolveHandoff } from '../../api';
import type { MoneyHandoff, MoneyItem, MoneyOnHandData } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';
import { errorMessage } from '../../utils/errors';
import {
  HELD_TOO_LONG_DAYS, cashAndChecks, checkText, daysSince, heldForText, holdersOf, isPickable, itemTitle, moneyText,
  pickedOf, sameEmail, shortDate,
} from '../../utils/moneyOnHand';
import { printMoneySlip } from '../../utils/receipt';
import DepositCard from './DepositCard';
import HistoryDialog from './HistoryDialog';

interface Props {
  userEmail: string;
  // Reports > Cash Deposits shows it full width (two columns); Closed Groups > Cash shows it in one narrow column
  wide?: boolean;
}

const inputClass = 'h-9 bg-slate-900 border border-slate-700 rounded px-2 text-white text-xs';
const buttonClass = 'flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40';
const sectionClass = 'bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3';

// Whose money on hand the viewer folded up, remembered in this browser
const COLLAPSED_KEY = 'moneyOnHand.collapsedHolders';
const loadCollapsed = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
    return new Set<string>(Array.isArray(saved) ? saved.map(String) : []);
  } catch {
    return new Set<string>();
  }
};
const saveCollapsed = (s: Set<string>) => {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...s])); } catch { /* not saved; still works this visit */ }
};

// Money on Hand: the cash and checks not at the bank yet and who holds each one now, hand-offs between employees, and
// bank deposits (backend routes/moneyOnHand.js). Pick money to hand it to someone (they accept it before it's theirs)
// or to record a bank deposit. Business Administrators see everyone's and check deposits against the bank.
export default function MoneyOnHand({ userEmail, wide = false }: Props) {
  const employeeLabel = useEmployeeLabel();
  const [data, setData] = useState<MoneyOnHandData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [action, setAction] = useState<null | 'handoff' | 'deposit'>(null);
  const [handTo, setHandTo] = useState('');
  const [handNote, setHandNote] = useState('');
  const [depositDate, setDepositDate] = useState(todayLocal);
  const [slipNumber, setSlipNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  // Holders (lower-case email) whose list is folded up, and group sessions showing who paid
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [openPayers, setOpenPayers] = useState<Set<string>>(() => new Set());
  const flip = (s: Set<string>, key: string) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };
  const toggleHolder = (email: string) => setCollapsed(prev => {
    const next = flip(prev, email.trim().toLowerCase());
    saveCollapsed(next);
    return next;
  });

  const load = useCallback(async () => {
    try {
      const next = await getMoneyOnHand();
      setData(next);
      setLoadError('');
      // Keep only picks that can still be picked
      setPicked(prev => new Set(next.items.filter(i => prev.has(i.itemkey) && isPickable(i)).map(i => i.itemkey)));
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load the money on hand.'));
    }
  }, []);

  useEffect(() => {
    // load only sets state after its request finishes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Someone may hand you money or accept yours while this is open
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const isAdmin = !!data?.isAdmin;
  const items = useMemo(() => data?.items ?? [], [data]);
  const holders = useMemo(() => holdersOf(items, userEmail), [items, userEmail]);
  const pickedItems = items.filter(i => picked.has(i.itemkey));
  const pickedMoney = cashAndChecks(pickedItems);
  const pickedHolders = [...new Set(pickedItems.map(i => i.holder.toLowerCase()))];
  const handoffs = data?.handoffs ?? [];
  const pending = handoffs.filter(h => h.status === 'Pending');
  const incoming = pending.filter(h => sameEmail(h.toemployee, userEmail));
  const outgoing = pending.filter(h => !sameEmail(h.toemployee, userEmail));
  const recent = handoffs.filter(h => h.status !== 'Pending');
  const deposits = data?.deposits ?? [];
  const waitingDeposits = deposits.filter(d => !d.verifiedon && !d.voidedon);
  const onHandTotal = cashAndChecks(items).total;
  const openTotal = (data?.open ?? []).reduce((t, o) => t + Math.round(o.amount * 100), 0) / 100;
  const incomingTotal = incoming.reduce((t, h) => t + Math.round(Number(h.total) * 100), 0) / 100;

  const say = (ok: boolean, text: string) => setNotice({ ok, text });
  const toggle = (i: MoneyItem) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(i.itemkey)) next.delete(i.itemkey); else next.add(i.itemkey);
    return next;
  });
  const pickAll = (list: MoneyItem[], on: boolean) => setPicked(prev => {
    const next = new Set(prev);
    for (const i of list.filter(isPickable)) if (on) next.add(i.itemkey); else next.delete(i.itemkey);
    return next;
  });
  const clearPicks = () => { setPicked(new Set()); setAction(null); };

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      say(true, await work());
    } catch (err) {
      say(false, errorMessage(err, 'Failed to save.'));
    } finally {
      setBusy(false);
      load();
    }
  };

  const recipient = data?.recipients.find(r => r.employeeemail === handTo);
  const slipItems = pickedItems.map(i => ({ title: itemTitle(i), amount: Number(i.amount) }));

  const submitHandoff = () => run(async () => {
    const r = await handOffMoney({ to: handTo, notes: handNote, items: pickedOf(pickedItems) });
    clearPicks();
    setHandNote('');
    return `${moneyText(r.total)} is waiting for ${recipient?.displayname || handTo} to accept. It stays yours until they do.`;
  });
  const submitDeposit = () => run(async () => {
    const r = await makeBankDeposit({ depositDate, slipNumber, items: pickedOf(pickedItems) });
    clearPicks();
    setSlipNumber('');
    return `Bank deposit of ${moneyText(r.total)} recorded${slipNumber.trim() ? ` (slip ${slipNumber.trim()})` : ''}.`;
  });
  const resolve = (h: MoneyHandoff, act: 'accept' | 'decline' | 'cancel') => {
    if (act !== 'accept' && !window.confirm(act === 'decline'
      ? `Decline ${moneyText(h.total)} from ${h.fromname}? It stays with them.`
      : `Cancel handing ${moneyText(h.total)} to ${h.toname}?`)) return;
    run(async () => {
      await resolveHandoff(h.handoffid, act);
      return act === 'accept' ? `You accepted ${moneyText(h.total)} from ${h.fromname}. It's on your money on hand now.`
        : act === 'decline' ? `Declined; the ${moneyText(h.total)} stays with ${h.fromname}.`
          : `Hand-off cancelled; the ${moneyText(h.total)} stays with ${h.fromname}.`;
    });
  };

  if (loadError && !data) return <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{loadError}</p>;
  if (!data) return <div className="animate-pulse h-24 rounded-lg bg-slate-800/60" aria-label="Loading money on hand" />;

  const tiles = [
    { label: isAdmin ? 'On hand, everyone' : 'You are holding', value: moneyText(onHandTotal), tone: onHandTotal > 0 ? 'text-amber-400' : 'text-white' },
    { label: 'Waiting for you to accept', value: moneyText(incomingTotal), tone: incoming.length ? 'text-amber-300' : 'text-white' },
    { label: 'At groups still open', value: moneyText(openTotal), tone: 'text-slate-200' },
    { label: 'Deposits not checked with bank', value: String(waitingDeposits.length), tone: waitingDeposits.length ? 'text-sky-300' : 'text-white' },
  ];

  const handoffCard = (h: MoneyHandoff, mine: 'in' | 'out' | 'done') => (
    <li key={h.handoffid} className={`bg-slate-950 border rounded-lg p-3 text-xs space-y-2 ${mine === 'in' ? 'border-amber-500/40' : 'border-slate-800'}`}>
      <div className="flex justify-between gap-2">
        <span className="text-slate-200">
          {mine === 'in' ? <><b className="text-white">{h.fromname}</b> is handing you</>
            : <><b className="text-white">{h.fromname}</b> → <b className="text-white">{h.toname}</b></>}
          <span className="block text-slate-500">{new Date(mine === 'done' ? h.resolvedon || h.createdon : h.createdon).toLocaleString()}
            {mine === 'done' && ` · ${h.status.toLowerCase()}`}
            {!sameEmail(h.createdby, h.fromemployee) && ` · entered by ${h.createdbyname}`}</span>
        </span>
        <span className="text-sm font-bold text-amber-300 shrink-0">{moneyText(h.total)}</span>
      </div>
      {h.notes && <p className="text-slate-300">“{h.notes}”</p>}
      {mine !== 'done' && (
        <ul className="divide-y divide-slate-800 border-y border-slate-800">
          {(h.items || []).map(i => (
            <li key={i.key} className="flex justify-between gap-2 py-1">
              <button type="button" onClick={() => setHistoryKey(i.key)} className="text-left text-slate-300 hover:text-white">{i.label}</button>
              <span className="text-slate-400 shrink-0">{moneyText(i.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {mine === 'in' && (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => resolve(h, 'accept')} className={`${buttonClass} flex-1 bg-emerald-600 hover:bg-emerald-500 text-white`}>I have it, accept</button>
          <button type="button" disabled={busy} onClick={() => resolve(h, 'decline')} className={`${buttonClass} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700`}>Decline</button>
        </div>
      )}
      {mine === 'out' && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-amber-300">Waiting for {h.toname} to accept</span>
          {(isAdmin || sameEmail(h.fromemployee, userEmail) || sameEmail(h.createdby, userEmail)) && (
            <button type="button" disabled={busy} onClick={() => resolve(h, 'cancel')} className={`${buttonClass} bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700`}>Cancel</button>
          )}
        </div>
      )}
    </li>
  );

  const itemRow = (i: MoneyItem) => {
    const days = daysSince(i.heldsince);
    const old = days !== null && days > HELD_TOO_LONG_DAYS;
    const pickable = isPickable(i);
    const cash = cashAndChecks([i]).cash;
    const payers = i.kind === 'group' ? i.payers ?? [] : [];
    const showPayers = openPayers.has(i.itemkey);
    return (
      <li key={i.itemkey} className="flex items-start gap-2 py-2">
        <input type="checkbox" checked={picked.has(i.itemkey)} disabled={!pickable || busy} onChange={() => toggle(i)}
          aria-label={`Pick ${itemTitle(i)}`} title={pickable ? 'Pick to hand off or deposit' : 'Waiting on a hand-off'}
          className="mt-0.5 h-4 w-4 rounded accent-blue-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40" />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between gap-2">
            <span className="text-slate-100 truncate">{itemTitle(i)}</span>
            <span className="text-white font-semibold shrink-0">{moneyText(i.amount)}</span>
          </div>
          <div className="text-slate-500 flex flex-wrap gap-x-2">
            {cash > 0 && <span>Cash {moneyText(cash)}</span>}
            {i.checks.map((c, n) => <span key={n}>{checkText(c)} {moneyText(c.amount)}</span>)}
            {!sameEmail(i.collector, i.holder) && <span>· collected by {i.collectorname}</span>}
            {days !== null && <span className={old ? 'text-amber-400' : ''}>· held {heldForText(days)}</span>}
            <button type="button" onClick={() => setHistoryKey(i.itemkey)} className="inline-flex items-center gap-0.5 text-blue-400 hover:text-blue-300">
              <History size={11} /> history
            </button>
          </div>
          {payers.length > 0 && (
            <button type="button" onClick={() => setOpenPayers(prev => flip(prev, i.itemkey))} aria-expanded={showPayers}
              className="inline-flex items-center gap-0.5 mt-0.5 text-blue-400 hover:text-blue-300">
              {showPayers ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {payers.length} {payers.length === 1 ? 'client' : 'clients'} paid
            </button>
          )}
          {showPayers && (
            <ul className="mt-1 ml-1 pl-2 border-l border-slate-700 space-y-0.5">
              {payers.map((p, n) => (
                <li key={n} className="flex justify-between gap-2">
                  <span className="text-slate-300 truncate">
                    {p.client}
                    <span className="text-slate-500"> · {p.method === 'Other' ? checkText(p) : (p.method || 'Cash')}</span>
                  </span>
                  <span className="text-slate-300 shrink-0">{moneyText(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {i.pendinghandoffid && (
            <span className="inline-block mt-1 text-amber-300">
              Waiting for {handoffs.find(h => h.handoffid === i.pendinghandoffid)?.toname || employeeLabel(i.pendingto)} to accept
            </span>
          )}
        </div>
      </li>
    );
  };

  const actionPanel = pickedItems.length > 0 && (
    <div className="sticky bottom-0 bg-slate-900 border border-blue-500/40 rounded-xl p-3 space-y-3 shadow-2xl text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-slate-200">
          <b className="text-white">{pickedItems.length}</b> picked · <b className="text-white">{moneyText(pickedMoney.total)}</b>
          <span className="text-slate-400"> (cash {moneyText(pickedMoney.cash)}{pickedMoney.checks.length ? `, ${pickedMoney.checks.length} check${pickedMoney.checks.length === 1 ? '' : 's'} ${moneyText(pickedMoney.checkTotal)}` : ''})</span>
        </span>
        <div className="flex gap-2">
          <button type="button" disabled={busy || pickedHolders.length > 1} onClick={() => setAction(action === 'handoff' ? null : 'handoff')}
            title={pickedHolders.length > 1 ? 'A hand-off can only include one person\'s money' : 'Give this money to someone else'}
            className={`${buttonClass} ${action === 'handoff' ? 'bg-amber-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'}`}>
            <ArrowRightLeft size={13} /> Hand off
          </button>
          <button type="button" disabled={busy} onClick={() => setAction(action === 'deposit' ? null : 'deposit')}
            className={`${buttonClass} ${action === 'deposit' ? 'bg-emerald-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700'}`}>
            <Landmark size={13} /> Bank deposit
          </button>
          <button type="button" disabled={busy} onClick={clearPicks} className={`${buttonClass} text-slate-400 hover:text-white`}>Clear</button>
        </div>
      </div>

      {action === 'handoff' && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <p className="text-slate-400">The money stays {isAdmin && !sameEmail(pickedItems[0].holder, userEmail) ? `with ${pickedItems[0].holdername}` : 'yours'} until the person you hand it to accepts it in the app.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-slate-400 flex-1 min-w-[10rem]">Hand to
              <select value={handTo} onChange={e => setHandTo(e.target.value)} className={`block mt-1 w-full ${inputClass}`}>
                <option value="">Pick someone…</option>
                {data.recipients.filter(r => !sameEmail(r.employeeemail, pickedItems[0].holder)).map(r => (
                  <option key={r.employeeemail} value={r.employeeemail}>{r.displayname || r.employeeemail}{r.role ? ` (${r.role})` : ''}</option>
                ))}
              </select>
            </label>
            <label className="text-slate-400 flex-[2] min-w-[12rem]">Note (optional)
              <input value={handNote} onChange={e => setHandNote(e.target.value)} maxLength={500} placeholder="e.g. left in the front desk safe" className={`block mt-1 w-full ${inputClass}`} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={!handTo}
              onClick={() => printMoneySlip({ title: 'Cash Hand-Off', from: pickedItems[0].holdername, to: recipient?.displayname || handTo, date: todayLocal(), items: slipItems, cash: pickedMoney.cash, checks: pickedMoney.checks }, m => say(false, m))}
              className={`${buttonClass} bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700`}><Printer size={13} /> Print slip</button>
            <button type="button" disabled={busy || !handTo} onClick={submitHandoff} className={`${buttonClass} flex-1 bg-amber-600 hover:bg-amber-500 text-white`}>
              {busy ? 'Saving…' : `Hand ${moneyText(pickedMoney.total)} to ${recipient?.displayname || '…'}`}
            </button>
          </div>
        </div>
      )}

      {action === 'deposit' && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          {pickedHolders.length > 1 || !pickedItems.every(i => sameEmail(i.holder, userEmail))
            ? <p className="text-amber-300">Includes money held by {[...new Set(pickedItems.map(i => i.holdername))].join(', ')}. The deposit will say you dropped it off.</p>
            : <p className="text-slate-400">Print the slip to go with the bag, then record the deposit once it's dropped off.</p>}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-slate-400">Date dropped off
              <input type="date" value={depositDate} max={todayLocal()} onChange={e => setDepositDate(e.target.value)} className={`block mt-1 ${inputClass}`} />
            </label>
            <label className="text-slate-400 flex-1 min-w-[10rem]">Deposit slip # (optional)
              <input value={slipNumber} onChange={e => setSlipNumber(e.target.value)} maxLength={100} className={`block mt-1 w-full ${inputClass}`} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button"
              onClick={() => printMoneySlip({ title: 'Bank Deposit', from: employeeLabel(userEmail), date: depositDate, slipNumber, items: slipItems, cash: pickedMoney.cash, checks: pickedMoney.checks }, m => say(false, m))}
              className={`${buttonClass} bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700`}><Printer size={13} /> Print deposit slip</button>
            <button type="button" disabled={busy || !depositDate} onClick={submitDeposit} className={`${buttonClass} flex-1 bg-emerald-600 hover:bg-emerald-500 text-white`}>
              {busy ? 'Saving…' : `Record ${moneyText(pickedMoney.total)} deposit`}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-400 leading-relaxed">
          Cash, checks, money orders and cashier's checks that haven't gone to the bank{isAdmin ? ', by who has them right now' : ' that you have right now'}.
          Pick money to hand it to someone (it's theirs once they accept) or to record a bank deposit.
        </p>
        <button type="button" onClick={() => load()} title="Refresh" aria-label="Refresh" className="text-slate-400 hover:text-white shrink-0"><RefreshCw size={15} /></button>
      </div>

      {notice && (
        <p role="status" className={`text-xs rounded-lg p-3 border flex justify-between gap-2 ${notice.ok ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-red-300 bg-red-500/10 border-red-500/30'}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">×</button>
        </p>
      )}
      {loadError && <p className="text-xs text-red-400">{loadError}</p>}

      <div className={`grid gap-3 text-center ${wide ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2'}`}>
        {tiles.map(t => (
          <div key={t.label} className="bg-slate-950 p-3 rounded-xl border border-slate-800">
            <p className="text-[11px] text-slate-400">{t.label}</p>
            <p className={`text-lg font-bold mt-0.5 ${t.tone}`}>{t.value}</p>
          </div>
        ))}
      </div>

      {incoming.length > 0 && (
        <section className={`${sectionClass} border-amber-500/40`}>
          <h4 className="text-sm font-semibold text-amber-300">Waiting for you to accept</h4>
          <p className="text-xs text-slate-400">Accept once the money is in your hands. Until then it stays with the person handing it to you.</p>
          <ul className="space-y-2">{incoming.map(h => handoffCard(h, 'in'))}</ul>
        </section>
      )}

      <div className={wide ? 'grid lg:grid-cols-2 gap-4 items-start' : 'space-y-4'}>
        <div className="space-y-4 min-w-0">
          <section className={sectionClass}>
            <h4 className="text-sm font-semibold text-white">On hand</h4>
            {holders.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-lg p-4 text-center">
                {isAdmin ? 'Nobody is holding money that needs to go to the bank.' : 'You aren\'t holding any money that needs to go to the bank.'}
              </p>
            ) : (
              <ul className="space-y-3">
                {holders.map(h => {
                  const pickable = h.items.filter(isPickable);
                  const allPicked = pickable.length > 0 && pickable.every(i => picked.has(i.itemkey));
                  const folded = collapsed.has(h.email.trim().toLowerCase());
                  const pickedHere = h.items.filter(i => picked.has(i.itemkey)).length;
                  return (
                    <li key={h.email} className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
                      <button type="button" onClick={() => toggleHolder(h.email)} aria-expanded={!folded}
                        title={folded ? 'Show this money' : 'Hide this money'}
                        className="w-full flex items-baseline justify-between gap-2 text-left">
                        <span className="flex items-center gap-1 min-w-0 text-sm font-semibold text-white">
                          {folded ? <ChevronRight size={15} className="shrink-0 self-center text-slate-400" /> : <ChevronDown size={15} className="shrink-0 self-center text-slate-400" />}
                          <span className="truncate">{sameEmail(h.email, userEmail) ? `${h.name} (you)` : h.name}</span>
                        </span>
                        <span className="text-base font-bold text-amber-400 shrink-0">{moneyText(h.total)}</span>
                      </button>
                      {folded ? (
                        <p className="text-slate-500 mt-0.5 ml-5">
                          {h.items.length} {h.items.length === 1 ? 'item' : 'items'}{pickedHere > 0 && <span className="text-blue-400"> · {pickedHere} picked</span>}
                        </p>
                      ) : (
                        <>
                          {pickable.length > 0 && (
                            <button type="button" onClick={() => pickAll(h.items, !allPicked)} disabled={busy} className="text-blue-400 hover:text-blue-300 mt-0.5 ml-5">
                              {allPicked ? 'Unpick all' : 'Pick all'}
                            </button>
                          )}
                          <ul className="divide-y divide-slate-800 border-t border-slate-800 mt-2">{h.items.map(itemRow)}</ul>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {actionPanel}
          </section>

          {outgoing.length > 0 && (
            <section className={sectionClass}>
              <h4 className="text-sm font-semibold text-white">Hand-offs waiting</h4>
              <ul className="space-y-2">{outgoing.map(h => handoffCard(h, 'out'))}</ul>
            </section>
          )}

          {data.open.length > 0 && (
            <section className={sectionClass}>
              <h4 className="text-sm font-semibold text-white">At groups still open</h4>
              <p className="text-xs text-slate-400">Counted here once the group closes. Until then the amounts can still change.</p>
              <ul className="divide-y divide-slate-800 text-xs">
                {data.open.map(o => (
                  <li key={`${o.groupid}-${o.sessiondate}-${o.sessionnumber}`} className="flex justify-between gap-2 py-1.5">
                    <span className="text-slate-200 min-w-0">
                      {o.groupname} · {shortDate(o.sessiondate)}{o.sessionnumber > 1 ? ` · Session ${o.sessionnumber}` : ''}
                      {isAdmin && <span className="block text-slate-500">{o.responsiblename || o.responsible}</span>}
                    </span>
                    <span className="text-slate-300 shrink-0">{moneyText(o.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          <section className={sectionClass}>
            <h4 className="text-sm font-semibold text-white">Bank deposits</h4>
            <p className="text-xs text-slate-400">
              {isAdmin ? 'Check each deposit against the bank statement. ' : ''}Shows deposits not checked with the bank yet, and the last 60 days.
            </p>
            {deposits.length === 0
              ? <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-lg p-4 text-center">No bank deposits yet.</p>
              : (
                <ul className="space-y-2">
                  {deposits.map(d => (
                    <DepositCard key={d.bankdepositid} deposit={d} userEmail={userEmail} isAdmin={isAdmin}
                      onChanged={m => { say(true, m); load(); }} onError={m => say(false, m)} />
                  ))}
                </ul>
              )}
          </section>

          {recent.length > 0 && (
            <section className={sectionClass}>
              <h4 className="text-sm font-semibold text-white">Recent hand-offs</h4>
              <ul className="space-y-2">{recent.map(h => handoffCard(h, 'done'))}</ul>
            </section>
          )}
        </div>
      </div>

      {historyKey && <HistoryDialog itemKey={historyKey} onClose={() => setHistoryKey(null)} />}
    </div>
  );
}
