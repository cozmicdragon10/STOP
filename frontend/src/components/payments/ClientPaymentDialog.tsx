import { useState } from 'react';
import type { ClientRecord, PaymentMethod } from '../../hooks/useGroupCheckIn';
import { submitAccountPayment } from '../../api';
import { formatBalance } from '../../utils/balance';
import { printReceipt, type Receipt } from '../../utils/receipt';
import CardPaymentFields, { emptyCardBilling, type CardBilling } from './CardPaymentFields';

interface Props {
  client: ClientRecord;
  createdBy: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onProcessed: (newBalance: number) => void;
}

const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'Credit Card'];
const inputClass = 'w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm';

// Payment taken from a client after group, before the group is closed. Same payment rules as the Account-Only screen.
export default function ClientPaymentDialog({ client, createdBy, onClose, onSuccess, onError, onProcessed }: Props) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [notes, setNotes] = useState('');
  const [card, setCard] = useState<CardBilling>(emptyCardBilling);
  const [processing, setProcessing] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const parsedAmount = amount.trim() === '' ? 0 : Number(amount);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;

  // Stored sign: positive = owes. After a processed payment the balance starts from the saved figure.
  const baseBalance = receipt ? receipt.newBalance : Number(client.accountbalance || 0);
  const paymentShown = receipt ? receipt.amount : (validAmount ? parsedAmount : 0);
  const balanceAfter = baseBalance - (receipt ? 0 : paymentShown);

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
        comments: notes.trim() || `Payment after group (${method}).`,
        createdBy,
        paymentMethod: method,
      });
      if (!res.success) throw new Error(res.error || 'Payment could not be processed.');
      setReceipt({
        clientName: `${client.lastname}, ${client.firstname}`,
        docNumber: client.docnumber || '',
        amount: parsedAmount,
        method,
        newBalance: Number(res.newBalance),
        processedBy: createdBy,
        date: new Date().toLocaleString(),
      });
      onSuccess(`${method} payment recorded for ${client.firstname} ${client.lastname}.`);
      onProcessed(Number(res.newBalance));
    } catch (err: unknown) {
      onError(err instanceof Error && err.message ? err.message : 'Payment could not be processed.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="client-payment-title">
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <header className="p-5 border-b border-slate-800">
          <h3 id="client-payment-title" className="font-semibold text-white">Payment: {client.lastname}, {client.firstname}</h3>
          <p className="text-xs text-slate-400 mt-1">DOC # {client.docnumber || '—'}</p>
        </header>

        <div className="p-5 space-y-5 overflow-y-auto">
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

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-400">{receipt ? 'Balance after payment' : 'Current balance'}</span>
              <span className="text-white">{formatBalance(baseBalance)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{receipt ? 'Payment (processed)' : 'This payment'}</span>
              <span className="text-emerald-400">{formatBalance(-paymentShown)}</span>
            </div>
            {!receipt && (
              <div className="flex justify-between border-t border-slate-800 pt-1.5">
                <span className="font-semibold text-slate-300">Balance after payment</span>
                <span className="font-bold text-white">{formatBalance(balanceAfter)}</span>
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
