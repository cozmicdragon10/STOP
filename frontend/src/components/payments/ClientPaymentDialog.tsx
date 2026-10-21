import { useState } from 'react';
import type { ClientRecord, PaymentMethod } from '../../hooks/useGroupCheckIn';
import { submitAccountPayment } from '../../api';
import { formatBalance, toDisplayBalance } from '../../utils/balance';
import { printReceipt, type Receipt } from '../../utils/receipt';
import CardPaymentFields, { emptyCardBilling, type CardBilling } from './CardPaymentFields';

interface Props {
  client: ClientRecord;
  // Account balance as shown on the review screen (stored sign: positive = owes)
  balance: number;
  // What the check-in did for this client; recorded when the group closes. Omitted outside a group check-in.
  checkIn?: { fee: number; payment: number; paymentMethod: PaymentMethod; cardPaid: number };
  // Start of the ledger comment when no notes are entered, e.g. "Payment after group"
  noteLabel?: string;
  // Optional starting values and an explanation shown at the top, e.g. when a payment is needed to schedule a polygraph
  initialAmount?: number;
  initialApplyToPolyFee?: boolean;
  // Keeps the "Apply to poly fee" choice at initialApplyToPolyFee, e.g. for a payment taken to schedule a polygraph
  lockApplyToPolyFee?: boolean;
  notice?: string;
  createdBy: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  // polyFeePaid and polyFeeVoucher are the client's poly fee figures after this payment
  onProcessed: (newBalance: number, polyFeePaid: number, polyFeeVoucher: number) => void;
}

const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'Credit Card'];
const inputClass = 'w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm';
const NO_CHECK_IN = { fee: 0, payment: 0, paymentMethod: 'Cash' as PaymentMethod, cardPaid: 0 };

