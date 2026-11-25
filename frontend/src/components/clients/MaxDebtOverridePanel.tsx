import { useEffect, useState } from 'react';
import { useUnsavedForm } from '../../hooks/useUnsavedForm';
import { deleteClientDebtLimit, fetchClientDebtLimit, saveClientDebtLimit, type DebtLimit } from '../../api';
import { getLocalDateString, parseLogDate } from '../../utils/dates';
import { MAX_DEBT_LIMIT, formatBalanceLabeled } from '../../utils/balance';
import { askConfirm } from '../../utils/confirm';

interface Props {
  client: { clientid: number; accountbalance?: number | string | null };
  role: string;
  // Saved or removed: App reloads the rosters, which carry the limit to check-in and assessments
  onChanged: () => void;
  onSuccess: (message: string) => void;
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const day = (ymd: string) => parseLogDate(ymd)?.toLocaleDateString() ?? ymd;

// Max Debt Override (Business Administrators change it): through an expiration date the client may owe up to an amount
// and still be checked in to groups and individual sessions and begin assessments. Normally the balance must be $0.00
// or better at the first check-in of the month (every one for Chaperon clients), and assessments are paid in full.
export default function MaxDebtOverridePanel({ client, role, onChanged, onSuccess }: Props) {
  const isAdmin = role === 'Business Administrator';
  const [limit, setLimit] = useState<DebtLimit | null>(null);
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [expires, setExpires] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useUnsavedForm(showForm && !!(amount || expires));

  useEffect(() => {
    let cancelled = false;
    fetchClientDebtLimit(client.clientid)
      .then(r => { if (!cancelled) setLimit(r.limit); })
      .catch(err => { if (!cancelled) setLoadError(errorText(err, 'Failed to load the max debt override.')); });
    return () => { cancelled = true; };
  }, [client.clientid]);

  const closeForm = () => { setShowForm(false); setAmount(''); setExpires(''); setError(''); };
  const openForm = () => {
    setShowForm(true);
    setAmount(limit ? Number(limit.maxowed).toFixed(2) : '');
    setExpires(limit?.expirationdate ?? '');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (amount === '' || !Number.isFinite(n) || n <= 0) { setError('Enter the most the client may owe, more than $0.00.'); return; }
    if (n > MAX_DEBT_LIMIT) { setError(`The max debt can be up to ${money(MAX_DEBT_LIMIT)}.`); return; }
    if (!expires) { setError('Enter the expiration date.'); return; }
    if (expires < getLocalDateString()) { setError('The expiration date cannot be in the past.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await saveClientDebtLimit(client.clientid, Math.round(n * 100) / 100, expires);
      setLimit(res.limit);
      onSuccess(`Max debt override set: the client may owe up to ${money(res.limit.maxowed)} through ${day(res.limit.expirationdate)}.`);
      closeForm();
      onChanged();
    } catch (err) {
      setError(errorText(err, 'Failed to save the max debt override.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!(await askConfirm({ title: 'Remove the max debt override?', message: 'The normal balance rules apply again right away.', confirmLabel: 'Remove Override', danger: true }))) return;
    setSaving(true);
    setError('');
    try {
      await deleteClientDebtLimit(client.clientid);
      setLimit(null);
      onSuccess('Max debt override removed. The normal balance rules apply.');
      onChanged();
    } catch (err) {
      setError(errorText(err, 'Failed to remove the max debt override.'));
    } finally {
      setSaving(false);
    }
  };

  const owed = Number(client.accountbalance || 0);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
      <div className="flex justify-between items-start gap-3 mb-4">
        <h3 className="text-xs font-bold uppercase text-blue-400 tracking-wider">Max Debt Override</h3>
        {isAdmin && (
          <button type="button" onClick={() => (showForm ? closeForm() : openForm())} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
            {showForm ? 'Cancel' : limit ? 'Change Max Debt' : 'Set Max Debt'}
          </button>
        )}
      </div>

      {loadError && <p className="text-xs text-red-400">{loadError}</p>}

      {limit ? (
        <div className="bg-slate-900 border border-amber-500/30 rounded-lg p-4 mb-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500 mb-1">May owe up to</p>
              <p className="text-white font-semibold text-lg">{money(limit.maxowed)}</p>
              <p className={`text-xs mt-0.5 ${owed > Number(limit.maxowed) ? 'text-red-400' : 'text-slate-500'}`}>
                Balance now: {formatBalanceLabeled(client.accountbalance)}{owed > Number(limit.maxowed) ? ' (over the limit)' : ''}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Expires (last day it applies)</p>
              <p className="text-white font-semibold">{day(limit.expirationdate)}</p>
            </div>
          </div>
          <p className="text-[0.6875rem] text-slate-500 mt-3">Applies to group and individual check-ins and to beginning assessments.</p>
          {isAdmin && (
            <button type="button" disabled={saving} onClick={remove} className="mt-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-lg text-xs font-semibold w-full disabled:opacity-50">
              Remove Override
            </button>
          )}
        </div>
      ) : !loadError && (
        <p className="text-xs text-slate-400">No max debt override. The balance must be $0.00 or better at the first check-in of the month, and assessments are paid in full.</p>
      )}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      {showForm && isAdmin && (
        <form onSubmit={save} className="space-y-3 border-t border-slate-800 pt-4 mt-4">
          <div>
            <label htmlFor="max-debt-amount" className="block text-xs text-slate-400 mb-1">Most the client may owe *</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
              <input id="max-debt-amount" type="number" step="0.01" min="0.01" max={MAX_DEBT_LIMIT} value={amount} onChange={e => { setAmount(e.target.value.replace(/-/g, '')); setError(''); }} placeholder="e.g., 150.00"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-6 pr-2.5 py-1.5 text-white text-sm" required />
            </div>
          </div>
          <div>
            <label htmlFor="max-debt-expires" className="block text-xs text-slate-400 mb-1">Expiration Date *</label>
            <input id="max-debt-expires" type="date" min={getLocalDateString()} value={expires} onChange={e => { setExpires(e.target.value); setError(''); }}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm" required />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={closeForm} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">{saving ? 'Saving...' : 'Set Override'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
