import { useState } from 'react';
import { submitCustomCharge } from '../../api';
import { formatBalance, toDisplayBalance } from '../../utils/balance';
import { formatMoney } from '../../utils/ledger';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client rows are untyped throughout App
  clients: any[];
  userEmail: string;
  // Reload clients and balances after a charge
  onCharged: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

// Attendance tab's Custom Charge (Business Administrators only): a one-off fee on a client's account
export default function CustomChargeForm({ clients, userEmail, onCharged, onSuccess, onError }: Props) {
  const [clientId, setClientId] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const amount = Number(amountInput) || 0;
  const client = clients.find(c => c.clientid === Number(clientId));
  const currentBalance = Number(client?.accountbalance || 0);
  const balanceAfter = currentBalance + amount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || amount <= 0 || !notes.trim()) return;
    setSaving(true);
    try {
      const res = await submitCustomCharge({ client: Number(clientId), amount, comments: notes.trim(), createdBy: userEmail });
      onSuccess(`Custom fee of ${formatMoney(amount)} charged! Updated Balance: ${formatBalance(res.newBalance)}`);
      onCharged();
      setAmountInput('');
      setNotes('');
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Error charging custom fee.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-xl">
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Client</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required>
          <option value="">Select a client…</option>
          {clients.map(c => <option key={c.clientid} value={c.clientid}>{c.lastname}, {c.firstname}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Fee Amount</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
          <input type="number" step="0.01" min="0.01" value={amountInput} onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }} onChange={(e) => setAmountInput(e.target.value.replace(/-/g, ''))} placeholder="0.00" className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 pl-7 pr-3 text-white text-sm" required />
        </div>
        {client ? (
          <div className="mt-3 bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-slate-400">Current balance</span>
              <span className={toDisplayBalance(currentBalance) < 0 ? 'text-red-400' : 'text-emerald-400'}>{formatMoney(toDisplayBalance(currentBalance))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">This charge</span>
              <span className="text-red-400">-{formatMoney(amount)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-1.5">
              <span className="font-semibold text-slate-300">Balance after charge</span>
              <span className={`font-bold ${toDisplayBalance(balanceAfter) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatMoney(toDisplayBalance(balanceAfter))}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 mt-1.5">Select a client to see their account balance.</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" placeholder="Reason for this fee…" required />
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
        <button type="submit" disabled={saving || !notes.trim()} className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm mt-4">Charge Fee</button>
      </div>
    </form>
  );
}
