import { useState } from 'react';
import { deleteClientFeeOverride, saveClientFeeOverride } from '../../api';
import { getLocalDateString, parseLogDate } from '../../utils/dates';

/* eslint-disable @typescript-eslint/no-explicit-any -- client and override rows are untyped throughout App */
interface Props {
  client: any;
  role: string;
  userEmail: string;
  // The active override (loaded by App with the account), or null
  override: any | null;
  // Saved or removed (null); App keeps it and reloads the roster, which shows the reduced fee
  onChanged: (override: any | null) => void;
  onSuccess: (message: string) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// Temporary Fee Override (Business Administrators change it): a reduced treatment fee through an expiration date
export default function TempFeeOverridePanel({ client, role, userEmail, override, onChanged, onSuccess }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [feeInput, setFeeInput] = useState('');
  const [expires, setExpires] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isAdmin = role === 'Business Administrator';

  const closeForm = () => {
    setShowForm(false);
    setFeeInput('');
    setExpires('');
  };

  const handleRemove = async () => {
    setSaving(true);
    setError('');
    try {
      await deleteClientFeeOverride(client.clientid, userEmail);
      onChanged(null);
      onSuccess('Temporary fee override removed. Regular fee will apply.');
    } catch (err) {
      setError(errorText(err, 'Failed to remove fee override.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (feeInput === '' || !expires) {
      setError('Please enter a reduced fee and expiration date.');
      return;
    }
    if (expires < getLocalDateString()) {
      setError('The expiration date cannot be in the past.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await saveClientFeeOverride(client.clientid, Number(feeInput), expires, userEmail);
      onChanged(result.override);
      onSuccess(`Temporary fee set to $${Number(feeInput).toFixed(2)} through ${parseLogDate(expires)?.toLocaleDateString()}.`);
      closeForm();
    } catch (err) {
      setError(errorText(err, 'Failed to set fee override.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-xs font-bold uppercase text-blue-400 tracking-wider">Temporary Fee Override</h3>
        {isAdmin && (
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : setShowForm(true))}
            className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
          >
            {showForm ? 'Cancel' : override ? 'Change Temporary Fee' : 'Set Temporary Fee'}
          </button>
        )}
      </div>

      {override ? (
        <div className="bg-slate-900 border border-emerald-500/30 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500 mb-1">Reduced Fee</p>
              <p className="text-white font-semibold text-lg">${Number(override.reducedfee).toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-0.5">Regular fee: ${Number(client.treatmentfee || 0).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Expires (last day at reduced rate)</p>
              {/* DATE columns arrive as an ISO timestamp; keep only the date part so it isn't shifted a day by time zones */}
              <p className="text-white font-semibold">{parseLogDate(String(override.expirationdate).split('T')[0])?.toLocaleDateString()}</p>
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
        <p className="text-xs text-slate-400">No temporary fee override is active. Regular fee applies: ${Number(client.treatmentfee || 0).toFixed(2)}</p>
      )}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      {showForm && isAdmin && (
        <form onSubmit={handleSave} className="space-y-3 border-t border-slate-800 pt-4 mt-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reduced Fee Amount *</label>
            <input
              type="number"
              step="0.01"
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value)}
              placeholder="e.g., 90.00"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Expiration Date *</label>
            <input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
              required
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeForm}
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
