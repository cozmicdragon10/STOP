import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ClientRecord, PaymentMethod } from '../../hooks/useGroupCheckIn';
import { submitAccountPayment } from '../../api';
import { balanceColor, formatBalance } from '../../utils/balance';
import { printReceipt, type Receipt } from '../../utils/receipt';
import { takesPolygraphs } from '../../utils/polygraph';
import { cardBlocked, cardBlockedText } from '../../utils/cardBlock';
import CardPaymentFields from './CardPaymentFields';
import OtherPaymentFields from './OtherPaymentFields';
import { PAYMENT_METHODS, paymentMethodProblem, paymentMethodText } from '../../utils/paymentMethods';
import { useUserRole } from '../../hooks/useUserRole';
import { emptyCardBilling, type CardBilling } from './cardBilling';
import { FEDERAL_PROGRAM_TYPES, idText } from '../../utils/clients';
import ScrollLock from '../ScrollLock';

interface Props {
  client: ClientRecord;
  // Account balance as shown on the review screen (stored sign: positive = owes)
  balance: number;
  // What the check-in did for this client; recorded when the group closes. Omitted outside a group check-in.
  checkIn?: { fee: number; payment: number; paymentMethod: PaymentMethod; paymentSubtype?: string | null; paymentReference?: string | null; cardPaid: number };
  // Start of the ledger comment when no notes are entered, e.g. "Payment after group"
  noteLabel?: string;
  // Optional starting values and an explanation shown at the top, e.g. when a payment is needed to schedule a polygraph
  initialAmount?: number;
  initialApplyToPolyFee?: boolean;
  // Keeps the "Apply to poly fee" choice at initialApplyToPolyFee, e.g. for a payment taken to schedule a polygraph
  lockApplyToPolyFee?: boolean;
  notice?: string;
  // Offers Split Payment: the payment is taken in parts by different methods (e.g. half card, half cash), each saved as
  // its own payment on the account with its own receipt
  allowSplit?: boolean;
  createdBy: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  // polyFeePaid and polyFeeVoucher are the client's poly fee figures after this payment (called once for each part)
  onProcessed: (newBalance: number, polyFeePaid: number, polyFeeVoucher: number) => void;
}

// One payment, or one part of a split payment. receipt is set once it is saved, which locks it.
interface Part {
  amount: string;
  method: PaymentMethod;
  // Other payments: the kind (Check, DHS, ...) and an optional reference #
  subtype: string;
  reference: string;
  card: CardBilling;
  receipt: Receipt | null;
}

const inputClass = 'w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm';
const NO_CHECK_IN = { fee: 0, payment: 0, paymentMethod: 'Cash' as PaymentMethod, cardPaid: 0 };
const newPart = (method: PaymentMethod, amount = ''): Part => ({ amount, method, subtype: '', reference: '', card: emptyCardBilling, receipt: null });
const partAmount = (p: Part) => (p.amount.trim() === '' ? 0 : Number(p.amount));
const partAmountValid = (p: Part) => Number.isFinite(partAmount(p)) && partAmount(p) > 0;
// "Cash", "Credit Card", or "Check #1042"
const partMethodText = (p: Part) => paymentMethodText(p.method, p.subtype, p.reference);

