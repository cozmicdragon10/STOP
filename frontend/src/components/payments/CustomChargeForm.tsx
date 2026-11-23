import { useState } from 'react';
import { submitCustomCharge } from '../../api';
import ClientPicker from '../ClientPicker';
import { balanceColor, formatBalance, toDisplayBalance } from '../../utils/balance';
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
  // Set once the fee is charged: the form locks (New Charge unlocks it) and shows that charge. The client's balance
  // reloads with the charge in it, so the figures come from the saved charge, not the client row.
  const [lastCharge, setLastCharge] = useState<{ amount: number; newBalance: number } | null>(null);

  const amount = Number(amountInput) || 0;
  const client = clients.find(c => c.clientid === Number(clientId));
  const locked = lastCharge !== null;
  const shownAmount = locked ? lastCharge.amount : amount;
  const currentBalance = locked ? lastCharge.newBalance - lastCharge.amount : Number(client?.accountbalance || 0);
  const balanceAfter = locked ? lastCharge.newBalance : currentBalance + amount;

  const startNewCharge = () => {
    setLastCharge(null);
    setClientId('');
    setAmountInput('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId || amount <= 0 || !notes.trim()) return;
    setSaving(true);
    try {
      const res = await submitCustomCharge({ client: Number(clientId), amount, comments: notes.trim(), createdBy: userEmail });
      onSuccess(`Custom fee of ${formatMoney(amount)} charged! Updated Balance: ${formatBalance(res.newBalance)}`);
      setLastCharge({ amount, newBalance: Number(res.newBalance) });
      onCharged();
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Error charging custom fee.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-xl">
      {/* Disabled once the fee is charged: every field locks until New Charge */}
      <fieldset disabled={locked || saving} className={`space-y-5 min-w-0 border-0 p-0 m-0 ${locked ? 'opacity-70' : ''}`}>
      <div>
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Client</label>
        <ClientPicker clients={clients} value={clientId} onChange={setClientId} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
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
              <span className="text-slate-400">{locked ? 'Balance before charge' : 'Current balance'}</span>
              <span className={balanceColor(currentBalance)}>{formatMoney(toDisplayBalance(currentBalance))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">{locked ? 'Charge (saved)' : 'This charge'}</span>
              <span className={balanceColor(shownAmount)}>-{formatMoney(shownAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-1.5">
              <span className="font-semibold text-slate-300">Balance after charge</span>
              <span className={`font-bold ${balanceColor(balanceAfter)}`}>{formatMoney(toDisplayBalance(balanceAfter))}</span>
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
      </fieldset>

      {locked && (
        <p className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
          Fee charged. Press New Charge to enter another.
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
        {locked ? (
          <button type="button" onClick={startNewCharge} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm mt-4">New Charge</button>
        ) : (
          <button type="submit" disabled={saving || !notes.trim()} className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm mt-4">{saving ? 'Charging...' : 'Charge Fee'}</button>
        )}
      </div>
    </form>
  );
}
