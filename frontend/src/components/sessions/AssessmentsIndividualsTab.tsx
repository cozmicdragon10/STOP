import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Trash2 } from 'lucide-react';
import {
  closeIndividualSession, deleteOpenIndividualSession, getBipIntake, getClosedIndividualSessions, getOpenIndividualSessions,
  getSessionTypes, saveOpenIndividualSession,
} from '../../api';
import type { BipIntake, ClosedIndividualSession, IndividualCategory, IndividualSessionPayload, OpenIndividualSession, SessionType } from '../../api';
import ClientPicker from '../ClientPicker';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { formatBalance, toDisplayBalance } from '../../utils/balance';

interface TabClient {
  clientid: number;
  firstname: string;
  lastname: string;
  docnumber?: string | null;
  programtype?: string | null;
  accountbalance?: number | string | null;
}

interface Employee {
  employeeemail: string;
  displayname: string;
  role: string;
  active?: boolean;
}

interface Props {
  // True while the tab is showing; the lists and price list reload each time it is shown
  active: boolean;
  clients: TabClient[];
  employees: Employee[];
  user: { employeeemail: string; displayname?: string; role?: string };
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  // Called after a session is closed so balances and Last Attended refresh
  onSaved?: () => void;
}

type PaymentMethod = 'Cash' | 'Credit Card';

interface FormState {
  // Set while an open session is loaded for review and closing
  openSessionId: number | null;
  category: IndividualCategory;
  clientId: string;
  sessionTypeId: string;
  date: string;
  fee: string;
  payment: string;
  paymentMethod: PaymentMethod;
  provider: string;
  // About the assessment or session itself (kept on the attendance row)
  comments: string;
  // About the payment (added to the payment's ledger row)
  paymentComments: string;
}

const CATEGORIES: IndividualCategory[] = ['Assessment', 'Individual'];
// Roles that see every open session; everyone else sees the ones they opened or are the counselor/therapist on
const ADMIN_ROLES = ['Business Administrator', 'Office Admin'];