// Payment on a client's account: after group (before the group is closed) or from the client account view.
// Same payment rules as the Account-Only screen.
export default function ClientPaymentDialog({ client, balance, checkIn = NO_CHECK_IN, noteLabel = 'Payment after group', initialAmount, initialApplyToPolyFee = false, lockApplyToPolyFee = false, notice, allowSplit = false, createdBy, onClose, onSuccess, onError, onProcessed }: Props) {
  const [parts, setParts] = useState<Part[]>(() => [newPart('Cash', initialAmount ? initialAmount.toFixed(2) : '')]);
  const role = useUserRole();
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [applyToPolyFee, setApplyToPolyFee] = useState(initialApplyToPolyFee);

  const split = parts.length > 1;
  const updatePart = (i: number, patch: Partial<Part>) => setParts(prev => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const receipts = parts.flatMap(p => (p.receipt ? [p.receipt] : []));
  const lastReceipt = receipts.length ? receipts[receipts.length - 1] : null;
  const pending = parts.filter(p => !p.receipt);
  const allProcessed = pending.length === 0;
  const anyProcessed = receipts.length > 0;
  // Each part still to save needs an amount over $0.00 and a method this role may record
  const partProblem = (p: Part): string | null => {
    if (!partAmountValid(p)) return split ? `Enter an amount greater than $0.00 for the ${partMethodText(p) || p.method} part.` : 'Enter a payment amount greater than $0.00.';
    return paymentMethodProblem(p.method, p.subtype, role);
  };
  const problem = pending.map(partProblem).find(Boolean) ?? null;

  // Poly fee option is offered only when the client record carries poly fee figures; BIP, Fed Drug Test and Chaperon clients
  // don't take polygraphs, and federal clients pay a Polygraph Copay on the account instead of a poly fee
  const hasPolyFee = client.polyfee != null && takesPolygraphs(client.programtype) && !FEDERAL_PROGRAM_TYPES.includes(client.programtype || '');
  const polyFee = Number(client.polyfee ?? 0);
  const polyPaid = lastReceipt?.polyFeePaid ?? Number(client.polyfeepaid ?? 0);
  const polyOwed = Math.max(0, polyFee - polyPaid);

  // Stored sign: positive = owes. After a processed payment the balance starts from the saved figure.
  const baseBalance = lastReceipt ? lastReceipt.newBalance : balance;
  const processedTotal = receipts.reduce((sum, r) => sum + r.amount, 0);
  const pendingTotal = pending.reduce((sum, p) => sum + (partAmountValid(p) ? partAmount(p) : 0), 0);
  const paymentShown = processedTotal + pendingTotal;
  // Mirrors the server: the poly fee is paid down first, the excess goes to the account
  const pendingPoly = applyToPolyFee ? Math.min(pendingTotal, polyOwed) : 0;
  const polyShown = receipts.reduce((sum, r) => sum + (r.polyApplied ?? 0), 0) + pendingPoly;
  const accountShown = paymentShown - polyShown;
  // The group's fee and cash payment are not saved until the group closes, so they are shown as pending
  const hasPending = checkIn.fee > 0 || checkIn.payment > 0;
  const balanceAfterClose = baseBalance - (pendingTotal - pendingPoly) + checkIn.fee - checkIn.payment;

  // Turns the payment into two parts: the second part starts with a different method (card, or cash after a card)
  const startSplit = () => {
    const first = parts[0];
    const second: PaymentMethod = first.method === 'Credit Card' || cardBlocked(client) ? 'Cash' : 'Credit Card';
    setParts([first, newPart(second)]);
  };
  const addPart = () => setParts(prev => [...prev, newPart('Cash')]);
  const removePart = (i: number) => setParts(prev => prev.filter((_, j) => j !== i));

  // Saves each part not yet saved, in order. A part that fails stops the rest; the saved parts stay saved and locked, so
  // pressing Process Payment again picks up where it stopped.
  const processPayment = async () => {
    if (problem) {
      onError(problem);
      return;
    }
    setProcessing(true);
    let savedNow = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.receipt) continue;
      const amount = partAmount(p);
      const methodText = partMethodText(p);
      const subtype = p.method === 'Other' ? p.subtype : null;
      const reference = p.method === 'Other' ? p.reference.trim() || null : null;
      try {
        const res = await submitAccountPayment({
          client: client.clientid,
          amount,
          comments: notes.trim() || `${noteLabel} (${methodText}${split ? `, part ${i + 1} of ${parts.length} of a split payment` : ''}).`,
          createdBy,
          paymentMethod: p.method,
          paymentSubtype: subtype,
          paymentReference: reference,
          applyToPolyFee,
        });
        const newPolyPaid = Number(res.polyFeePaid);
        updatePart(i, {
          receipt: {
            clientName: `${client.lastname}, ${client.firstname}`,
            docNumber: idText(client),
            amount,
            method: p.method,
            paymentSubtype: subtype,
            paymentReference: reference,
            newBalance: Number(res.newBalance),
            transactionIds: res.transactionIds,
            processedBy: createdBy,
            date: new Date().toLocaleString(),
            polyApplied: Number(res.polyApplied),
            polyFeePaid: newPolyPaid,
            polyFee,
          },
        });
        onSuccess(`$${amount.toFixed(2)} ${methodText} payment recorded for ${client.firstname} ${client.lastname}.`);
        onProcessed(Number(res.newBalance), newPolyPaid, Number(res.polyFeeVoucher ?? client.polyfeevoucher ?? 0));
      } catch (err: unknown) {
        const reason = err instanceof Error && err.message ? err.message : 'Payment could not be processed.';
        onError(split && (anyProcessed || savedNow) ? `${reason} The parts already processed are saved; fix this part and press Process Payment again.` : reason);
        break;
      }
      savedNow = true;
    }
    setProcessing(false);
  };

  const renderPart = (p: Part, i: number) => {
    const locked = p.receipt !== null || processing;
    return (
      <div key={i} className={split ? 'border border-slate-800 rounded-lg p-3 space-y-3' : 'space-y-5'}>
        {split && (
          <div className="flex justify-between items-center gap-2">
            <p className="text-xs font-semibold text-slate-300">Part {i + 1}</p>
            {p.receipt ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-emerald-400">Processed</span>
                <button type="button" onClick={() => printReceipt(p.receipt as Receipt, onError)} className="text-xs text-blue-400 hover:text-blue-300 font-semibold">Print Receipt</button>
              </div>
            ) : parts.length > 1 && !processing && (
              <button type="button" onClick={() => removePart(i)} className="text-slate-400 hover:text-red-400 p-1 rounded" aria-label={`Remove part ${i + 1}`}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Payment Method</label>
          <div className="grid grid-cols-3 gap-3">
            {PAYMENT_METHODS.map(m => (
              <button
                key={m}
                type="button"
                disabled={locked || (m === 'Credit Card' && cardBlocked(client))}
                onClick={() => updatePart(i, { method: m })}
                className={`border rounded-lg py-2.5 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${p.method === m ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'}`}
              >
                {m}
              </button>
            ))}
          </div>
          {cardBlocked(client) && i === 0 && <p className="text-xs text-amber-400 mt-1.5">{cardBlockedText(client)}</p>}
          {p.method === 'Other' && (
            <div className="mt-3">
              <OtherPaymentFields
                subtype={p.subtype}
                reference={p.reference}
                client={client}
                disabled={locked}
                onChange={patch => updatePart(i, {
                  ...(patch.subtype !== undefined ? { subtype: patch.subtype } : {}),
                  ...(patch.reference !== undefined ? { reference: patch.reference } : {}),
                })}
                inputClass={inputClass}
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">{split ? 'Amount' : 'Payment Amount'}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
            <input type="number" step="0.01" min="0" disabled={locked} value={p.amount} onChange={e => updatePart(i, { amount: e.target.value })} placeholder="0.00" className={`${inputClass} py-2.5 pl-7 pr-3 disabled:opacity-50`} />
          </div>
        </div>

        {p.method === 'Credit Card' && !p.receipt && (
          <CardPaymentFields value={p.card} onChange={card => updatePart(i, { card })} />
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="client-payment-title">
      <ScrollLock />
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90dvh] flex flex-col">
        <header className="p-5 border-b border-slate-800">
          <h3 id="client-payment-title" className="font-semibold text-white">Payment: {client.lastname}, {client.firstname}</h3>
          <p className="text-xs text-slate-400 mt-1">ID # {idText(client) || '—'}</p>
        </header>

        <div className="p-5 space-y-5 overflow-y-auto">
          {notice && (
            <p className="bg-amber-500/10 border border-amber-500/40 text-amber-300 rounded-lg p-3 text-sm">{notice}</p>
          )}

          {split && (
            <p className="text-xs text-slate-400">Split payment: each part is saved as its own payment on the account, with its own receipt.</p>
          )}
          {parts.map(renderPart)}
          {allowSplit && !processing && (!allProcessed || !split) && (
            <div className="flex justify-end">
              {split ? (
                <button type="button" onClick={addPart} className="text-xs text-blue-400 hover:text-blue-300 font-semibold">+ Add another part</button>
              ) : !anyProcessed && (
                <button type="button" onClick={startSplit} title="Pay part by one method and the rest by another (e.g. half card, half cash)" className="text-xs text-blue-400 hover:text-blue-300 font-semibold">Split payment</button>
              )}
            </div>
          )}

          {hasPolyFee && (
            <label className={`flex items-start gap-2.5 text-sm ${anyProcessed || polyOwed === 0 ? 'opacity-50' : lockApplyToPolyFee ? '' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={applyToPolyFee}
                disabled={anyProcessed || processing || polyOwed === 0 || lockApplyToPolyFee}
                onChange={e => setApplyToPolyFee(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-emerald-500"
              />
              <span>
                <span className="text-slate-200 font-medium">Apply to poly fee</span>
                <span className="block text-xs text-slate-500">
                  {polyOwed === 0
                    ? `Poly fee is paid in full ($${polyPaid.toFixed(2)} / $${polyFee.toFixed(2)}).`
                    : `$${polyPaid.toFixed(2)} / $${polyFee.toFixed(2)} paid. Up to $${polyOwed.toFixed(2)} goes to the poly fee; anything over goes to the account balance.`}
                </span>
              </span>
            </label>
          )}

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-400">{anyProcessed ? 'Balance after payment' : 'Current balance'}</span>
              <span className={balanceColor(baseBalance)}>{formatBalance(baseBalance)}</span>
            </div>
            {checkIn.cardPaid > 0 && (
              <p className="text-xs text-slate-500">Includes ${checkIn.cardPaid.toFixed(2)} card payment taken at check-in.</p>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400">{allProcessed ? 'Payment (processed)' : anyProcessed ? 'This payment (part processed)' : 'This payment'}</span>
              <span className={balanceColor(-paymentShown)}>{formatBalance(-paymentShown)}</span>
            </div>
            {split && parts.map((p, i) => (
              <div key={i} className="flex justify-between pl-3 text-xs">
                <span className="text-slate-500">{partMethodText(p) || p.method}{p.receipt ? ' (processed)' : ''}</span>
                <span className="text-slate-300">${(partAmountValid(p) ? partAmount(p) : 0).toFixed(2)}</span>
              </div>
            ))}
            {polyShown > 0 && (
              <>
                <div className="flex justify-between pl-3 text-xs">
                  <span className="text-slate-500">Applied to poly fee</span>
                  <span className="text-slate-300">${polyShown.toFixed(2)}</span>
                </div>
                <div className="flex justify-between pl-3 text-xs">
                  <span className="text-slate-500">Applied to account</span>
                  <span className="text-slate-300">${accountShown.toFixed(2)}</span>
                </div>
              </>
            )}
            {checkIn.fee > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-400">Group fee at close</span>
                <span className="text-red-400">{formatBalance(checkIn.fee)}</span>
              </div>
            )}
            {checkIn.payment > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-400">Paid at check-in ({paymentMethodText(checkIn.paymentMethod, checkIn.paymentSubtype, checkIn.paymentReference)})</span>
                <span className="text-emerald-400">{formatBalance(-checkIn.payment)}</span>
              </div>
            )}
            {(hasPending || !allProcessed) && (
              <div className="flex justify-between border-t border-slate-800 pt-1.5">
                <span className="font-semibold text-slate-300">{hasPending ? 'Balance after group closes' : 'Balance after payment'}</span>
                <span className={`font-bold ${balanceColor(balanceAfterClose)}`}>{formatBalance(balanceAfterClose)}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes <span className="normal-case font-normal text-slate-500">(optional)</span></label>
            <textarea disabled={anyProcessed || processing} value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="e.g. Receipt #…" className={`${inputClass} disabled:opacity-50`} />
          </div>
        </div>

        <footer className="p-5 border-t border-slate-800 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={processing} className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
            {allProcessed ? 'Done' : 'Close'}
          </button>
          {!split && (
            <button
              type="button"
              onClick={() => printReceipt(lastReceipt as Receipt, onError)}
              disabled={!lastReceipt}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Print Receipt
            </button>
          )}
          <button
            type="button"
            onClick={processPayment}
            disabled={processing || allProcessed || problem !== null}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {processing ? 'Processing...' : 'Process Payment'}
          </button>
        </footer>
      </div>
    </div>
  );
}
