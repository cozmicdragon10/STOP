import { useEffect, useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { getSessionTypes, saveSessionType } from '../../api';
import type { IndividualCategory, SessionType, SessionTypeKind } from '../../api';

interface Props {
  userEmail: string;
  // Only Business Administrators change the price list; everyone else sees it (the server checks too)
  canEdit: boolean;
  onSuccess: (message: string) => void;
}

interface EditState {
  id?: number;
  category: IndividualCategory;
  name: string;
  fee: string;
  active: boolean;
  kind: SessionTypeKind;
  bipOnly: boolean;
  soOnly: boolean;
  // Reinstate price from 6 months to a year after the intake
  lateFee: string;
}

const CATEGORIES: IndividualCategory[] = ['Assessment', 'Individual'];
const KINDS: { kind: SessionTypeKind; label: string }[] = [
  { kind: 'Standard', label: 'Standard' },
  { kind: 'BIP Intake', label: 'BIP intake (starts the reinstate clock)' },
  { kind: 'BIP Reinstate', label: 'BIP reinstate (priced by time since intake)' },
];
const NEW_PRICE: EditState = { category: 'Assessment', name: '', fee: '', active: true, kind: 'Standard', bipOnly: false, soOnly: false, lateFee: '' };
const validPrice = (v: string) => v !== '' && Number(v) >= 0;

// The assessment and individual session types and their prices, used by the Assessments & Individuals tab.
// Entries are deactivated rather than deleted so closed sessions keep their name.
export default function SessionPriceList({ userEmail, canEdit, onSuccess }: Props) {
  const [types, setTypes] = useState<SessionType[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    getSessionTypes().then(setTypes).catch(err => setError(err.message || 'Failed to load the price list.'));
  }, []);

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setError('Enter a name.'); return; }
    if (!validPrice(editing.fee)) { setError('Enter a price of $0.00 or more.'); return; }
    const reinstate = editing.kind === 'BIP Reinstate';
    if (reinstate && !validPrice(editing.lateFee)) { setError('Enter the price for a reinstate done 6 months to a year after the intake.'); return; }
    setSaving(true);
    setError('');
    try {
      const saved = await saveSessionType({
        ...editing, soOnly: editing.soOnly && editing.kind === 'Standard', name: editing.name.trim(), fee: Number(editing.fee), lateFee: reinstate ? Number(editing.lateFee) : null, user: userEmail,
      });
      setTypes(prev => (editing.id ? prev.map(t => (t.sessiontypeid === saved.sessiontypeid ? saved : t)) : [...prev, saved]));
      onSuccess(`${saved.category} "${saved.name}" saved.`);
      setEditing(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save the price list entry.');
    } finally {
      setSaving(false);
    }
  };

  const input = 'bg-slate-950 border border-slate-700 rounded p-2 text-white text-xs';
  const blockMinus = (e: React.KeyboardEvent) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4 lg:col-span-2">
      <div className="flex justify-between items-center gap-3 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-lg font-bold text-white">Assessment & Individual Prices</h2>
          <p className="text-xs text-slate-400 mt-0.5">The types and prices offered on the Assessments & Individuals tab.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="accent-blue-500" /> Show inactive
          </label>
          {canEdit && !editing && (
            <button type="button" onClick={() => { setError(''); setEditing(NEW_PRICE); }} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
              <PlusCircle size={14} /> Add Price
            </button>
          )}
        </div>
      </div>

      {!canEdit && <p className="text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded p-3">Only Business Administrators can change the price list.</p>}

      {editing && (
        <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-4 space-y-3">
          <p className="text-sm font-semibold text-white">{editing.id ? 'Edit Price' : 'New Price'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr_8rem] gap-2">
            <select value={editing.category} disabled={!!editing.id} onChange={e => setEditing({ ...editing, category: e.target.value as IndividualCategory, kind: 'Standard' })} className={`${input} disabled:opacity-50`} aria-label="Category">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="text" value={editing.name} maxLength={100} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder={editing.category === 'Assessment' ? 'e.g. Psychosexual Assessment' : 'e.g. 50-Minute Individual'} className={input} aria-label="Name" />
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
              <input type="number" step="0.01" min="0" value={editing.fee} onKeyDown={blockMinus} onChange={e => setEditing({ ...editing, fee: e.target.value.replace(/-/g, '') })} placeholder="0.00" className={`${input} w-full pl-6`} aria-label={editing.kind === 'BIP Reinstate' ? 'Price under 6 months after the intake' : 'Price'} />
            </div>
          </div>
          {editing.category === 'Assessment' && (
            <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-2 items-center">
              <label htmlFor="price-kind" className="text-xs text-slate-400">Kind</label>
              <select id="price-kind" value={editing.kind} onChange={e => setEditing({ ...editing, kind: e.target.value as SessionTypeKind })} className={input}>
                {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            </div>
          )}
          {editing.kind === 'BIP Reinstate' && (
            <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2 text-xs text-slate-400">
              <p>Priced by the time since the client's last BIP intake (any price list entry of kind BIP intake, such as BIP Intake or DV Assessment):</p>
              <p>· Under 6 months: <span className="text-white">${Number(editing.fee || 0).toFixed(2)}</span> (the price above)</p>
              <div className="flex items-center gap-2">
                <span>· 6 months to 1 year:</span>
                <div className="relative w-28">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                  <input type="number" step="0.01" min="0" value={editing.lateFee} onKeyDown={blockMinus} onChange={e => setEditing({ ...editing, lateFee: e.target.value.replace(/-/g, '') })} placeholder="0.00" className={`${input} w-full pl-6`} aria-label="Price 6 months to a year after the intake" />
                </div>
              </div>
              <p>· 1 year or more, or no intake on record: can't be done; a new BIP intake is needed.</p>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={editing.bipOnly || editing.kind !== 'Standard'} disabled={editing.kind !== 'Standard'} onChange={e => setEditing({ ...editing, bipOnly: e.target.checked, soOnly: e.target.checked ? false : editing.soOnly })} className="accent-blue-500 disabled:opacity-50" />
            BIP clients only{editing.kind !== 'Standard' && <span className="text-slate-500">(always, for BIP intakes and reinstates)</span>}
          </label>
          {/* BIP only and SO only can't both be set; checking one clears the other */}
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={editing.soOnly && editing.kind === 'Standard'} disabled={editing.kind !== 'Standard'} onChange={e => setEditing({ ...editing, soOnly: e.target.checked, bipOnly: e.target.checked ? false : editing.bipOnly })} className="accent-blue-500 disabled:opacity-50" />
            SO clients only <span className="text-slate-500">(State, Federal, and Voluntary SO)</span>
          </label>
          {editing.id && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} className="accent-blue-500" />
              Active (inactive prices can't be picked for new sessions)
            </label>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={save} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded text-xs">{saving ? 'Saving...' : 'Save'}</button>
            <button type="button" disabled={saving} onClick={() => { setEditing(null); setError(''); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold px-4 py-2 rounded text-xs">Cancel</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CATEGORIES.map(category => {
          const rows = types.filter(t => t.category === category && (showInactive || t.active)).sort((a, b) => a.name.localeCompare(b.name));
          return (
            <div key={category} className="space-y-2">
              <p className="text-xs text-slate-400 font-semibold uppercase">{category === 'Assessment' ? 'Assessments' : 'Individual Sessions'}</p>
              {rows.length === 0 && <p className="text-xs text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded p-3 text-center">None yet.</p>}
              {rows.map(t => (
                <div key={t.sessiontypeid} className={`bg-slate-950 border p-3 rounded flex justify-between items-center gap-3 text-xs ${editing?.id === t.sessiontypeid ? 'border-blue-500' : 'border-slate-800'}`}>
                  <div className="min-w-0">
                    <p className={`font-semibold truncate ${t.active ? 'text-white' : 'text-slate-500'}`}>{t.name}</p>
                    {(t.biponly || t.soonly || t.kind !== 'Standard') && (
                      <p className="text-[11px] text-slate-500 truncate">{[t.biponly && 'BIP only', t.soonly && 'SO only',t.kind === 'BIP Intake' && 'Starts reinstate clock', t.kind === 'BIP Reinstate' && 'Reinstate'].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!t.active && <span className="bg-slate-700/50 text-slate-400 px-2 py-0.5 rounded font-semibold">Inactive</span>}
                    <span className="text-emerald-400 font-semibold text-right">
                      ${Number(t.fee).toFixed(2)}
                      {t.kind === 'BIP Reinstate' && t.latefee !== null && <span className="block text-[11px] font-normal text-slate-400">${Number(t.latefee).toFixed(2)} after 6 mo.</span>}
                    </span>
                    {canEdit && (
                      <button type="button" onClick={() => { setError(''); setEditing({ id: t.sessiontypeid, category: t.category, name: t.name, fee: Number(t.fee).toFixed(2), active: t.active, kind: t.kind, bipOnly: t.biponly, soOnly: t.soonly, lateFee: t.latefee !== null ? Number(t.latefee).toFixed(2) : '' }); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded font-semibold">Edit</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
