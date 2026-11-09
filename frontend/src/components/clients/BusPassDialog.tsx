import { useState } from 'react';
import { grantBusPass } from '../../api';
import type { ClientNote } from '../../api';

interface Props {
  clientId: number;
  clientName: string;
  busPasses: number;
  userEmail: string;
  onGranted: (busPasses: number, note: ClientNote) => void;
  onClose: () => void;
}

// Grants one of a federal client's bus passes: asks for the pass number, takes one off the count and adds a Bus Pass case note
export default function BusPassDialog({ clientId, clientName, busPasses, userEmail, onGranted, onClose }: Props) {
  const [number, setNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!number.trim()) { setError('Enter the bus pass number.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await grantBusPass(clientId, number.trim(), userEmail);
      onGranted(res.busPasses, res.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant the bus pass.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => !saving && onClose()}>
      <form
        role="dialog" aria-modal="true" aria-labelledby="bus-pass-title" onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4"
      >
        <div>
          <h3 id="bus-pass-title" className="text-lg font-bold text-white">Grant Bus Pass</h3>
          <p className="text-xs text-slate-400 mt-1">{clientName} has {busPasses} bus pass{busPasses === 1 ? '' : 'es'} to grant. A Bus Pass note is added to their account.</p>
        </div>
        <div>
          <label htmlFor="bus-pass-number" className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Bus Pass Number</label>
          <input
            id="bus-pass-number" type="text" autoFocus maxLength={50} value={number}
            onChange={e => { setNumber(e.target.value); setError(''); }}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
          />
        </div>
        {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold">Cancel</button>
          <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold">{saving ? 'Granting...' : 'Grant Bus Pass'}</button>
        </div>
      </form>
    </div>
  );
}
