import { useState } from 'react';
import { reschedulePolygraphSlot } from '../../api';
import { getLocalDateString, getLocalTimeString } from '../../utils/dates';
import { POLY_RESCHEDULE_REASONS, slotStart, slotSummary } from '../../utils/polygraph';

interface Employee {
  employeeemail: string;
  displayname: string | null;
  role: string;
  active?: boolean | null;
}

interface Props {
  // The open or assigned slot being moved (as listed on the schedule)
  slot: { slotid: number; date: string; time?: string; location?: string | null; address?: string | null; polygrapher?: string | null; assignedClientName?: string | null };
  role: string;
  userEmail: string;
  employees: Employee[];
  examinerName: (email: string) => string;
  onClose: () => void;
  onRescheduled: (message: string) => void;
}

// Moves a slot to a new date, time, examiner or location. A booked client stays on it and keeps the vouchers used.
export default function PolyRescheduleDialog({ slot, role, userEmail, employees, examinerName, onClose, onRescheduled }: Props) {
  const booked = !!slot.assignedClientName;
  // A slot whose time has passed starts with no date, so the old one can't be sent back by accident
  const [date, setDate] = useState(() => {
    const start = slotStart(slot);
    return start && start.getTime() > Date.now() ? slot.date.split('T')[0] : '';
  });
  const [time, setTime] = useState((slot.time || '').slice(0, 5));
  const [examiner, setExaminer] = useState(slot.polygrapher || '');
  const [location, setLocation] = useState(slot.location || '');
  const [address, setAddress] = useState(slot.address || '');
  const [reason, setReason] = useState(POLY_RESCHEDULE_REASONS[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Set when the new date is inside the post-NDI waiting period
  const [waitPrompt, setWaitPrompt] = useState<{ lastPolyDate: string; earliestDate: string } | null>(null);
  const [waitBypassConfirmed, setWaitBypassConfirmed] = useState(false);

  const today = getLocalDateString();
  // The current examiner stays listed even if they have since been deactivated
  const examiners = employees.filter(e => e.role === 'Polygrapher' && (e.active !== false || e.employeeemail === slot.polygrapher));
  const needsBypass = waitPrompt !== null && role === 'Business Administrator';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await reschedulePolygraphSlot(slot.slotid, {
        date, time, polygrapher: examiner, location, address, reason: booked ? reason : '', notes,
        bypassWaitPeriod: waitPrompt !== null && waitBypassConfirmed, user: userEmail,
      });
      if (res.success) return onRescheduled(res.message);
      if (res.code === 'POLY_TOO_SOON') setWaitPrompt({ lastPolyDate: res.lastPolyDate, earliestDate: res.earliestDate });
      setError(res.error);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to reschedule the slot.');
    } finally {
      setSaving(false);
    }
  };

  const clearWaitPrompt = () => {
    setWaitPrompt(null);
    setWaitBypassConfirmed(false);
    setError('');
  };

  const fieldClass = 'w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm';
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="poly-reschedule-title">
      <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-lg max-h-full overflow-y-auto space-y-4 text-sm">
        <div>
          <h3 id="poly-reschedule-title" className="font-semibold text-white">Reschedule Polygraph Slot</h3>
          <p className="text-xs text-slate-400 mt-1">Currently {slotSummary(slot)} with {examinerName(slot.polygrapher || '')}.</p>
          {booked && (
            <p className="text-xs text-slate-400 mt-1">
              <span className="text-emerald-400 font-semibold">{slot.assignedClientName}</span> stays booked and keeps their vouchers. The change is added to their case notes.
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">New Date *</label>
            <input type="date" required min={today} value={date} onChange={(e) => { setDate(e.target.value); clearWaitPrompt(); }} className={`${fieldClass} [color-scheme:dark]`} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">New Time *</label>
            <input type="time" required min={date === today ? getLocalTimeString() : undefined} value={time} onChange={(e) => setTime(e.target.value)} className={`${fieldClass} [color-scheme:dark]`} />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 uppercase mb-1">Examiner *</label>
          <select required value={examiner} onChange={(e) => setExaminer(e.target.value)} className={fieldClass}>
            <option value="">-- Choose Examiner --</option>
            {examiners.map(e => <option key={e.employeeemail} value={e.employeeemail}>{e.displayname} ({e.employeeemail})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Office Location *</label>
            <input type="text" required value={location} onChange={(e) => setLocation(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase mb-1">Address</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={fieldClass} />
          </div>
        </div>
        {booked && (
          <>
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-1">Reason *</label>
              <select required value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass}>
                {POLY_RESCHEDULE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <p className="text-xs text-slate-500 mt-1">If the client asked to move it, cancel the reservation instead so the voucher rule applies.</p>
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-1">Notes <span className="normal-case text-slate-500">(optional)</span></label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={fieldClass} placeholder="Add details for the case note..." />
            </div>
          </>
        )}
        {error && <p role="alert" className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">{error}</p>}
        {needsBypass && (
          <label className="flex items-start gap-2.5 cursor-pointer text-slate-200 text-xs">
            <input type="checkbox" checked={waitBypassConfirmed} onChange={(e) => setWaitBypassConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-500" />
            <span>I confirm I want to move this polygraph before {waitPrompt.earliestDate}, bypassing the waiting period. The override is recorded in the case notes and the system log.</span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Go Back</button>
          <button type="submit" disabled={saving || (needsBypass && !waitBypassConfirmed)} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold">
            {saving ? 'Saving...' : 'Reschedule'}
          </button>
        </div>
      </form>
    </div>
  );
}
