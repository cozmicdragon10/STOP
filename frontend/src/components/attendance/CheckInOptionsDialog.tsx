import { useState } from 'react';
import { clientFee, type ClientRecord, type PaymentMethod, type PaymentTerms } from '../../hooks/useGroupCheckIn';
import { submitAccountPayment } from '../../api';
import { FIRST_CHECKIN_MAX_OWED, formatBalance } from '../../utils/balance';
import { isMonthlyFeeClient } from '../../utils/soPhases';
import { printReceipt, type Receipt } from '../../utils/receipt';
import CardPaymentFields, { emptyCardBilling, type CardBilling } from '../payments/CardPaymentFields';

interface Props {
  clients: ClientRecord[];
  createdBy: string;
  onConfirm: (terms: Record<number, PaymentTerms>) => void;
  onCancel: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onProcessed: () => void;
}

// Inputs are kept as text so a field can be cleared while typing.
interface Row {
  payment: string;
  paymentMethod: PaymentMethod;
  voucher: boolean;
  card: CardBilling;
  processing: boolean;
  receipt: Receipt | null;
}

const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'Credit Card'];

// Explains the fee line: where it comes from, or why nothing is charged
const feeLabel = (c: ClientRecord, fee: number): string => {
  if (fee > 0) return 'Treatment fee (from account)';
  if (isMonthlyFeeClient(c.programtype, c.phase) && c.attendedthismonth) return 'Already charged this month (nothing charged)';
  return 'No treatment fee on account (nothing charged)';
};
// How much a client still has to pay before their first check-in of the month is allowed (0 when they may check in).
// Balances are in the stored sign (positive = owes); a processed card payment is already in the balance. BIP clients are exempt.
// A card amount counts only once the card is processed.
const amountStillOwedToCheckIn = (c: ClientRecord, row: Row): number => {
  if (c.attendedthismonth || c.programtype === 'BIP') return 0;
  const cashNow = row.paymentMethod === 'Cash' ? (parsePayment(row) ?? 0) : 0;
  const balance = row.receipt ? row.receipt.newBalance : Number(c.accountbalance || 0) - cashNow;
  return Math.max(0, Math.round((balance - FIRST_CHECKIN_MAX_OWED) * 100) / 100);
};

// The smallest payment that lets the client's first check-in of the month through (0 when no payment is required)
const minimumCheckInPayment = (c: ClientRecord): number => {
  if (c.attendedthismonth || c.programtype === 'BIP') return 0;
  return Math.max(0, Math.round((Number(c.accountbalance || 0) - FIRST_CHECKIN_MAX_OWED) * 100) / 100);
};

const inputClass ='w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm';

// Returns the parsed payment for one row, or null if the payment is not a valid amount.
const parsePayment = (row: Row): number | null => {
  const payment = row.payment.trim() === '' ? 0 : Number(row.payment);
  return Number.isFinite(payment) && payment >= 0 ? payment : null;
};

