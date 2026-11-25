import { useEffect, useState } from 'react';
import { getBipAbsences, submitClientCallIn } from '../../api';
import type { BipAbsence } from '../../api';
import { CALL_IN_REASONS } from '../../utils/notes';
import PopupDialog from '../home/PopupDialog';

interface Props {
  clientId: number;
  clientName: string;
  userEmail: string;
  // Business Administrators and DEV can excuse a BIP client's absence with this call-in
  canExcuse: boolean;
  // After the call-in is saved (the server adds it to Case Notes and the event log)
  onLogged: () => void;
  onClose: () => void;
}

// Logs a call-in for the client whose account is open (the Call-In button at the top of the account). Group call-ins
// are now handled by cancelling or rescheduling the meeting on the calendar.
export default function CallInDialog({ clientId, clientName, userEmail, canExcuse, onLogged, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // A BIP client's open absences, for excusing one (only loaded for those who can excuse)
  const [openAbsences, setOpenAbsences] = useState<BipAbsence[]>([]);
  const [excuseDate, setExcuseDate] = useState('');

  useEffect(() => {
    if (!canExcuse) return;
    let current = true;
    getBipAbsences(clientId)
      .then(status => { if (current && status.applies) setOpenAbsences(status.absences.filter(a => a.open)); })
      .catch(() => { /* the call-in still works without the excuse choice */ });
    return () => { current = false; };
  }, [canExcuse, clientId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!comment.trim()) return setError('Enter what the client reported.');
    setSaving(true);
    setError('');
    try {
      await submitClientCallIn({
        client: clientId, date: new Date(), comment: comment.trim(), createdBy: userEmail, reason: reason || null,
        excuseDate: excuseDate || null,
      });
      onLogged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not log the call-in. Check the server is running and try again.');
      setSaving(false);
    }
  };

  return (
    <PopupDialog title="Log a Call-In" subtitle={`${clientName}. Saved to their Case Notes and event log.`} busy={saving} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="callin-reason" className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Reason <span className="normal-case font-normal text-slate-500">(optional)</span></label>
          <select id="callin-reason" value={reason} onChange={e => setReason(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
            <option value="">No reason selected</option>
            {CALL_IN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {canExcuse && openAbsences.length > 0 && (
          <div>
            <label htmlFor="callin-excuse" className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Excuse an absence <span className="normal-case font-normal text-slate-500">(optional)</span></label>
            <select id="callin-excuse" value={excuseDate} onChange={e => setExcuseDate(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
              <option value="">Don't excuse anything</option>
              {openAbsences.map(a => <option key={a.date} value={a.date}>Missed {new Date(`${a.date}T00:00:00`).toLocaleDateString()}{a.threshold ? ' (threshold)' : ''}</option>)}
            </select>
            {excuseDate && <p className="text-xs text-amber-300 mt-1.5">The details below become the reason for the excuse. The absence stops counting toward the limits.</p>}
          </div>
        )}
        <div>
          <label htmlFor="callin-details" className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Details</label>
          <textarea id="callin-details" value={comment} onChange={e => { setComment(e.target.value); setError(''); }} rows={4} required placeholder="What did the client report?"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm placeholder-slate-500" />
        </div>
        {error && <p role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">Close</button>
          <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm">{saving ? 'Saving...' : 'Submit Call-In'}</button>
        </div>
      </form>
    </PopupDialog>
  );
}
