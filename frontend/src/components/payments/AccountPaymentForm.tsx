import { useState } from 'react';
import { submitAccountPayment } from '../../api';
import ClientPicker from '../ClientPicker';
import CardPaymentFields from './CardPaymentFields';
import { emptyCardBilling } from './cardBilling';
import { formatBalance, toDisplayBalance } from '../../utils/balance';
import { cardBlocked, cardBlockedText } from '../../utils/cardBlock';
import { formatMoney } from '../../utils/ledger';
import { printReceipt, type Receipt } from '../../utils/receipt';

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
  // A client blocked from card payments pays cash, whatever was picked for the client before
  const payWith = cardBlocked(client) ? 'Cash' : paymentMethod;
  const currentBalance = Number(client?.accountbalance || 0);
  const balanceAfter = currentBalance - amount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || amount <= 0) return;
    setSaving(true);
    setLastPayment(null);
    try {
      const res = await submitAccountPayment({ client: Number(clientId), amount, comments, createdBy: userEmail, paymentMethod: payWith });
      onSuccess(`${payWith} payment recorded! Updated Balance: ${formatBalance(res.newBalance)}`);
      setLastPayment({
        clientName: client ? `${client.lastname}, ${client.firstname}` : `Client #${clientId}`,
        docNumber: client?.docnumber || '',
        amount,
        method: payWith,
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
          <ClientPicker clients={clients} value={clientId} onChange={setClientId} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Payment Method</label>
          <div className="grid grid-cols-2 gap-3">
            {(['Cash', 'Credit Card'] as const).map(method => (
              <button
                key={method}
                type="button"
                onClick={() => setPaymentMethod(method)}
                disabled={method === 'Credit Card' && cardBlocked(client)}
                className={`border rounded-lg py-2.5 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${payWith === method ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'}`}
              >
                {method}
              </button>
            ))}
          </div>
          {cardBlocked(client) && <p className="text-xs text-amber-400 mt-1.5">{cardBlockedText(client)}</p>}
        </div>

        {payWith === 'Credit Card' && (
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
          <button type="button" onClick={() => lastPayment && printReceipt(lastPayment, onError)} disabled={!lastPayment} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-semibold px-6 py-2.5 rounded-lg text-sm mt-4">Print Receipt</button>
          <button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm mt-4">Process Payment</button>
        </div>
      </form>

    </>
  );
}