const money = (n: number) => `$${n.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100) / 100;
const formatDay = (ymd: string) => (ymd === todayLocal() ? 'Today' : new Date(`${ymd}T00:00:00`).toLocaleDateString());

// Assessments and individual sessions: one client per session, saved as open and then closed like a group check-in.
// Closing records the attendance, the fee from the price list, and any payment.
export default function AssessmentsIndividualsTab({ active, clients, employees, user, onSuccess, onError, onSaved }: Props) {
  const isAdmin = user.role === 'Business Administrator';
  const blankForm = useCallback((category: IndividualCategory = 'Assessment'): FormState => ({
    openSessionId: null, category, clientId: '', sessionTypeId: '', date: todayLocal(), fee: '', payment: '',
    paymentMethod: 'Cash', provider: user.displayname || '', comments: '', paymentComments: '',
  }), [user.displayname]);

  const [form, setForm] = useState<FormState>(() => blankForm());
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [sessionTypes, setSessionTypes] = useState<SessionType[]>([]);
  const [panelTab, setPanelTab] = useState<'open' | 'closed'>('open');
  const [openSessions, setOpenSessions] = useState<OpenIndividualSession[]>([]);
  const [closedSessions, setClosedSessions] = useState<ClosedIndividualSession[]>([]);
  const [listError, setListError] = useState('');
  const [expandedClosed, setExpandedClosed] = useState<number | null>(null);
  // Closing a BIP intake or reinstate: payment taken (first), then paperwork completed / contract signed; both are needed to close
  const [paymentChecked, setPaymentChecked] = useState(false);
  const [paperworkChecked, setPaperworkChecked] = useState(false);
  // The client's last BIP intake as of the session date, for pricing a BIP reinstate; key is "clientId|date"
  const [intake, setIntake] = useState<{ key: string; data: BipIntake | null } | null>(null);

  const loadLists = useCallback(async () => {
    try {
      const [open, closed] = await Promise.all([getOpenIndividualSessions(user.employeeemail), getClosedIndividualSessions(user.employeeemail)]);
      setOpenSessions(open);
      setClosedSessions(closed);
      setListError('');
    } catch (err: any) {
      setListError(err.message || 'Failed to load sessions.');
    }
  }, [user.employeeemail]);

  useEffect(() => {
    if (!active) return;
    getSessionTypes().then(setSessionTypes).catch(err => setListError(err.message || 'Failed to load the price list.'));
    // loadLists only sets state after its requests finish
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLists();
  }, [active, loadLists]);

  const set = (patch: Partial<FormState>) => { setForm(f => ({ ...f, ...patch })); setFormError(''); };

  const client = clients.find(c => String(c.clientid) === form.clientId) ?? null;
  const clientIsBip = client?.programtype === 'BIP';
  // Inactive entries stay pickable only when an open session already uses them; BIP-only ones are hidden for other clients
  const typeChoices = sessionTypes.filter(t => t.category === form.category
    && ((t.active && (!client || clientIsBip || !t.biponly)) || String(t.sessiontypeid) === form.sessionTypeId));
  const sessionType = sessionTypes.find(t => String(t.sessiontypeid) === form.sessionTypeId) ?? null;

  // A BIP reinstate is priced by the time since the client's last BIP intake: the price list fee under 6 months,
  // the late fee from 6 months to a year, and not allowed after that (the server applies the same rule)
  const isReinstate = sessionType?.kind === 'BIP Reinstate';
  const intakeKey = isReinstate && form.clientId && form.date ? `${form.clientId}|${form.date}` : '';
  useEffect(() => {
    if (!intakeKey) return;
    let cancelled = false;
    const [id, date] = intakeKey.split('|');
    getBipIntake(Number(id), date)
      .then(data => { if (!cancelled) setIntake({ key: intakeKey, data }); })
      .catch(err => { if (!cancelled) setFormError(err.message || 'Failed to look up the BIP intake.'); });
    return () => { cancelled = true; };
  }, [intakeKey]);
  // null while the lookup for the current client and date is still loading
  const intakeInfo = intake && intake.key === intakeKey ? intake : null;
  const reinstatePrice = !isReinstate || !intakeInfo?.data || intakeInfo.data.needsOurIntake ? null
    : intakeInfo.data.window === 'early' ? Number(sessionType!.fee)
    : intakeInfo.data.window === 'late' ? Number(sessionType!.latefee ?? sessionType!.fee)
    : null;
  const listFee = isReinstate ? reinstatePrice : sessionType ? Number(sessionType.fee) : null;

  // A Business Administrator's fee box follows the reinstate price unless they typed a different amount
  const reinstatePriceKey = reinstatePrice === null || !sessionType ? null : `${sessionType.sessiontypeid}|${sessionType.fee}|${sessionType.latefee}|${reinstatePrice}`;
  const [pricedFor, setPricedFor] = useState<string | null>(null);
  if (reinstatePriceKey !== pricedFor) {
    setPricedFor(reinstatePriceKey);
    if (reinstatePrice !== null && sessionType) {
      const prices = [sessionType.fee, sessionType.latefee].filter(p => p !== null).map(p => Number(p).toFixed(2));
      setForm(f => (f.fee === '' || prices.includes(Number(f.fee).toFixed(2)) ? { ...f, fee: reinstatePrice.toFixed(2) } : f));
    }
  }
  // Counselors and therapists first; the current user is always a choice
  const providers = Array.from(new Set([
    ...employees.filter(e => e.active !== false && e.role !== 'Polygrapher').map(e => e.displayname),
    user.displayname || '', form.provider,
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b));

  // Only Business Administrators change the fee; for everyone else it is the price list's (the server enforces this too)
  const fee = isAdmin ? Number(form.fee) : (listFee ?? 0);
  const payment = Number(form.payment || 0);
  const balanceBefore = Number(client?.accountbalance || 0);
  const balanceAfter = cents(balanceBefore + (Number.isFinite(fee) ? fee : 0) - (Number.isFinite(payment) ? payment : 0));
  const bipIndividual = form.category === 'Individual' && client?.programtype === 'BIP';
  // Assessments are paid in cash only (the server checks too)
  const cashOnly = form.category === 'Assessment';
  const paymentMethod: PaymentMethod = cashOnly ? 'Cash' : form.paymentMethod;
  const commentsLabel = form.category === 'Assessment' ? 'Assessment Comments' : 'Session Comments';

  // A BIP intake or BIP reinstate must be paid in full along with any past due balance (the account can't owe anything
  // after closing), then its second box checked: intake paperwork completed, or the reinstatement contract signed
  const needsChecks = sessionType?.kind === 'BIP Intake' || sessionType?.kind === 'BIP Reinstate';
  const secondCheckLabel = sessionType?.kind === 'BIP Reinstate' ? 'BIP Reinstatement Contract signed' : 'Intake paperwork completed';
  const pastDue = Math.max(0, cents(balanceBefore));
  const amountDue = Math.max(0, cents(balanceBefore + (Number.isFinite(fee) ? fee : 0)));
  const paymentCovers = Number.isFinite(payment) && payment + 0.005 >= amountDue;
  // Lowering the payment below the amount due unchecks both boxes
  const paymentDone = needsChecks && paymentChecked && paymentCovers;
  const paperworkDone = paymentDone && paperworkChecked;
  const resetChecks = () => { setPaymentChecked(false); setPaperworkChecked(false); };

  const problem = (): string | null => {
    if (!client) return 'Choose a client.';
    if (bipIndividual) return 'BIP clients do not have individual sessions.';
    if (!sessionType) return `Choose a${form.category === 'Assessment' ? 'n assessment' : 'n individual session'} type.`;
    if (!form.date) return 'Enter the session date.';
    if (sessionType.biponly && !clientIsBip) return `${sessionType.name} is only for BIP clients.`;
    if (isReinstate) {
      if (!intakeInfo) return 'Still checking the client\'s last BIP intake. Try again in a moment.';
      if (!intakeInfo.data) return `No BIP Intake or DV Assessment on record for this client, so a ${sessionType.name} can't be done. Do a new BIP Intake or DV Assessment instead.`;
      if (intakeInfo.data.needsOurIntake) return `This client was discharged after an intake done at another provider, so a ${sessionType.name} can't be done. Do our BIP Intake or DV Assessment instead.`;
      if (intakeInfo.data.window === 'expired') return `It has been a year or more since the last ${intakeInfo.data.intakename}, so a ${sessionType.name} can't be done. Do a new BIP Intake or DV Assessment instead.`;
    }
    if (!form.provider.trim()) return 'Choose the counselor or therapist.';
    if (isAdmin && (form.fee === '' || !Number.isFinite(fee) || fee < 0)) return 'Enter a fee of $0.00 or more.';
    if (!Number.isFinite(payment) || payment < 0) return 'Enter a payment of $0.00 or more.';
    return null;
  };

  const payload = (): IndividualSessionPayload => ({
    openSessionId: form.openSessionId, client: Number(form.clientId), category: form.category, sessionTypeId: Number(form.sessionTypeId),
    date: form.date, fee: cents(fee), payment: cents(payment), paymentMethod, provider: form.provider.trim(),
    comments: form.comments.trim(), paymentComments: form.paymentComments.trim(), user: user.employeeemail,
    paymentConfirmed: paymentDone, paperworkCompleted: paperworkDone,
  });

  const pickType = (id: string) => {
    const t = sessionTypes.find(s => String(s.sessiontypeid) === id);
    set({ sessionTypeId: id, fee: t ? Number(t.fee).toFixed(2) : '' });
  };

  const run = async (action: () => Promise<void>) => {
    const p = problem();
    if (p) { setFormError(p); return; }
    setSaving(true);
    setFormError('');
    try {
      await action();
    } catch (err: any) {
      // Shown in the form, which keeps what was entered so it can be retried
      setFormError(err.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOpen = () => run(async () => {
    await saveOpenIndividualSession(payload());
    onSuccess(`${form.category} for ${client!.lastname}, ${client!.firstname} saved to Open. Nothing has been charged yet.`);
    setForm(blankForm(form.category));
    setReviewing(false);
    setPanelTab('open');
    loadLists();
  });

  const handleClose = () => run(async () => {
    const res = await closeIndividualSession(payload());
    onSuccess(`${needsChecks ? `${sessionType!.name} completed` : `${form.category} closed`} for ${client!.lastname}, ${client!.firstname}. New balance ${formatBalance(res.newBalance)}.`);
    setForm(blankForm(form.category));
    setReviewing(false);
    resetChecks();
    loadLists();
    onSaved?.();
  });

  const resume = (o: OpenIndividualSession) => {
    setForm({
      openSessionId: o.opensessionid, category: o.category, clientId: String(o.clientid), sessionTypeId: String(o.sessiontypeid),
      date: o.sessiondate, fee: Number(o.fee).toFixed(2), payment: Number(o.payment) > 0 ? Number(o.payment).toFixed(2) : '',
      paymentMethod: o.paymentmethod || 'Cash', provider: o.provider || '', comments: o.comments || '', paymentComments: o.paymentcomments || '',
    });
    setFormError('');
    resetChecks();
    setReviewing(true);
  };

  const discard = async (o: OpenIndividualSession) => {
    if (!window.confirm(`Discard the open ${o.category.toLowerCase()} for ${o.lastname}, ${o.firstname}? Nothing was charged, so nothing is undone.`)) return;
    try {
      await deleteOpenIndividualSession(o.opensessionid, user.employeeemail);
      if (form.openSessionId === o.opensessionid) { setForm(blankForm(form.category)); setReviewing(false); }
      onSuccess(`Open ${o.category.toLowerCase()} for ${o.lastname}, ${o.firstname} discarded.`);
      loadLists();
    } catch (err: any) {
      onError(err.message || 'Failed to discard the session.');
    }
  };

  const label = 'block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5';
  const input = 'w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm';
  const blockMinus = (e: React.KeyboardEvent) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); };

  // Shown on the entry form, and in an intake's review where the payment is taken
  const commentsField = (
    <div>
      <label htmlFor="session-comments" className={label}>{commentsLabel} <span className="normal-case font-normal text-slate-500">(optional)</span></label>
      <textarea id="session-comments" value={form.comments} onChange={e => set({ comments: e.target.value })} rows={3} className={input} placeholder={`About the ${form.category === 'Assessment' ? 'assessment' : 'session'}…`} />
    </div>
  );
  const paymentCommentsField = (
    <div>
      <label htmlFor="payment-comments" className={label}>Payment Comments <span className="normal-case font-normal text-slate-500">(optional)</span></label>
      <textarea id="payment-comments" value={form.paymentComments} onChange={e => set({ paymentComments: e.target.value })} rows={2} className={input} placeholder="e.g. receipt #, who paid…" />
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex justify-between items-center gap-4 mb-6 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Assessments & Individuals</h2>
            <p className="text-xs text-slate-400 mt-0.5">One client per session. Save it as open, then review and close it to record the attendance, fee, and payment.</p>
          </div>
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0">
            {CATEGORIES.map(c => (
              <button
                key={c}
                type="button"
                disabled={reviewing}
                onClick={() => setForm(f => ({ ...blankForm(c), clientId: f.clientId, date: f.date, provider: f.provider }))}
                className={`px-3 py-1.5 rounded text-xs font-semibold disabled:cursor-not-allowed ${form.category === c ? 'bg-blue-600 text-white' : 'text-slate-400 disabled:opacity-40'}`}
              >
                {c === 'Assessment' ? 'Assessment' : 'Individual'}
              </button>
            ))}
          </div>
        </div>

        {!reviewing ? (
          <div className="space-y-5 max-w-xl">
            {form.openSessionId && (
              <p className="text-xs text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">Editing an open session. Save to keep it open, or review to close it.</p>
            )}
            <div>
              <label className={label}>Client</label>
              <ClientPicker clients={clients} value={form.clientId} onChange={id => set({ clientId: id })} className={input} required />
              {client && (
                <p className="text-xs text-slate-500 mt-1.5">
                  {client.programtype || 'No program'} · Balance <span className={toDisplayBalance(client.accountbalance) < 0 ? 'text-red-400' : 'text-emerald-400'}>{formatBalance(client.accountbalance)}</span>
                </p>
              )}
              {bipIndividual && <p className="text-xs text-amber-400 mt-1.5">BIP clients do not have individual sessions.</p>}
            </div>

            <div>
              <label className={label}>{form.category === 'Assessment' ? 'Assessment Type' : 'Session Type'}</label>
              <select value={form.sessionTypeId} onChange={e => pickType(e.target.value)} className={input} required>
                <option value="">Select…</option>
                {typeChoices.map(t => <option key={t.sessiontypeid} value={t.sessiontypeid}>{t.name} ({money(Number(t.fee))}){t.active ? '' : ' (inactive)'}</option>)}
              </select>
              {typeChoices.length === 0 && (
                <p className="text-xs text-slate-500 mt-1.5">No {form.category === 'Assessment' ? 'assessment' : 'individual session'} types on the price list{client && !clientIsBip ? ' for non-BIP clients' : ''}. A Business Administrator can add them in Admin.</p>
              )}
              {sessionType?.biponly && client && !clientIsBip && <p className="text-xs text-amber-400 mt-1.5">{sessionType.name} is only for BIP clients.</p>}
              {isReinstate && client && clientIsBip && (
                !intakeInfo ? <p className="text-xs text-slate-500 mt-1.5">Checking the last BIP intake…</p>
                : !intakeInfo.data ? (
                  <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mt-1.5">No BIP Intake or DV Assessment on record for this client. A reinstate can't be done; do a new BIP Intake or DV Assessment instead.</p>
                ) : intakeInfo.data.needsOurIntake ? (
                  <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mt-1.5">Discharged after an intake done at another provider ({intakeInfo.data.intakename}). A reinstate can't be done; do our BIP Intake or DV Assessment instead.</p>
                ) : intakeInfo.data.window === 'expired' ? (
                  <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mt-1.5">Last {intakeInfo.data.intakename} was {formatDay(intakeInfo.data.intakedate)}, a year or more before this session. A reinstate can't be done; do a new BIP Intake or DV Assessment instead.</p>
                ) : (
                  <p className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-2.5 mt-1.5">
                    Last {intakeInfo.data.intakename}: {formatDay(intakeInfo.data.intakedate)} ({intakeInfo.data.window === 'early' ? 'under 6 months ago' : '6 months to a year ago'}). Reinstate price: <span className="text-white font-semibold">{money(reinstatePrice ?? 0)}</span>
                  </p>
                )
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Session Date</label>
                <input type="date" value={form.date} max={todayLocal()} onChange={e => set({ date: e.target.value })} className={input} required />
              </div>
              <div>
                <label className={label}>Counselor / Therapist</label>
                <select value={form.provider} onChange={e => set({ provider: e.target.value })} className={input} required>
                  <option value="">Select…</option>
                  {providers.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Fee</label>
                {isAdmin ? (
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                    <input type="number" step="0.01" min="0" value={form.fee} onKeyDown={blockMinus} onChange={e => set({ fee: e.target.value.replace(/-/g, '') })} placeholder="0.00" className={`${input} pl-7`} />
                  </div>
                ) : (
                  <p className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300">{listFee !== null ? money(listFee) : '—'}</p>
                )}
                <p className="text-[11px] text-slate-500 mt-1">{isAdmin ? 'From the price list; you can change it for this session.' : 'From the price list.'}</p>
              </div>
              <div>
                <label className={label}>Payment <span className="normal-case font-normal text-slate-500">(optional)</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                  <input type="number" step="0.01" min="0" value={form.payment} onKeyDown={blockMinus} onChange={e => set({ payment: e.target.value.replace(/-/g, '') })} placeholder="0.00" className={`${input} pl-7`} />
                </div>
              </div>
            </div>

            {payment > 0 && (
              <div>
                <label className={label}>Payment Method</label>
                {cashOnly ? (
                  <p className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300">Cash <span className="text-xs text-slate-500">(assessments are cash only)</span></p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {(['Cash', 'Credit Card'] as const).map(m => (
                        <button key={m} type="button" onClick={() => set({ paymentMethod: m })} className={`border rounded-lg py-2.5 text-sm font-semibold transition ${form.paymentMethod === m ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'}`}>{m}</button>
                      ))}
                    </div>
                    {form.paymentMethod === 'Credit Card' && <p className="text-xs text-slate-500 mt-1.5">Card processing is not connected yet, so the card payment is recorded without charging the card.</p>}
                  </>
                )}
              </div>
            )}

            {paymentCommentsField}
            {commentsField}

            {formError && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{formError}</p>}

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              {(form.openSessionId || form.clientId) && (
                <button type="button" disabled={saving} onClick={() => { setForm(blankForm(form.category)); setFormError(''); }} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold px-5 py-2.5 rounded-lg text-sm">Clear</button>
              )}
              <button type="button" disabled={saving} onClick={handleSaveOpen} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-slate-200 font-semibold px-5 py-2.5 rounded-lg text-sm">{saving ? 'Saving...' : 'Save as Open'}</button>
              <button type="button" disabled={saving} onClick={() => { const p = problem(); if (p) setFormError(p); else { resetChecks(); setReviewing(true); } }} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg text-sm">Review & Close</button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 max-w-xl">
            <p className="text-xs text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              Closing records this {form.category.toLowerCase()} as attendance, charges the fee, and records the payment. Check the details before confirming.
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-sm space-y-1.5">
              {[
                ['Client', client ? `${client.lastname}, ${client.firstname}` : ''],
                [form.category === 'Assessment' ? 'Assessment' : 'Session', sessionType?.name ?? ''],
                ['Date', formatDay(form.date)],
                ['Counselor / Therapist', form.provider],
                // An intake's comments are edited below instead
                ...(!needsChecks && form.comments.trim() ? [[commentsLabel, form.comments.trim()]] : []),
                ...(!needsChecks && form.paymentComments.trim() ? [['Payment Comments', form.paymentComments.trim()]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4"><span className="text-slate-400">{k}</span><span className="text-white text-right">{v}</span></div>
              ))}
              <div className="border-t border-slate-800 my-2" />
              <div className="flex justify-between"><span className="text-slate-400">Current balance</span><span className={toDisplayBalance(balanceBefore) < 0 ? 'text-red-400' : 'text-emerald-400'}>{formatBalance(balanceBefore)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Fee</span><span className="text-red-400">-{money(fee)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Payment{payment > 0 ? ` (${paymentMethod})` : ''}</span><span className="text-emerald-400">+{money(payment)}</span></div>
              <div className="flex justify-between border-t border-slate-800 pt-1.5"><span className="font-semibold text-slate-300">Balance after</span><span className={`font-bold ${toDisplayBalance(balanceAfter) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(balanceAfter)}</span></div>
            </div>

            {needsChecks && (
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-4 text-sm">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Amount Due</p>
                  <p className="text-white text-lg font-bold">{money(amountDue)}</p>
                  <p className="text-xs text-slate-500">{sessionType!.name} {money(fee)}{pastDue > 0 ? ` + past due balance ${money(pastDue)}` : ''}{balanceBefore < 0 ? ` − account credit ${money(-balanceBefore)}` : ''}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Payment</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                      <input type="number" step="0.01" min="0" value={form.payment} onKeyDown={blockMinus} onChange={e => set({ payment: e.target.value.replace(/-/g, '') })} placeholder="0.00" className={`${input} pl-7`} />
                    </div>
                    {amountDue > 0 && !paymentCovers && (
                      <button type="button" onClick={() => set({ payment: amountDue.toFixed(2) })} className="text-xs text-blue-400 hover:text-blue-300 mt-1">Enter amount due ({money(amountDue)})</button>
                    )}
                  </div>
                  <div>
                    <label className={label}>Method</label>
                    <p className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300">Cash <span className="text-xs text-slate-500">(cash only)</span></p>
                  </div>
                </div>
                {paymentCommentsField}
                <label className={`flex items-start gap-2.5 ${paymentCovers ? 'text-slate-200 cursor-pointer' : 'text-slate-500 cursor-not-allowed'}`}>
                  <input type="checkbox" checked={paymentDone} disabled={!paymentCovers} onChange={e => { setPaymentChecked(e.target.checked); if (!e.target.checked) setPaperworkChecked(false); }} className="mt-0.5 accent-emerald-500" />
                  <span>
                    Payment received for the {sessionType!.name}{pastDue > 0 ? ' and the past due balance' : ''} ({money(amountDue)})
                    {!paymentCovers && <span className="block text-xs text-amber-400">The payment must cover the full amount due ({money(amountDue)}) before this can be checked.</span>}
                  </span>
                </label>
                <label className={`flex items-start gap-2.5 ${paymentDone ? 'text-slate-200 cursor-pointer' : 'text-slate-500 cursor-not-allowed'}`}>
                  <input type="checkbox" checked={paperworkDone} disabled={!paymentDone} onChange={e => setPaperworkChecked(e.target.checked)} className="mt-0.5 accent-emerald-500" />
                  <span>
                    {secondCheckLabel}
                    {!paymentDone && <span className="block text-xs text-slate-500">Check off the payment first.</span>}
                  </span>
                </label>
                {commentsField}
              </div>
            )}

            {formError && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{formError}</p>}

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button type="button" disabled={saving} onClick={() => { setReviewing(false); setFormError(''); }} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold px-5 py-2.5 rounded-lg text-sm">Back / Edit</button>
              {needsChecks && form.openSessionId && (
                <button type="button" disabled={saving} onClick={handleSaveOpen} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-slate-200 font-semibold px-5 py-2.5 rounded-lg text-sm">Keep Open</button>
              )}
              <button type="button" disabled={saving || (needsChecks && !paperworkDone)} onClick={handleClose} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-lg text-sm">{saving ? 'Closing...' : needsChecks ? 'Complete Assessment' : 'Confirm & Close Session'}</button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="font-semibold text-white flex items-center gap-2"><ClipboardList size={18} className="text-blue-400" /> {panelTab === 'open' ? 'Open Sessions' : 'Closed Sessions'}</h3>
          <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            {(['open', 'closed'] as const).map(t => (
              <button key={t} type="button" onClick={() => setPanelTab(t)} className={`px-3 py-1 rounded text-xs font-semibold transition ${panelTab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                {t === 'open' ? `Open${openSessions.length ? ` (${openSessions.length})` : ''}` : 'Closed'}
              </button>
            ))}
          </div>
        </div>

        {listError ? (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mt-4">{listError}</p>
        ) : panelTab === 'open' ? (
          <>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              {ADMIN_ROLES.includes(user.role || '') ? 'Sessions saved as open.' : 'Sessions you opened or are the counselor/therapist on.'} Open one to review and close it.
            </p>
            {openSessions.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-lg p-4 text-center">No open sessions.</p>
            ) : (
              <ul className="space-y-2">
                {openSessions.map(o => (
                  <li key={o.opensessionid} className={`bg-slate-950 border rounded-lg p-3 ${form.openSessionId === o.opensessionid ? 'border-blue-500/60' : 'border-slate-800'}`}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{o.lastname}, {o.firstname}</p>
                        <p className="text-xs text-slate-300 truncate">{o.category} · {o.sessiontypename}</p>
                        <p className={`text-xs ${o.sessiondate === todayLocal() ? 'text-slate-400' : 'text-amber-400'}`}>{formatDay(o.sessiondate)}{o.provider ? ` · ${o.provider}` : ''}</p>
                        <p className="text-[11px] text-slate-500 truncate">Saved {new Date(o.updatedon).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{o.createdby ? ` by ${o.createdby}` : ''}</p>
                      </div>
                      <button type="button" onClick={() => discard(o)} className="text-slate-500 hover:text-red-400 p-1 rounded shrink-0" aria-label={`Discard open ${o.category.toLowerCase()} for ${o.lastname}, ${o.firstname}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <button type="button" onClick={() => resume(o)} className="mt-2 w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-1.5 rounded-lg">Open & Close Session</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">{user.role === 'Business Administrator' ? 'Recently closed sessions.' : 'Recently closed sessions you opened, closed, or were the counselor/therapist on.'}</p>
            {closedSessions.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-lg p-4 text-center">No closed sessions.</p>
            ) : (
              <ul className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                {closedSessions.map(c => {
                  const expanded = expandedClosed === c.attendanceid;
                  return (
                    <li key={c.attendanceid} className={`bg-slate-950 border rounded-lg ${expanded ? 'border-blue-500/40' : 'border-slate-800'}`}>
                      <button type="button" onClick={() => setExpandedClosed(expanded ? null : c.attendanceid)} aria-expanded={expanded} className="w-full text-left p-3">
                        <p className="text-sm font-semibold text-white truncate">{c.lastname}, {c.firstname}</p>
                        <p className="text-xs text-slate-300 truncate">{c.category}{c.sessiontypename ? ` · ${c.sessiontypename}` : ''}</p>
                        <p className="text-xs text-slate-400">{formatDay(c.sessiondate)}{c.provider ? ` · ${c.provider}` : ''}</p>
                      </button>
                      {expanded && (
                        <div className="border-t border-slate-800 px-3 py-2 text-xs space-y-1">
                          <div className="flex justify-between"><span className="text-slate-400">Fee</span><span className="text-slate-200">{money(Number(c.fee || 0))}</span></div>
                          <div className="flex justify-between"><span className="text-slate-400">Paid</span><span className="text-slate-200">{Number(c.payment) > 0 ? `${money(Number(c.payment))} ${c.paymentmethod || ''}`.trim() : 'No payment'}</span></div>
                          {c.paymentcomments && <p className="text-slate-400 pt-1"><span className="text-slate-500">Payment:</span> {c.paymentcomments}</p>}
                          {c.comments && <p className="text-slate-400 pt-1"><span className="text-slate-500">{c.category === 'Assessment' ? 'Assessment' : 'Session'}:</span> {c.comments}</p>}
                          <p className="text-[11px] text-slate-500 pt-1">
                            Closed{c.closedon ? ` ${new Date(c.closedon).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}{c.closedby ? ` by ${c.closedby}` : ''}
                            {c.openedby && c.openedby !== c.closedby ? ` · Opened by ${c.openedby}` : ''}
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