// Payment on a client's account: after group (before the group is closed) or from the client account view.
// Same payment rules as the Account-Only screen.
export default function ClientPaymentDialog({ client, balance, checkIn = NO_CHECK_IN, noteLabel = 'Payment after group', initialAmount, initialApplyToPolyFee = false, lockApplyToPolyFee = false, notice, createdBy, onClose, onSuccess, onError, onProcessed }: Props) {
  const [amount, setAmount] = useState(initialAmount ? initialAmount.toFixed(2) : '');
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [notes, setNotes] = useState('');
  const [card, setCard] = useState<CardBilling>(emptyCardBilling);
  const [processing, setProcessing] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [applyToPolyFee, setApplyToPolyFee] = useState(initialApplyToPolyFee);

  const parsedAmount = amount.trim() === '' ? 0 : Number(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  // Poly fee option is offered only when the client record carries poly fee figures
  const hasPolyFee = client.polyfee != null;
  const polyFee = Number(client.polyfee ?? 0);
  const polyPaid = Number(client.polyfeepaid ?? 0);
  const polyOwed = Math.max(0, polyFee - polyPaid);

  // Stored sign: positive = owes. After a processed payment the balance starts from the saved figure.
  const baseBalance = receipt ? receipt.newBalance : balance;
  const paymentShown = receipt ? receipt.amount : (validAmount ? parsedAmount : 0);
  // Mirrors the server: the poly fee is paid down first, the excess goes to the account
  const polyShown = receipt ? (receipt.polyApplied ?? 0) : (applyToPolyFee ? Math.min(paymentShown, polyOwed) : 0);
  const accountShown = paymentShown - polyShown;
  // The group's fee and cash payment are not saved until the group closes, so they are shown as pending
  const hasPending = checkIn.fee > 0 || checkIn.payment > 0;
  const balanceAfterClose = baseBalance - (receipt ? 0 : accountShown) + checkIn.fee - checkIn.payment;
  const balanceColor = (stored: number) => (toDisplayBalance(stored) < 0 ? 'text-red-400' : 'text-emerald-400');

  const processPayment = async () => {
    if (!validAmount) {
      onError('Enter a payment amount greater than $0.00.');
      return;
    }
    setProcessing(true);
    try {
      const res = await submitAccountPayment({
        client: client.clientid,
        amount: parsedAmount,
        comments: notes.trim() || `${noteLabel} (${method}).`,
        createdBy,
        paymentMethod: method,
        applyToPolyFee,
      });
      if (!res.success) throw new Error(res.error || 'Payment could not be processed.');
      const polyApplied = Number(res.polyApplied ?? 0);
      const newPolyPaid = res.polyFeePaid != null ? Number(res.polyFeePaid) : polyPaid;
      setReceipt({
        clientName: `${client.lastname}, ${client.firstname}`,
        docNumber: client.docnumber || '',
        amount: parsedAmount,
        method,
        newBalance: Number(res.newBalance),
        processedBy: createdBy,
        date: new Date().toLocaleString(),
        polyApplied,
        polyFeePaid: newPolyPaid,
        polyFee,
      });
      onSuccess(`${method} payment recorded for ${client.firstname} ${client.lastname}.`);
      onProcessed(Number(res.newBalance), newPolyPaid, Number(res.polyFeeVoucher ?? client.polyfeevoucher ?? 0));
    } catch (err: unknown) {
      onError(err instanceof Error && err.message ? err.message : 'Payment could not be processed.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="client-payment-title">
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <header className="p-5 border-b border-slate-800">
          <h3 id="client-payment-title" className="font-semibold text-white">Payment: {client.lastname}, {client.firstname}</h3>
          <p className="text-xs text-slate-400 mt-1">DOC # {client.docnumber || '—'}</p>
        </header>

        <div className="p-5 space-y-5 overflow-y-auto">
          {notice && (
            <p className="bg-amber-500/10 border border-amber-500/40 text-amber-300 rounded-lg p-3 text-sm">{notice}</p>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Payment Method</label>
            <div className="grid grid-cols-2 gap-3">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m}
                  type="button"
                  disabled={receipt !== null}
                  onClick={() => setMethod(m)}
                  className={`border rounded-lg py-2.5 text-sm font-semibold transition disabled:opacity-50 ${method === m ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Payment Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
              <input type="number" step="0.01" min="0" disabled={receipt !== null} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className={`${inputClass} py-2.5 pl-7 pr-3 disabled:opacity-50`} />
            </div>
          </div>

          {hasPolyFee && (
            <label className={`flex items-start gap-2.5 text-sm ${receipt || polyOwed === 0 ? 'opacity-50' : lockApplyToPolyFee ? '' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={applyToPolyFee}
                disabled={receipt !== null || polyOwed === 0 || lockApplyToPolyFee}
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
              <span className="text-slate-400">{receipt ? 'Balance after payment' : 'Current balance'}</span>
              <span className={balanceColor(baseBalance)}>{formatBalance(baseBalance)}</span>
            </div>
            {checkIn.cardPaid > 0 && (
              <p className="text-xs text-slate-500">Includes ${checkIn.cardPaid.toFixed(2)} card payment taken at check-in.</p>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400">{receipt ? 'Payment (processed)' : 'This payment'}</span>
              <span className="text-emerald-400">{formatBalance(-paymentShown)}</span>
            </div>
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
                <span className="text-slate-400">Paid at check-in ({checkIn.paymentMethod})</span>
                <span className="text-emerald-400">{formatBalance(-checkIn.payment)}</span>
              </div>
            )}
            {(hasPending || !receipt) && (
              <div className="flex justify-between border-t border-slate-800 pt-1.5">
                <span className="font-semibold text-slate-300">{hasPending ? 'Balance after group closes' : 'Balance after payment'}</span>
                <span className={`font-bold ${balanceColor(balanceAfterClose)}`}>{formatBalance(balanceAfterClose)}</span>
              </div>
            )}
          </div>

          {method === 'Credit Card' && !receipt && (
            <CardPaymentFields value={card} onChange={setCard} />
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes <span className="normal-case font-normal text-slate-500">(optional)</span></label>
            <textarea disabled={receipt !== null} value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="e.g. Receipt #…" className={`${inputClass} disabled:opacity-50`} />
          </div>
        </div>

        <footer className="p-5 border-t border-slate-800 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 px-4 py-2 rounded-lg text-sm font-semibold">
            {receipt ? 'Done' : 'Close'}
          </button>
          <button
            type="button"
            onClick={() => printReceipt(receipt as Receipt, onError)}
            disabled={!receipt}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Print Receipt
          </button>
          <button
            type="button"
            onClick={processPayment}
            disabled={processing || receipt !== null || !validAmount}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {processing ? 'Processing...' : 'Process Payment'}
          </button>
        </footer>
      </div>
    </div>
  );
}
