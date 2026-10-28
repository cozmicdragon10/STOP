import { useState } from 'react';
import { deletePolyFeeOverride, savePolyFeeOverride } from '../../api';
import type { PolyFeeOverride, PolyFeeOverrideResult } from '../../api';
import { polyVoucherMax } from '../../utils/polygraph';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client rows are untyped throughout App
  client: any;
  role: string;
  userEmail: string;
  // The active override (loaded by App with the account), or null
  override: PolyFeeOverride | null;
  // Shown when App couldn't load the override
  loadError: string;
  // Saved or removed: the new override (or null) and the poly fee figures the change moved
  onChanged: (override: PolyFeeOverride | null, result: PolyFeeOverrideResult) => void;
  onSuccess: (message: string) => void;
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// Temporary Poly Fee Override (Business Administrators change it): a reduced poly fee for a number of fills, not a date
export default function PolyFeeOverridePanel({ client, role, userEmail, override, loadError, onChanged, onSuccess }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [feeInput, setFeeInput] = useState('');
  const [fillsInput, setFillsInput] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = role === 'Business Administrator';

  const toggleForm = () => {
    setShowForm(!showForm);
    setError('');
    setFeeInput(override ? Number(override.reducedfee).toFixed(2) : '');
    setFillsInput(override ? String(override.fillsallowed) : '1');
  };

  const handleRemove = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await deletePolyFeeOverride(client.clientid, userEmail);
      onChanged(null, res);
      setShowForm(false);
      onSuccess(`Poly fee override removed. Poly fee is back to $${Number(res.polyFee).toFixed(2)}.`
        + (res.vouchersRemoved ? ` ${res.vouchersRemoved} poly fee voucher(s) removed because the poly fee is no longer paid in full.` : ''));
    } catch (err) {
      setError(errorText(err, 'Failed to remove the poly fee override.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const fee = Number(feeInput);
    const fills = Number(fillsInput);
    if (feeInput === '' || !(fee >= 0) || !Number.isInteger(fills) || fills < 1) {
      setError('Enter a reduced poly fee and how many fills it applies to.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await savePolyFeeOverride(client.clientid, { reducedFee: fee, fills, user: userEmail });
      onChanged(res.override ?? null, res);
      setShowForm(false);
      onSuccess(`Poly fee set to $${fee.toFixed(2)} for ${fills} fill${fills === 1 ? '' : 's'}.`
        + (res.vouchersAdded ? ' What the client has already paid covers it, so the poly fee vouchers were filled.' : '')
        + (res.vouchersRemoved ? ` ${res.vouchersRemoved} poly fee voucher(s) removed because the poly fee is no longer paid in full.` : ''));
    } catch (err) {
      setError(errorText(err, 'Failed to save the poly fee override.'));
    } finally {
      setSaving(false);
    }
  };

  const shownError = error || loadError;

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-xs font-bold uppercase text-blue-400 tracking-wider">Temporary Poly Fee Override</h3>
        {isAdmin && (
          <button type="button" onClick={toggleForm} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
            {showForm ? 'Cancel' : override ? 'Change Poly Fee Override' : 'Set Poly Fee Override'}
          </button>
        )}
      </div>

      {override ? (
        <div className="bg-slate-900 border border-emerald-500/30 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500 mb-1">Reduced Poly Fee</p>
              <p className="text-white font-semibold text-lg">${Number(override.reducedfee).toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-0.5">Regular poly fee: ${Number(override.regularfee).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Fills Used</p>
              <p className="text-white font-semibold text-lg">{override.fillsused} of {override.fillsallowed}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {Number(override.fillsused) >= Number(override.fillsallowed)
                  ? 'Last fill granted; the regular fee returns when its vouchers are used to schedule a polygraph.'
                  : `${Number(override.fillsallowed) - Number(override.fillsused)} more fill(s) at the reduced fee.`}
              </p>
            </div>
          </div>
          {isAdmin && (
            <button
              type="button"
              disabled={saving}
              onClick={handleRemove}
              className="mt-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-lg text-xs font-semibold w-full disabled:opacity-50"
            >
              Remove Override
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400">No poly fee override is active. Regular poly fee applies: ${Number(client.polyfee ?? 250).toFixed(2)}</p>
      )}

      {shownError && <p className="text-xs text-red-400 mt-2">{shownError}</p>}

      {showForm && isAdmin && (
        <form onSubmit={handleSave} className="space-y-3 border-t border-slate-800 pt-4 mt-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Reduced Poly Fee *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={feeInput}
                onChange={(e) => setFeeInput(e.target.value)}
                placeholder="e.g., 150.00"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Number of Fills *</label>
              <input
                type="number"
                step="1"
                min={Math.max(1, Number(override?.fillsused ?? 0))}
                max={20}
                value={fillsInput}
                onChange={(e) => setFillsInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                required
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            A fill is the poly fee being paid in full, which fills the client's full set of {polyVoucherMax(client.phase)} poly fee vouchers. The reduced fee applies until the last fill's vouchers
            are used to schedule a polygraph; then the regular fee (${Number(override?.regularfee ?? client.polyfee ?? 250).toFixed(2)}) returns.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(''); }}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
            >
              Set Override
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
