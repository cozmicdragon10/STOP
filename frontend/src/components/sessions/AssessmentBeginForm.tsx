import { useEffect, useState } from 'react';
import { CalendarDays, Check, PlayCircle } from 'lucide-react';
import ClientPicker from '../ClientPicker';
import { beginAssessment, getBipIntake, saveOpenIndividualSession } from '../../api';
import type { BipIntake, OpenIndividualSession, SessionType } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { formatBalance, formatBalanceLabeled, toDisplayBalance } from '../../utils/balance';
import { FUNDING_ROLE, FUNDING_SOURCES, amountDueToBegin, type FundingSource } from '../../utils/assessmentWork';

export interface BeginClient {
  clientid: number;
  firstname: string;
  lastname: string;
  docnumber?: string | null;
  doctype?: string | null;
  programtype?: string | null;
  accountbalance?: number | string | null;
  programstatus?: string | null;
  // Max Debt Override in effect: how much the client may owe after the assessment begins
  maxowed?: number | string | null;
}

interface Props {
  clients: BeginClient[];
  sessionTypes: SessionType[];
  // Active counselors who can be the assessment's counselor
  counselors: string[];
  user: { employeeemail: string; displayname?: string; role?: string };
  // The scheduled assessment being begun, or null to begin one on the spot
  open: OpenIndividualSession | null;
  // A new one started from the waiting list
  startClientId?: string;
  startCounselor?: string;
  onBegun: (attendanceId: number, message: string) => void;
  // A scheduled assessment's type and price saved without beginning it
  onSaved: (message: string) => void;
  onCancel: () => void;
}

// Kinds of price list entry that only BIP or SO clients have
const SO_CLIENT_TYPES = ['State SO', 'Federal SO', 'Voluntary SO'];
const money = (n: number) => `$${n.toFixed(2)}`;
const cents = (n: number) => Math.round(n * 100) / 100;
const errorMessage = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const formatDay = (ymd: string) => (ymd === todayLocal() ? 'Today' : new Date(`${ymd}T00:00:00`).toLocaleDateString());

