import { useState } from 'react';
import { submitAccountPayment } from '../../api';
import CardPaymentFields from './CardPaymentFields';
import { emptyCardBilling } from './cardBilling';
import { formatBalance, toDisplayBalance } from '../../utils/balance';
import { formatMoney } from '../../utils/ledger';

/* eslint-disable @typescript-eslint/no-explicit-any -- client rows are untyped throughout App */
interface Props {
  clients: any[];
  userEmail: string;
  // Reload clients and balances after a payment
  onRecorded: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface Receipt { clientName: string; docNumber: string; amount: number; method: string; notes: string; newBalance: number; processedBy: string; date: string }

// Attendance tab's Account-Only Payment: a payment toward a client's balance without a check-in, with a printable receipt
export default function AccountPaymentForm({ clients, userEmail, onRecorded, onSuccess, onError }: Props) {
  const [clientId, setClientId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [comments, setComments] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Credit Card'>('Cash');
  const [cardBilling, setCardBilling] = useState(emptyCardBilling);
  const [saving, setSaving] = useState(false);
  // Set only after a payment is saved to the account; drives the receipt printout
  const [lastPayment, setLastPayment] = useState<Receipt | null>(null);

  const amount = Number(amountInput) || 0;
  const client = clients.find(c => c.clientid === Number(clientId));
  const currentBalance = Number(client?.accountbalance || 0);
  const balanceAfter = currentBalance - amount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || amount <= 0) return;
    setSaving(true);
    setLastPayment(null);
    try {
      const res = await submitAccountPayment({ client: Number(clientId), amount, comments, createdBy: userEmail, paymentMethod });
      if (!res.success) {
        onError(res.error || 'Error recording payment.');
        return;
      }
      onSuccess(`${paymentMethod} payment recorded! Updated Balance: ${formatBalance(res.newBalance)}`);
      setLastPayment({
        clientName: client ? `${client.lastname}, ${client.firstname}` : `Client #${clientId}`,
        docNumber: client?.docnumber || '',
        amount,
        method: paymentMethod,
        notes: comments,
        newBalance: Number(res.newBalance),
        processedBy: userEmail,
        date: new Date().toLocaleString()
      });
      onRecorded();
      setComments('');
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Error recording payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-5 max-w-xl">
        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Client</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required>
            <option value="">Select a client…</option>
            {clients.map(c => <option key={c.clientid} value={c.clientid}>{c.lastname}, {c.firstname}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Payment Method</label>
          <div className="grid grid-cols-2 gap-3">
            {(['Cash', 'Credit Card'] as const).map(method => (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentMethod(method)}
                className={`border rounded-lg py-2.5 text-sm font-semibold transition ${paymentMethod === method ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'}`}
              >
                {method}
              </button>
            ))}
          </div>
        </div>

        {paymentMethod === 'Credit Card' && (
          <CardPaymentFields value={cardBilling} onChange={setCardBilling} />
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Payment Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
            <input type="number" step="0.01" min="0" value={amountInput} onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }} onChange={(e) => setAmountInput(e.target.value.replace(/-/g, ''))} placeholder="0.00" className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 pl-7 pr-3 text-white text-sm" required />
          </div>
          {client ? (
            <div className="mt-3 bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">Current balance</span>
                <span className={toDisplayBalance(currentBalance) < 0 ? 'text-red-400' : 'text-emerald-400'}>{formatMoney(toDisplayBalance(currentBalance))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">This payment</span>
                <span className="text-emerald-400">+{formatMoney(amount)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-1.5">
                <span className="font-semibold text-slate-300">Balance after payment</span>
                <span className={`font-bold ${toDisplayBalance(balanceAfter) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatMoney(toDisplayBalance(balanceAfter))}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 mt-1.5">Select a client to see their account balance.</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes <span className="normal-case font-normal text-slate-500">(optional)</span></label>
          <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" placeholder="e.g. Cash payment, receipt #…" />
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
          <button type="button" onClick={() => window.print()} disabled={!lastPayment} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-semibold px-6 py-2.5 rounded-lg text-sm mt-4">Print Receipt</button>
          <button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm mt-4">Process Payment</button>
        </div>
      </form>

      {lastPayment && (
        <>
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              #payment-receipt, #payment-receipt * { visibility: visible !important; }
              #payment-receipt { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
            }
          `}</style>
          <div id="payment-receipt" className="hidden bg-white text-black p-6 text-sm">
            <h2 className="text-lg font-bold">Payment Receipt</h2>
            <p className="text-xs text-gray-600 mb-3">{lastPayment.date}</p>
            <hr className="mb-3 border-gray-300" />
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="py-1 text-gray-600">Client</td><td className="py-1 text-right font-medium">{lastPayment.clientName}</td></tr>
                {lastPayment.docNumber && <tr><td className="py-1 text-gray-600">DOC #</td><td className="py-1 text-right">{lastPayment.docNumber}</td></tr>}
                <tr><td className="py-1 text-gray-600">Payment method</td><td className="py-1 text-right">{lastPayment.method}</td></tr>
                <tr><td className="py-1 text-gray-600">Amount paid</td><td className="py-1 text-right font-bold">${lastPayment.amount.toFixed(2)}</td></tr>
                <tr><td className="py-1 text-gray-600">Balance after payment</td><td className="py-1 text-right">{formatMoney(toDisplayBalance(lastPayment.newBalance))}</td></tr>
              </tbody>
            </table>
            {lastPayment.notes && <p className="mt-3 text-xs"><span className="text-gray-600">Notes:</span> {lastPayment.notes}</p>}
            <hr className="my-3 border-gray-300" />
            <p className="text-xs text-gray-600">Processed by {lastPayment.processedBy}</p>
            <p className="text-xs text-gray-600 mt-3 text-center">Thank you.</p>
          </div>
        </>
      )}
    </>
  );
}
