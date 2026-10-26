import { useCallback, useEffect, useState } from 'react';
import { PlusCircle, Trash2 } from 'lucide-react';
import { deleteOutsideBipAssessment, getClientProgress, recordOutsideBipAssessment } from '../../api';
import type { ClientProgress, CompletedAssessment } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';

interface Props {
  clientId: number;
  role?: string;
  userEmail: string;
  // Called after an outside assessment is recorded or removed, so group check-in sees the new status
  onChanged: () => void;
  onSuccess: (message: string) => void;
}

const ADMIN_ROLES = ['Business Administrator', 'Office Admin'];
const formatDay = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString();
const money = (v: string | number | null) => `$${Number(v || 0).toFixed(2)}`;
const EMPTY_FORM = { assessmentType: 'BIP Intake' as 'BIP Intake' | 'DV Assessment', assessmentDate: '', providerName: '', notes: '' };

const kindBadge = (a: CompletedAssessment) =>
  a.source === 'outside' ? 'Outside provider' : a.kind === 'BIP Intake' ? 'BIP intake' : a.kind === 'BIP Reinstate' ? 'BIP reinstate' : null;

// The client's Progress tab: every assessment on record (completed here, recorded from another provider, or still open),
// and for BIP clients whether they are cleared for group check-in plus recording a BIP Intake or DV Assessment done at
// another provider (administrators).
export default function ProgressTab({ clientId, role, userEmail, onChanged, onSuccess }: Props) {
  const [progress, setProgress] = useState<ClientProgress | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<typeof EMPTY_FORM | null>(null);
  const [saving, setSaving] = useState(false);
  const canRecord = ADMIN_ROLES.includes(role || '');

  const load = useCallback(() => {
    getClientProgress(clientId).then(setProgress).catch(err => setError(err.message || 'Failed to load the client\'s progress.'));
  }, [clientId]);
  useEffect(load, [load]);

  const save = async () => {
    if (!form) return;
    if (!form.assessmentDate) { setError('Enter the date the assessment was completed.'); return; }
    if (!form.providerName.trim()) { setError('Enter the provider that did the assessment.'); return; }
    setSaving(true);
    setError('');
    try {
      await recordOutsideBipAssessment(clientId, { ...form, providerName: form.providerName.trim(), notes: form.notes.trim(), user: userEmail });
      onSuccess(`Outside ${form.assessmentType} recorded.`);
      setForm(null);
      load();
      onChanged();
    } catch (err: any) {
      setError(err.message || 'Failed to record the outside assessment.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number, what: string) => {
    if (!window.confirm(`Remove the outside ${what}? If it is the client's only intake, they can't be checked into group until another is recorded.`)) return;
    try {
      await deleteOutsideBipAssessment(id, userEmail);
      onSuccess(`Outside ${what} removed.`);
      load();
      onChanged();
    } catch (err: any) {
      setError(err.message || 'Failed to remove the outside assessment.');
    }
  };

  const input = 'w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm';
  const card = 'bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4';

  if (!progress) {
    return error
      ? <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>
      : <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      {progress.isBip && (
        <div className={card}>
          <div className="flex justify-between items-center gap-3">
            <h3 className="text-xs font-bold uppercase text-blue-400 tracking-wider">BIP Group Clearance</h3>
            {canRecord && !form && (
              <button type="button" onClick={() => { setError(''); setForm(EMPTY_FORM); }} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5">
                <PlusCircle size={13} /> Record Outside Assessment
              </button>
            )}
          </div>

          {progress.block ? (
            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              {progress.block === 'intake'
                ? 'Not cleared for group: no BIP Intake or DV Assessment on record. Complete one on the Assessments & Individuals tab, or record one done at another provider.'
                : progress.block === 'our-intake'
                ? `Not cleared for group: discharged${progress.lastDischarge ? ` on ${formatDay(progress.lastDischarge)}` : ''} after an intake done at another provider. Complete our BIP Intake or DV Assessment on the Assessments & Individuals tab (a reinstate or another outside assessment won't clear them).`
                : `Not cleared for group: discharged${progress.lastDischarge ? ` on ${formatDay(progress.lastDischarge)}` : ''} and reactivated. Complete the BIP Reinstate assessment (or a new BIP Intake or DV Assessment) on the Assessments & Individuals tab.`}
            </p>
          ) : (
            <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">Cleared for group check-in.</p>
          )}

          {form && (
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
              <p className="text-sm font-semibold text-white">Assessment Completed at Another Provider</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="outside-type" className="block text-xs text-slate-400 uppercase mb-1">Assessment</label>
                  <select id="outside-type" value={form.assessmentType} onChange={e => setForm({ ...form, assessmentType: e.target.value as typeof form.assessmentType })} className={input}>
                    <option value="BIP Intake">BIP Intake</option>
                    <option value="DV Assessment">DV Assessment</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="outside-date" className="block text-xs text-slate-400 uppercase mb-1">Date Completed</label>
                  <input id="outside-date" type="date" max={todayLocal()} value={form.assessmentDate} onChange={e => setForm({ ...form, assessmentDate: e.target.value })} className={input} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="outside-provider" className="block text-xs text-slate-400 uppercase mb-1">Provider</label>
                  <input id="outside-provider" type="text" maxLength={255} value={form.providerName} onChange={e => setForm({ ...form, providerName: e.target.value })} placeholder="Agency or counselor that did the assessment" className={input} />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="outside-notes" className="block text-xs text-slate-400 uppercase mb-1">Notes <span className="normal-case text-slate-500">(optional)</span></label>
                  <textarea id="outside-notes" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={input} />
                </div>
              </div>
              <p className="text-xs text-slate-500">It counts as a completed intake for group check-in and starts the BIP Reinstate clock from its date.</p>
              <div className="flex gap-2">
                <button type="button" disabled={saving} onClick={save} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded text-xs">{saving ? 'Saving...' : 'Save'}</button>
                <button type="button" disabled={saving} onClick={() => { setForm(null); setError(''); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold px-4 py-2 rounded text-xs">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}

      {progress.open.length > 0 && (
        <div className={card}>
          <h3 className="text-xs font-bold uppercase text-blue-400 tracking-wider">Open Assessments</h3>
          <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg">
            {progress.open.map(o => (
              <li key={o.opensessionid} className="flex justify-between items-start gap-3 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <p className="text-white font-semibold">{o.name} <span className="ml-1 bg-amber-500/10 text-amber-300 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase">Open</span></p>
                  <p className="text-slate-400">{formatDay(o.date)}{o.provider ? ` · ${o.provider}` : ''}</p>
                </div>
                <span className="text-slate-400 shrink-0">Fee {money(o.fee)}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">Completed on the Assessments & Individuals tab.</p>
        </div>
      )}

      <div className={card}>
        <h3 className="text-xs font-bold uppercase text-blue-400 tracking-wider">Assessments</h3>
        {progress.completed.length === 0 ? (
          <p className="text-xs text-slate-500">No completed assessments.</p>
        ) : (
          <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg">
            {progress.completed.map(a => {
              const badge = kindBadge(a);
              return (
                <li key={`${a.source}-${a.id}`} className="flex justify-between items-start gap-3 px-3 py-2.5 text-xs">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-white font-semibold">
                      {a.name}
                      {badge && <span className="ml-2 bg-slate-700/50 text-slate-300 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase">{badge}</span>}
                    </p>
                    <p className="text-slate-400">{formatDay(a.date)}{a.provider ? ` · ${a.provider}` : ''}</p>
                    {a.notes && <p className="text-slate-500">{a.notes}</p>}
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    {a.source === 'here' && (
                      <span className="text-right text-slate-400">
                        Fee {money(a.fee)}
                        <span className="block">{Number(a.paid) > 0 ? `Paid ${money(a.paid)}${a.paymentmethod ? ` ${a.paymentmethod}` : ''}` : 'No payment'}</span>
                      </span>
                    )}
                    {a.source === 'outside' && role === 'Business Administrator' && (
                      <button type="button" onClick={() => remove(a.id, a.name)} className="text-slate-500 hover:text-red-400 p-1 rounded" aria-label={`Remove outside ${a.name} from ${formatDay(a.date)}`}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