// Beginning an assessment, in two steps: the details (client, assessment type, counselor, and the price, which only a
// Business Administrator can change), then the payment. The fee and any past due balance are paid first; beginning
// charges the fee, records the payment, and starts the assessment today. There is no refund after it is begun.
export default function AssessmentBeginForm({ clients, sessionTypes, counselors, user, open, startClientId, startCounselor, onBegun, onSaved, onCancel }: Props) {
  const isAdmin = user.role === 'Business Administrator';
  const isCounselor = user.role === 'Counselor';
  const [step, setStep] = useState<1 | 2>(1);
  const [clientId, setClientId] = useState(open ? String(open.clientid) : startClientId || '');
  const [sessionTypeId, setSessionTypeId] = useState(open?.sessiontypeid ? String(open.sessiontypeid) : '');
  // A counselor begins a new one as its counselor (the server keeps them to their own)
  const [provider, setProvider] = useState(open?.provider || (isCounselor ? user.displayname || '' : startCounselor || ''));
  const [fee, setFee] = useState(open?.sessiontypeid ? Number(open.fee).toFixed(2) : '');
  const [payment, setPayment] = useState('');
  const [paymentComments, setPaymentComments] = useState('');
  const [firstNote, setFirstNote] = useState('');
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const client = clients.find(c => String(c.clientid) === clientId) ?? null;
  const clientIsBip = client?.programtype === 'BIP';
  const clientIsSo = SO_CLIENT_TYPES.includes(client?.programtype || '');
  // Inactive entries stay pickable only when already chosen; BIP-only and SO-only ones are hidden for other clients
  const typeChoices = sessionTypes.filter(t => t.category === 'Assessment'
    && ((t.active && (!client || ((clientIsBip || !t.biponly) && (clientIsSo || !t.soonly)))) || String(t.sessiontypeid) === sessionTypeId));
  const sessionType = sessionTypes.find(t => String(t.sessiontypeid) === sessionTypeId) ?? null;

  // A BIP reinstate is priced by the time since the client's last BIP intake (the server applies the same rule)
  const isReinstate = sessionType?.kind === 'BIP Reinstate';
  const intakeKey = isReinstate && clientId ? `${clientId}|${todayLocal()}` : '';
  const [intake, setIntake] = useState<{ key: string; data: BipIntake | null } | null>(null);
  useEffect(() => {
    if (!intakeKey) return;
    let cancelled = false;
    const [id, date] = intakeKey.split('|');
    getBipIntake(Number(id), date)
      .then(data => { if (!cancelled) setIntake({ key: intakeKey, data }); })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to look up the BIP intake.'); });
    return () => { cancelled = true; };
  }, [intakeKey]);
  const intakeInfo = intake && intake.key === intakeKey ? intake : null;
  const reinstatePrice = !isReinstate || !intakeInfo?.data || intakeInfo.data.needsOurIntake ? null
    : intakeInfo.data.window === 'early' ? Number(sessionType!.fee)
    : intakeInfo.data.window === 'late' ? Number(sessionType!.latefee ?? sessionType!.fee)
    : null;
  const listFee = isReinstate ? reinstatePrice : sessionType ? Number(sessionType.fee) : null;
  // A Business Administrator's price box follows the reinstate price unless they typed a different amount
  const [pricedFor, setPricedFor] = useState<string | null>(null);
  const reinstateKey = reinstatePrice === null || !sessionType ? null : `${sessionType.sessiontypeid}|${reinstatePrice}`;
  if (reinstateKey !== pricedFor) {
    setPricedFor(reinstateKey);
    if (reinstatePrice !== null && sessionType) {
      const prices = [sessionType.fee, sessionType.latefee].filter(p => p !== null).map(p => Number(p).toFixed(2));
      if (fee === '' || prices.includes(Number(fee).toFixed(2))) setFee(reinstatePrice.toFixed(2));
    }
  }

  // A scheduled assessment keeps the price it was saved with while its type stays the same (the server does the same)
  const scheduledFee = open?.sessiontypeid && String(open.sessiontypeid) === sessionTypeId ? Number(open.fee) : null;
  const shownFee = scheduledFee ?? listFee;
  const feeNum = isAdmin ? Number(fee) : (shownFee ?? 0);
  const paymentNum = Number(payment || 0);
  const balance = Number(client?.accountbalance || 0);
  // Business Administrators can begin on a DHS invoice or voucher: the fee isn't charged, a past due balance still is
  const canFund = user.role === FUNDING_ROLE;
  const [fundedBy, setFundedBy] = useState<FundingSource | null>(null);
  const [fundingNote, setFundingNote] = useState('');
  const charged = fundedBy ? 0 : (Number.isFinite(feeNum) ? feeNum : 0);
  const maxOwed = Number(client?.maxowed) || 0;
  const due = amountDueToBegin(balance, feeNum, fundedBy, maxOwed);
  const covers = Number.isFinite(paymentNum) && paymentNum + 0.005 >= due;
  // Nothing to collect (credit, a DHS invoice or voucher, or a Max Debt Override covers it): no payment box
  const needsPaymentBox = due > 0;
  const confirmed = !needsPaymentBox || (paymentConfirmed && covers);
  const balanceAfter = cents(balance + charged - (Number.isFinite(paymentNum) ? paymentNum : 0));
  // Counselors begin their own assessments; everyone else picks the counselor
  const counselorChoices = isCounselor ? counselors.filter(n => n === user.displayname) : counselors;
  const savedOther = provider && !counselorChoices.includes(provider) ? provider : '';

  const detailsProblem = (): string | null => {
    if (!client) return 'Choose a client.';
    if (!sessionType) return 'Choose the assessment type.';
    if (sessionType.biponly && !clientIsBip) return `${sessionType.name} is only for BIP clients.`;
    if (sessionType.soonly && !clientIsSo) return `${sessionType.name} is only for SO clients.`;
    if (isReinstate) {
      if (!intakeInfo) return 'Still checking the client\'s last BIP intake. Try again in a moment.';
      if (!intakeInfo.data) return `No BIP Intake or DV Assessment on record for this client, so a ${sessionType.name} can't be done.`;
      if (intakeInfo.data.needsOurIntake) return `This client was discharged after an intake done at another provider, so a ${sessionType.name} can't be done. Do our BIP Intake or DV Assessment instead.`;
      if (intakeInfo.data.window === 'expired') return `It has been a year or more since the last ${intakeInfo.data.intakename}, so a ${sessionType.name} can't be done.`;
    }
    if (!provider.trim()) return 'Choose the counselor.';
    if (isAdmin && (fee === '' || !Number.isFinite(feeNum) || feeNum < 0)) return 'Enter a price of $0.00 or more.';
    return null;
  };

  const next = () => {
    const p = detailsProblem();
    if (p) { setError(p); return; }
    setError('');
    setStep(2);
  };

  // Keeps a scheduled assessment scheduled, with the type and price picked
  const saveScheduled = async () => {
    if (!open) return;
    const p = detailsProblem();
    if (p) { setError(p); return; }
    setSaving(true);
    setError('');
    try {
      await saveOpenIndividualSession({
        openSessionId: open.opensessionid, client: Number(clientId), category: 'Assessment', sessionTypeId: Number(sessionTypeId),
        date: open.sessiondate, fee: cents(feeNum), payment: 0, paymentMethod: 'Cash', provider: provider.trim(),
        comments: open.comments || '', paymentComments: '', user: user.employeeemail,
      });
      onSaved(`${sessionType!.name} for ${client!.lastname}, ${client!.firstname} saved. It stays scheduled until it is begun.`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  };

  const begin = async () => {
    const p = detailsProblem();
    if (p) { setError(p); setStep(1); return; }
    if (fundedBy && !fundingNote.trim()) { setError(`Enter a note about the ${fundedBy}.`); return; }
    if (!covers) { setError(`The payment must cover the amount due (${money(due)}).`); return; }
    if (!confirmed) { setError('Check off that the payment was received.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await beginAssessment({
        openSessionId: open?.opensessionid ?? null, client: Number(clientId), sessionTypeId: Number(sessionTypeId), fee: cents(feeNum),
        payment: cents(paymentNum), provider: provider.trim(), comments: firstNote.trim(), paymentComments: paymentComments.trim(),
        paymentConfirmed: confirmed, fundedBy, fundingNote: fundingNote.trim(), user: user.employeeemail,
      });
      onBegun(res.attendanceId, `${sessionType!.name} begun for ${client!.lastname}, ${client!.firstname}${fundedBy ? ` on a ${fundedBy} (not charged to the client)` : ''}. New balance ${formatBalance(res.newBalance)}.`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to begin the assessment.'));
    } finally {
      setSaving(false);
    }
  };

  const label = 'block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5';
  const input = 'w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm';
  const blockMinus = (e: React.KeyboardEvent) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); };
  const stepPill = (n: 1 | 2, text: string) => (
    <span className={`flex items-center gap-1.5 ${step === n ? 'text-white' : step > n ? 'text-emerald-400' : 'text-slate-500'}`}>
      <span className={`w-5 h-5 rounded-full text-[0.6875rem] font-bold flex items-center justify-center ${step === n ? 'bg-blue-600' : step > n ? 'bg-emerald-600' : 'bg-slate-800'}`}>
        {step > n ? <Check size={12} /> : n}
      </span>
      {text}
    </span>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl">
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-3 mb-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Begin Assessment</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {open ? `Scheduled for ${formatDay(open.sessiondate)}${open.provider ? ` with ${open.provider}` : ''}. ` : ''}
            The payment is taken first. The assessment then stays open for the counselor's notes until it is completed.
          </p>
        </div>
        <button type="button" onClick={onCancel} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-950 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-50 shrink-0 self-start">
          <CalendarDays size={14} /> Back to Calendar
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs font-semibold mb-5">
        {stepPill(1, 'Details')}
        <span className="h-px w-8 bg-slate-700" />
        {stepPill(2, 'Payment')}
        <span className="h-px w-8 bg-slate-700" />
        <span className="flex items-center gap-1.5 text-slate-500"><span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center"><PlayCircle size={12} /></span>Begin</span>
      </div>

      {step === 1 ? (
        <div className="space-y-5 max-w-xl">
          <div>
            <label className={label}>Client</label>
            {open ? (
              <p className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-white">{open.lastname}, {open.firstname}</p>
            ) : (
              <ClientPicker clients={clients} value={clientId} onChange={id => { setClientId(id); setError(''); }} className={input} required />
            )}
            {client && (
              <p className="text-xs text-slate-500 mt-1.5">
                {client.programtype || 'No program'} · Balance <span className={toDisplayBalance(client.accountbalance) < 0 ? 'text-red-400' : 'text-emerald-400'}>{formatBalanceLabeled(client.accountbalance)}</span>
              </p>
            )}
          </div>

          <div>
            <label className={label}>Assessment Type</label>
            <select value={sessionTypeId} onChange={e => {
              const t = sessionTypes.find(s => String(s.sessiontypeid) === e.target.value);
              setSessionTypeId(e.target.value);
              setFee(t ? Number(t.fee).toFixed(2) : '');
              setError('');
            }} className={input} required>
              <option value="">Select…</option>
              {typeChoices.map(t => <option key={t.sessiontypeid} value={t.sessiontypeid}>{t.name} ({money(Number(t.fee))}){t.active ? '' : ' (inactive)'}</option>)}
            </select>
            {typeChoices.length === 0 && <p className="text-xs text-slate-500 mt-1.5">No assessment types on the price list{client ? ' for this client' : ''}. A Business Administrator can add them in Admin.</p>}
            {isReinstate && client && clientIsBip && intakeInfo && (
              intakeInfo.data && !intakeInfo.data.needsOurIntake && intakeInfo.data.window !== 'expired' ? (
                <p className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-2.5 mt-1.5">
                  Last {intakeInfo.data.intakename}: {formatDay(intakeInfo.data.intakedate)} ({intakeInfo.data.window === 'early' ? 'under 6 months ago' : '6 months to a year ago'}). Reinstate price: <span className="text-white font-semibold">{money(reinstatePrice ?? 0)}</span>
                </p>
              ) : (
                <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mt-1.5">A reinstate can't be done for this client. Do a new BIP Intake or DV Assessment instead.</p>
              )
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Counselor</label>
              <select value={provider} onChange={e => { setProvider(e.target.value); setError(''); }} disabled={isCounselor} className={`${input} disabled:opacity-80`} required>
                <option value="">Select…</option>
                {savedOther && <option value={savedOther}>{savedOther}</option>}
                {counselorChoices.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Price</label>
              {isAdmin ? (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                  <input type="number" step="0.01" min="0" value={fee} onKeyDown={blockMinus} onChange={e => { setFee(e.target.value.replace(/-/g, '')); setError(''); }} placeholder="0.00" className={`${input} pl-7`} />
                </div>
              ) : (
                <p className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300">{shownFee !== null ? money(shownFee) : '—'}</p>
              )}
              <p className="text-[0.6875rem] text-slate-500 mt-1">
                {isAdmin ? 'From the price list; you can change it for this assessment.'
                  : `${scheduledFee !== null ? 'Set when it was scheduled' : 'From the price list'}. Only a Business Administrator can change it.`}
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="assessment-first-note" className={label}>First Note <span className="normal-case font-normal text-slate-500">(optional)</span></label>
            <textarea id="assessment-first-note" value={firstNote} onChange={e => setFirstNote(e.target.value)} rows={3} className={input} placeholder="Added to the assessment's notes when it begins…" />
          </div>

          {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}

          <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-slate-800">
            {open && (
              <button type="button" disabled={saving} onClick={saveScheduled} title="Keep it scheduled with this type and price" className="bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-slate-200 font-semibold px-5 py-2.5 rounded-lg text-sm">{saving ? 'Saving...' : 'Save, Keep Scheduled'}</button>
            )}
            <button type="button" disabled={saving} onClick={next} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-lg text-sm">Next: Payment</button>
          </div>
        </div>
      ) : (
        <div className="space-y-5 max-w-xl">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-sm space-y-1.5">
            {[
              ['Client', client ? `${client.lastname}, ${client.firstname}` : ''],
              ['Assessment', sessionType?.name ?? ''],
              ['Counselor', provider],
              ['Begins', 'Today'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4"><span className="text-slate-400">{k}</span><span className="text-white text-right">{v}</span></div>
            ))}
            <div className="border-t border-slate-800 my-2" />
            <div className="flex justify-between"><span className="text-slate-400">Current balance</span><span className={toDisplayBalance(balance) < 0 ? 'text-red-400' : 'text-emerald-400'}>{formatBalance(balance)}</span></div>
            {fundedBy ? (
              <div className="flex justify-between gap-4"><span className="text-slate-400">Price ({money(Number.isFinite(feeNum) ? feeNum : 0)})</span><span className="text-sky-300 text-right">Billed to {fundedBy}, not charged</span></div>
            ) : (
              <div className="flex justify-between"><span className="text-slate-400">Price</span><span className="text-red-400">-{money(feeNum)}</span></div>
            )}
            <div className="flex justify-between"><span className="text-slate-400">Payment (Cash)</span><span className="text-emerald-400">+{money(Number.isFinite(paymentNum) ? paymentNum : 0)}</span></div>
            <div className="flex justify-between border-t border-slate-800 pt-1.5"><span className="font-semibold text-slate-300">Balance after</span><span className={`font-bold ${toDisplayBalance(balanceAfter) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(balanceAfter)}</span></div>
          </div>

          {canFund && (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Who Pays for the Assessment</p>
                <p className="text-[0.6875rem] text-slate-500">Business Administrators only. A DHS invoice or voucher begins it without charging the client; any past due balance is still paid.</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([null, ...FUNDING_SOURCES] as (FundingSource | null)[]).map(f => (
                  <button key={f ?? 'client'} type="button" onClick={() => { setFundedBy(f); setPaymentConfirmed(false); setError(''); }}
                    className={`border rounded-lg py-2 text-xs font-semibold transition ${fundedBy === f ? 'border-sky-500 bg-sky-500/10 text-sky-300' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}>
                    {f ?? 'Client Pays'}
                  </button>
                ))}
              </div>
              {fundedBy && (
                <div>
                  <label htmlFor="funding-note" className={label}>{fundedBy} Note <span className="normal-case font-normal text-red-400">(required)</span></label>
                  <textarea id="funding-note" value={fundingNote} maxLength={4000} onChange={e => { setFundingNote(e.target.value); setError(''); }} rows={2} className={input} placeholder={`${fundedBy} number, who approved it…`} />
                  <p className="text-[0.6875rem] text-slate-500 mt-1">Saved as a case note on the client's account.</p>
                </div>
              )}
            </div>
          )}

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-4 text-sm">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Amount Due to Begin</p>
              <p className="text-white text-lg font-bold">{money(due)}</p>
              <p className="text-xs text-slate-500">
                {fundedBy ? `${sessionType?.name} billed to ${fundedBy}` : `${sessionType?.name} ${money(feeNum)}`}
                {balance > 0 ? ` + past due balance ${money(balance)}` : ''}{balance < 0 && !fundedBy ? ` − account credit ${money(-balance)}` : ''}
                {maxOwed > 0 ? ` − Max Debt Override ${money(maxOwed)} (may owe up to this after it begins)` : ''}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="begin-payment" className={label}>Payment</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                  <input id="begin-payment" type="number" step="0.01" min="0" autoFocus value={payment} onKeyDown={blockMinus} onChange={e => { setPayment(e.target.value.replace(/-/g, '')); setError(''); }} placeholder="0.00" className={`${input} pl-7`} />
                </div>
                {due > 0 && !covers && (
                  <button type="button" onClick={() => setPayment(due.toFixed(2))} className="text-xs text-blue-400 hover:text-blue-300 mt-1">Enter amount due ({money(due)})</button>
                )}
              </div>
              <div>
                <label className={label}>Method</label>
                <p className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-300">Cash <span className="text-xs text-slate-500">(cash only)</span></p>
              </div>
            </div>
            <div>
              <label htmlFor="begin-payment-comments" className={label}>Payment Comments <span className="normal-case font-normal text-slate-500">(optional)</span></label>
              <textarea id="begin-payment-comments" value={paymentComments} onChange={e => setPaymentComments(e.target.value)} rows={2} className={input} placeholder="e.g. receipt #, who paid…" />
            </div>
            {needsPaymentBox ? (
              <label className={`flex items-start gap-2.5 ${covers ? 'text-slate-200 cursor-pointer' : 'text-slate-500 cursor-not-allowed'}`}>
                <input type="checkbox" checked={confirmed} disabled={!covers} onChange={e => { setPaymentConfirmed(e.target.checked); setError(''); }} className="mt-0.5 accent-emerald-500" />
                <span>
                  {fundedBy
                    ? <>Payment received toward the past due balance ({money(due)})</>
                    : <>Payment received for the {sessionType?.name}{balance > 0 ? ' and the past due balance' : ''} ({money(due)})</>}
                  {!covers && <span className="block text-xs text-amber-400">The payment must cover the full amount due before this can be checked.</span>}
                </span>
              </label>
            ) : (
              <p className="text-xs text-sky-300">
                Nothing to collect: {fundedBy ? `the ${fundedBy} covers the ${sessionType?.name}` : balance < 0 && balance + feeNum <= 0 ? 'the account credit covers it' : 'it is within the Max Debt Override'}. A payment is optional.
              </p>
            )}
            <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">Once the assessment is begun the payment is not refunded, whatever the results.</p>
          </div>

          {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}

          <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-slate-800">
            <button type="button" disabled={saving} onClick={() => { setStep(1); setError(''); }} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold px-5 py-2.5 rounded-lg text-sm">Back</button>
            <button type="button" disabled={saving || !confirmed} onClick={begin} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-lg text-sm flex items-center gap-1.5">
              <PlayCircle size={16} /> {saving ? 'Beginning...' : 'Begin Assessment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
