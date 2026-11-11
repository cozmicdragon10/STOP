import { useEffect, useState } from 'react';
import { getFederalUnitCodes, saveFederalUnitPrice } from '../../api';
import type { FederalUnitCode } from '../../api';

interface Props {
  userEmail: string;
  // Only Business Administrators change prices; everyone else sees them (the server checks too)
  canEdit: boolean;
  onSuccess: (message: string) => void;
}

const input = 'bg-slate-950 border border-slate-700 rounded p-2 text-white text-xs';
const blockMinus = (e: React.KeyboardEvent) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); };
const showPrice = (p: FederalUnitCode['price']) => (p === null || p === undefined || p === '' ? '—' : `$${Number(p).toFixed(2)}`);

// The federal billing codes, the client programs that track each one, and each code's price (blank until set)
export default function FederalUnitList({ userEmail, canEdit, onSuccess }: Props) {
  const [codes, setCodes] = useState<FederalUnitCode[]>([]);
  const [error, setError] = useState('');
  // The code being edited and its price as typed ('' = blank)
  const [editing, setEditing] = useState<{ code: string; price: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getFederalUnitCodes().then(setCodes).catch(err => setError(err.message || 'Failed to load the federal billing units.'));
  }, []);

  const save = async () => {
    if (!editing) return;
    if (editing.price !== '' && !(Number(editing.price) >= 0)) { setError('Enter a price of $0.00 or more, or leave it blank.'); return; }
    setSaving(true);
    setError('');
    try {
      const saved = await saveFederalUnitPrice({ code: editing.code, price: editing.price === '' ? null : Number(editing.price), user: userEmail });
      setCodes(prev => prev.map(c => (c.code === saved.code ? saved : c)));
      onSuccess(`${saved.code} ${saved.label} price ${saved.price === null ? 'cleared' : `saved: ${showPrice(saved.price)}`}.`);
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
        <h2 className="text-lg font-bold text-white">Billing Federal Units</h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Federal billing codes and their prices. Each client's units are entered on their account (Federal SO and Fed Drug Test clients).
        </p>
      </div>

      {!canEdit && <p className="text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded p-3">Only Business Administrators can change prices.</p>}
      {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {codes.map(c => {
          const isEditing = editing?.code === c.code;
          return (
            <div key={c.code} className={`bg-slate-950 border p-3 rounded text-xs flex flex-wrap justify-between items-center gap-3 ${isEditing ? 'border-blue-500' : 'border-slate-800'}`}>
              <div className="min-w-0">
                <p className="font-semibold text-white truncate"><span className="text-blue-400">{c.code}</span> {c.label}</p>
                <p className="text-[0.6875rem] text-slate-500 truncate">{c.programs.join(', ')}</p>
              </div>
              {isEditing && editing ? (
                <div className="flex items-center gap-2">
                  <div className="relative w-28">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                    <input type="number" step="0.01" min="0" autoFocus value={editing.price} onKeyDown={blockMinus} onChange={e => setEditing({ ...editing, price: e.target.value.replace(/-/g, '') })} placeholder="blank" className={`${input} w-full pl-6`} aria-label={`${c.code} ${c.label} price`} />
                  </div>
                  <button type="button" disabled={saving} onClick={save} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded">{saving ? 'Saving...' : 'Save'}</button>
                  <button type="button" disabled={saving} onClick={() => { setEditing(null); setError(''); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold px-3 py-1.5 rounded">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  <span className={c.price === null ? 'text-slate-500' : 'text-emerald-400 font-semibold'}>{showPrice(c.price)}</span>
                  {canEdit && (
                    <button type="button" onClick={() => { setError(''); setEditing({ code: c.code, price: c.price === null ? '' : Number(c.price).toFixed(2) }); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded font-semibold">Edit</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