export default function CheckInOptionsDialog({ clients, createdBy, onConfirm, onCancel, onSuccess, onError, onProcessed }: Props) {
  const [rows, setRows] = useState<Record<number, Row>>(() =>
    Object.fromEntries(clients.map(c => [c.clientid, {
      payment: '', paymentMethod: 'Cash' as PaymentMethod, voucher: false, card: emptyCardBilling, processing: false, receipt: null,
    }]))
  );

  const updateRow = (clientId: number, patch: Partial<Row>) => {
    setRows(prev => ({ ...prev, [clientId]: { ...prev[clientId], ...patch } }));
  };

  // Card payments are saved right away from this screen. Once processed, the amount is already on the
  // client's account, so the check-in itself records no payment for that client.
  const processCardPayment = async (c: ClientRecord) => {
    const row = rows[c.clientid];
    const amount = parsePayment(row);
    if (amount === null || amount <= 0) return;

    updateRow(c.clientid, { processing: true });
    try {
      const res = await submitAccountPayment({
        client: c.clientid,
        amount,
        comments: 'Card payment processed at group check-in.',
        createdBy,
        paymentMethod: 'Credit Card',
      });
      if (!res.success) throw new Error(res.error || 'Payment could not be processed.');
      updateRow(c.clientid, {
        processing: false,
        receipt: {
          clientName: `${c.lastname}, ${c.firstname}`,
          docNumber: c.docnumber || '',
          amount,
          method: 'Credit Card',
          newBalance: Number(res.newBalance),
          processedBy: createdBy,
          date: new Date().toLocaleString(),
        },
      });
      onSuccess(`Card payment processed for ${c.firstname} ${c.lastname}.`);
      onProcessed();
    } catch (err: unknown) {
      updateRow(c.clientid, { processing: false });
      onError(err instanceof Error && err.message ? err.message : 'Payment could not be processed.');
    }
  };

  const invalid = clients.some(c => {
    const row = rows[c.clientid];
    return !row.receipt && parsePayment(row) === null;
  });
  // Clients whose balance is too far behind for their first check-in of the month
  const blocked = clients.filter(c => amountStillOwedToCheckIn(c, rows[c.clientid]) > 0);

  const confirm = () => {
    if (invalid || blocked.length > 0) return;
    const terms = Object.fromEntries(clients.map(c => {
      const row = rows[c.clientid];
      const payment = row.receipt ? 0 : (parsePayment(row) ?? 0);
      return [c.clientid, {
        payment,
        paymentMethod: row.paymentMethod,
        voucher: row.voucher,
        cardPaid: row.receipt ? row.receipt.amount : 0,
        // Card payments are already saved, so the balance here already reflects them
        balance: row.receipt ? row.receipt.newBalance : Number(c.accountbalance || 0),
      }];
    })) as Record<number, PaymentTerms>;
    onConfirm(terms);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="check-in-options-title">
      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <header className="p-5 border-b border-slate-800">
          <h3 id="check-in-options-title" className="font-semibold text-white">Check-In Details</h3>
          <p className="text-xs text-slate-400 mt-1">
            Set the payment for each client. Leave payment blank if nothing is paid at check-in. Credit card payments are processed here and get a receipt.
          </p>
        </header>

        <div className="p-5 space-y-3 overflow-y-auto">
          {clients.map(c => {
            const row = rows[c.clientid];
            const locked = row.receipt !== null;
            const rowValid = locked || parsePayment(row) !== null;
            const canProcess = row.paymentMethod === 'Credit Card' && !locked && !row.processing && (parsePayment(row) ?? 0) > 0;
            // Balances are in the stored sign (positive = owes). A processed card payment is already on the account,
            // so the balance starts from the post-payment figure and nothing more is paid in this check-in.
            const baseBalance = locked ? row.receipt!.newBalance : Number(c.accountbalance || 0);
            const paymentNow = locked ? row.receipt!.amount : (parsePayment(row) ?? 0);
            // Each client's fee comes from their own account
            const fee = clientFee(c);
            const afterCheckIn = baseBalance + fee - (locked ? 0 : paymentNow);
            const stillOwed = amountStillOwedToCheckIn(c, row);
            const minimumPayment = minimumCheckInPayment(c);
            return (
              <article key={c.clientid} className={`bg-slate-950 border rounded-lg p-4 ${rowValid && stillOwed === 0 ? 'border-slate-800' : 'border-red-500/50'}`}>
                <div className="flex justify-between items-baseline gap-3 mb-3">
                  <p className="font-semibold text-white truncate">{c.lastname}, {c.firstname}</p>
                  <p className="text-xs text-slate-400 whitespace-nowrap">DOC # {c.docnumber || '—'} · Balance {formatBalance(c.accountbalance)}</p>
                </div>
                {stillOwed > 0 && (
                  <div className="mb-3 bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-xs text-red-300">
                    This is {c.firstname}'s first group check-in this month. The client must pay their existing balance down to{' '}
                    {formatBalance(FIRST_CHECKIN_MAX_OWED)} or better to be checked in. A payment of at least <strong>${minimumPayment.toFixed(2)}</strong> is
                    required{row.paymentMethod === 'Credit Card' ? ', and the card must be processed before check-in' : ''}.
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-300 items-end">
                  <label className="flex flex-col gap-1">
                    <span>Payment ($){minimumPayment > 0 && !locked && <span className="text-red-400"> · min ${minimumPayment.toFixed(2)}</span>}</span>
                    <input type="number" step="0.01" min={minimumPayment > 0 ? minimumPayment : 0} placeholder={minimumPayment > 0 ? minimumPayment.toFixed(2) : '0.00'} disabled={locked} value={row.payment} onChange={e => updateRow(c.clientid, { payment: e.target.value })} className={`${inputClass} disabled:opacity-50`} />
                  </label>
                  <div className="flex flex-col gap-1">
                    Payment Method
                    <div className="grid grid-cols-2 gap-1.5">
                      {PAYMENT_METHODS.map(method => (
                        <button
                          key={method}
                          type="button"
                          disabled={locked}
                          onClick={() => updateRow(c.clientid, { paymentMethod: method })}
                          className={`border rounded-lg py-2 text-xs font-semibold transition disabled:opacity-50 ${row.paymentMethod === method ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 pb-2">
                    <input type="checkbox" checked={row.voucher} onChange={e => updateRow(c.clientid, { voucher: e.target.checked })} className="rounded accent-blue-500" />
                    Apply Voucher
                  </label>
                </div>

                <div className="mt-3 bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Current balance</span>
                    <span className="text-white">{formatBalance(baseBalance)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{feeLabel(c, fee)}</span>
                    <span className="text-red-400">{formatBalance(fee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{locked ? 'Payment (processed)' : 'This payment'}</span>
                    <span className="text-emerald-400">{formatBalance(-paymentNow)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-1.5">
                    <span className="font-semibold text-slate-300">Balance after check-in</span>
                    <span className="font-bold text-white">{formatBalance(afterCheckIn)}</span>
                  </div>
                </div>

                {row.paymentMethod === 'Credit Card' && (
                  <div className="mt-3 space-y-3">
                    <CardPaymentFields value={row.card} onChange={card => updateRow(c.clientid, { card })} />
                    <div className="flex flex-wrap justify-end items-center gap-2">
                      {locked && <span className="text-xs text-emerald-400 mr-auto">Payment processed</span>}
                      <button
                        type="button"
                        onClick={() => printReceipt(row.receipt as Receipt, onError)}
                        disabled={!locked}
                        className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Print Receipt
                      </button>
                      <button
                        type="button"
                        onClick={() => processCardPayment(c)}
                        disabled={!canProcess}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {row.processing ? 'Processing...' : 'Process Payment'}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <footer className="p-5 border-t border-slate-800 flex flex-wrap justify-between items-center gap-3">
          <p className={`text-xs ${invalid || blocked.length > 0 ? 'text-red-400' : 'text-slate-500'}`}>
            {invalid
              ? 'Enter a payment of 0 or more for every client.'
              : blocked.length > 0
                ? `${blocked.map(c => `${c.lastname}, ${c.firstname}`).join('; ')} must pay at least the minimum payment before checking in.`
                : `${clients.length} client(s) ready to check in.`}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 px-4 py-2 rounded-lg text-sm font-semibold">Cancel</button>
            <button type="button" onClick={confirm} disabled={invalid || blocked.length > 0} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
              Confirm Check-In ({clients.length})
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
