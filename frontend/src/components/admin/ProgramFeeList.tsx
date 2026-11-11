import { useEffect, useState } from 'react';
import { getProgramFees, saveProgramFee } from '../../api';
import type { ProgramFee } from '../../api';
import { applyProgramFees } from '../../utils/soPhases';

interface Props {
  userEmail: string;
  // Only Business Administrators change prices; everyone else sees them (the server checks too)
  canEdit: boolean;
  onSuccess: (message: string) => void;
}

interface EditState {
  feekey: string;
  fee: string;
  // Also move current clients still on the old price to the new one
  applyToClients: boolean;
}

const input = 'bg-slate-950 border border-slate-700 rounded p-2 text-white text-xs';
const blockMinus = (e: React.KeyboardEvent) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); };

// The standard treatment fees: State SO / Voluntary SO per phase, and BIP. A client takes these when they're added or
// change phase or program; their own treatment fee can still be changed on their account.
export default function ProgramFeeList({ userEmail, canEdit, onSuccess }: Props) {
  const [fees, setFees] = useState<ProgramFee[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProgramFees().then(setFees).catch(err => setError(err.message || 'Failed to load the treatment fees.'));
  }, []);

  const save = async () => {
    if (!editing) return;
    if (editing.fee === '' || !(Number(editing.fee) >= 0)) { setError('Enter a price of $0.00 or more.'); return; }
    setSaving(true);
    setError('');
    try {
      const { fee, clientsUpdated } = await saveProgramFee({ ...editing, fee: Number(editing.fee), user: userEmail });
      setFees(prev => prev.map(f => (f.feekey === fee.feekey ? fee : f)));
      // New clients and phase changes on this screen pick up the new price right away
      applyProgramFees([fee]);
      onSuccess(`${fee.label} price saved: $${Number(fee.fee).toFixed(2)}.`
        + (editing.applyToClients ? ` ${clientsUpdated} client${clientsUpdated === 1 ? '' : 's'} moved to the new price.` : ''));
      setEditing(null);
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to save the price.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl space-y-4 lg:col-span-2">
      <div className="border-b border-slate-800 pb-3">
        <h2 className="text-lg font-bold text-white">Treatment Fees</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          The standard State SO (and Voluntary SO) price for each phase, and the BIP price. Clients get these when they're added
          or change phase; a client's own fee can still be changed on their account.
        </p>
      </div>

      {!canEdit && <p className="text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded p-3">Only Business Administrators can change prices.</p>}
      {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {fees.map(f => {
          const isEditing = editing?.feekey === f.feekey;
          return (
            <div key={f.feekey} className={`bg-slate-950 border p-3 rounded text-xs space-y-2 ${isEditing ? 'border-blue-500' : 'border-slate-800'}`}>
              <div className="flex justify-between items-center gap-3">
                <p className="font-semibold text-white truncate">{f.label}</p>
                {!isEditing && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-emerald-400 font-semibold">${Number(f.fee).toFixed(2)}</span>
                    {canEdit && (
                      <button type="button" onClick={() => { setError(''); setEditing({ feekey: f.feekey, fee: Number(f.fee).toFixed(2), applyToClients: false }); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded font-semibold">Edit</button>
                    )}
                  </div>
                )}
              </div>
              {isEditing && editing && (
                <>
                  <div className="relative w-32">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                    <input type="number" step="0.01" min="0" value={editing.fee} onKeyDown={blockMinus} onChange={e => setEditing({ ...editing, fee: e.target.value.replace(/-/g, '') })} className={`${input} w-full pl-6`} aria-label={`${f.label} price`} />
                  </div>
                  <label className="flex items-start gap-2 text-slate-300">
                    <input type="checkbox" checked={editing.applyToClients} onChange={e => setEditing({ ...editing, applyToClients: e.target.checked })} className="accent-blue-500 mt-0.5" />
                    <span>
                      Also change current {f.feekey === 'BIP' ? 'BIP clients' : `State SO and Voluntary SO clients in ${f.feekey}`} who
                      pay the old price (${Number(f.fee).toFixed(2)}). Clients with a different fee aren't changed.
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <button type="button" disabled={saving} onClick={save} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded text-xs">{saving ? 'Saving...' : 'Save'}</button>
                    <button type="button" disabled={saving} onClick={() => { setEditing(null); setError(''); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold px-4 py-2 rounded text-xs">Cancel</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
