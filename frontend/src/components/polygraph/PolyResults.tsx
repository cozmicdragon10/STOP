import { useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { deletePolygraphSlot, submitPolygraphResult } from '../../api';
import { POLY_INCENTIVE_OVERRIDE_RESULTS } from '../../utils/polygraph';
import { formatDisplayTime, getLocalDateString } from '../../utils/dates';

export interface AssignedPolySlot {
  slotid: number;
  assignedClientId?: number | string | null;
  assignedClientName?: string | null;
  type?: string | null;
  location?: string | null;
  date: string;
  time?: string;
  polygrapher?: string | null;
}

interface Props {
  // Assigned slots that pass the Polygraph tab's filters
  slots: AssignedPolySlot[];
  role: string;
  userEmail: string;
  examinerName: (email: string) => string;
  // Opens the cancellation prompt (shared with Poly Schedule)
  onCancelReservation: (slotId: number) => void;
  // Reload slots and clients after a result is saved
  onRecorded: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const RESULT_TYPES: [string, string][] = [
  ['No Deception Indicated', 'No Deception Indicated (NDI)'],
  ['Deception Indicated', 'Deception Indicated (DI)'],
  ['Inconclusive', 'Inconclusive (INC)'],
  ['No Opinion', 'No Opinion (NO)'],
  ['No Significant Response', 'No Significant Response (NSR)'],
];

// Poly Results: assigned appointments waiting on a result, and the form that records one and closes the slot
export default function PolyResults({ slots, role, userEmail, examinerName, onCancelReservation, onRecorded, onSuccess, onError }: Props) {
  // Kept by id, so the form closes on its own once the slot is cancelled, deleted, or filtered out
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = slots.find(s => s.slotid === selectedId) ?? null;
  const [resResultType, setResResultType] = useState('No Deception Indicated');
  // Incentive program continuation on an Inconclusive or No Opinion result: unchecked and locked unless a Business Administrator overrides
  const [resIncentiveContinued, setResIncentiveContinued] = useState(false);
  const [resIncentiveOverride, setResIncentiveOverride] = useState(false);
  const [resNotes, setResNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return onError('Please select an assigned polygraph slot first.');
    const clientId = Number(selected.assignedClientId);
    if (!(clientId > 0)) return onError('This slot has no assigned client, so the result cannot be recorded.');

    setSaving(true);
    try {
      const res = await submitPolygraphResult({
        client: clientId,
        date: getLocalDateString(),
        type: selected.type || 'Maintenance',
        results: resResultType,
        polygrapher: selected.polygrapher || userEmail,
        notes: resNotes,
        // The server reads the polygraph's date and time from the slot
        slotId: selected.slotid,
        incentiveContinued: POLY_INCENTIVE_OVERRIDE_RESULTS.includes(resResultType) && resIncentiveOverride && resIncentiveContinued,
        user: userEmail
      });
      // Keep the slot unless the result was saved, so nothing is lost
      if (res?.error) throw new Error(res.error);
      await deletePolygraphSlot(selected.slotid);

      setSelectedId(null);
      setResNotes('');
      setResIncentiveContinued(false);
      setResIncentiveOverride(false);
      onSuccess('Polygraph result recorded and slot removed permanently!');
      onRecorded();
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Error completing polygraph slot.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-blue-400">Assigned Polygraph Appointments Pending Results</h3>
        <p className="text-xs text-slate-400 mt-0.5">Select an assigned client appointment to complete and record test results.</p>
      </div>

      {slots.length === 0 ? (
        <div className="bg-slate-950 border border-slate-800 p-8 rounded-xl text-center">
          <CheckCircle2 size={32} className="mx-auto text-slate-600 mb-2" />
          <p className="text-slate-400 text-sm">No assigned polygraph appointments pending results.</p>
          <p className="text-xs text-slate-500 mt-1">Assign clients to open slots under the Poly Schedule tab first.</p>
        </div>
      ) : (
        <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <th className="p-3">Client</th>
                <th className="p-3">Type</th>
                <th className="p-3">Location</th>
                <th className="p-3">Scheduled</th>
                <th className="p-3">Examiner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {slots.map(slot => (
                <tr
                  key={slot.slotid}
                  onClick={() => { setSelectedId(slot.slotid); setResIncentiveContinued(false); setResIncentiveOverride(false); }}
                  className={`transition cursor-pointer ${selectedId === slot.slotid ? 'bg-blue-500/10' : 'hover:bg-slate-800/50'}`}>
                  <td className="p-3 font-medium text-white">{slot.assignedClientName}</td>
                  <td className="p-3"><span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded text-xs">{slot.type || 'Polygraph'}</span></td>
                  <td className="p-3 text-slate-400">{slot.location}</td>
                  <td className="p-3 text-slate-300">{new Date(slot.date).toLocaleDateString()} @ {formatDisplayTime(slot.time)}</td>
                  <td className="p-3 text-slate-300">{examinerName(slot.polygrapher || '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <form onSubmit={handleSubmit} className="bg-slate-950 border border-blue-500/40 p-6 rounded-xl space-y-4 max-w-2xl mt-6">
          <div className="border-b border-slate-800 pb-3 flex justify-between items-center">
            <h4 className="font-bold text-white">Record Results for {selected.assignedClientName}</h4>
            <span className="text-xs text-slate-400">{selected.type} Exam</span>
          </div>

          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Polygraph Examination Result</label>
            <select value={resResultType} onChange={(e) => { setResResultType(e.target.value); setResIncentiveContinued(false); setResIncentiveOverride(false); }} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
              {RESULT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>

          {POLY_INCENTIVE_OVERRIDE_RESULTS.includes(resResultType) && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className={`flex items-center gap-2 text-sm text-slate-200 ${resIncentiveOverride ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                  <input type="checkbox" checked={resIncentiveOverride && resIncentiveContinued} disabled={!resIncentiveOverride} onChange={(e) => setResIncentiveContinued(e.target.checked)} className="accent-blue-500 disabled:opacity-60" />
                  Incentive Program Continuation
                </label>
                {role === 'Business Administrator' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (resIncentiveOverride) setResIncentiveContinued(false);
                      setResIncentiveOverride(!resIncentiveOverride);
                    }}
                    className="text-xs font-semibold px-2 py-1 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                  >
                    {resIncentiveOverride ? 'Undo Override' : 'Override'}
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1 ml-6">
                {resIncentiveOverride
                  ? 'Business Administrator override: checked keeps the client earning poly fee vouchers as if the result were NDI.'
                  : `Locked unchecked for ${resResultType} results.`}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Examiner Clinical Notes & Observations</label>
            <textarea value={resNotes} onChange={(e) => setResNotes(e.target.value)} placeholder="Type examiner notes and exam observations..." rows={4} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">
              Save Polygraph Result & Close Slot
            </button>
            <button
              type="button"
              onClick={() => onCancelReservation(selected.slotid)}
              className="bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition">
              <RotateCcw size={15} /> Cancel Reservation & Reopen
            </button>
            <button type="button" onClick={() => setSelectedId(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 rounded-lg text-sm">
              Close
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
