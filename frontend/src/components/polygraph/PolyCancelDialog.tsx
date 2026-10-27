import { useState } from 'react';
import { reopenPolygraphSlot } from '../../api';
import { POLY_CANCEL_NOTICE_HOURS, POLY_CANCEL_REASONS, polyVoucherReturnRule, slotStart } from '../../utils/polygraph';

interface Props {
  // The assigned slot being cancelled (as listed on the schedule)
  slot: { slotid: number; assignedClientName?: string | null; [key: string]: unknown };
  role: string;
  userEmail: string;
  onClose: () => void;
  // reopened is false when the appointment time had passed, so the slot was closed instead
  onCancelled: (reopened: boolean) => void;
  onError: (message: string) => void;
}

// Cancels a polygraph reservation. The reason can lock whether the poly fee vouchers go back to the client;
// a Business Administrator can override that lock.
export default function PolyCancelDialog({ slot, role, userEmail, onClose, onCancelled, onError }: Props) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [returnVouchers, setReturnVouchers] = useState(true);
  // Business Administrator override of the voucher return the cancellation reason would otherwise lock
  const [voucherOverride, setVoucherOverride] = useState(false);
  const [saving, setSaving] = useState(false);

  // A reservation cancelled after its appointment time closes the slot instead of reopening it (checked when opened)
  const [passed] = useState(() => {
    const start = slotStart(slot);
    return start !== null && start.getTime() <= Date.now();
  });

  const reasonRule = polyVoucherReturnRule(reason, slot);
  const voucherRule = voucherOverride ? null : reasonRule;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    setSaving(true);
    try {
      const res = await reopenPolygraphSlot(slot.slotid, { reason, notes, returnVouchers: voucherRule ?? returnVouchers, overrideVoucherRule: voucherOverride, user: userEmail });
      if (res?.error) {
        onError(res.error);
      } else {
        onCancelled(res.reopened !== false);
      }
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Failed to reopen slot.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md space-y-4 text-sm">
        <div>
          <h3 className="font-semibold text-white">Cancel Polygraph Reservation</h3>
          <p className="text-xs text-slate-400 mt-1">
            {slot.assignedClientName ? `${slot.assignedClientName} will be notified in their case notes.` : 'The slot will be reopened for new bookings.'}
          </p>
          {passed && (
            <p className="text-xs text-amber-400 mt-1">The appointment time has passed, so the slot will be closed instead of reopened.</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-slate-400 uppercase mb-1">Cancellation Reason *</label>
          <select required value={reason} onChange={(e) => { setReason(e.target.value); setVoucherOverride(false); }} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm">
            <option value="">Select a reason...</option>
            {POLY_CANCEL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 uppercase mb-1">Notes <span className="normal-case text-slate-500">(optional)</span></label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" placeholder="Add details for the case note..." />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <label className={`flex items-center gap-2 text-slate-200 ${voucherRule === null ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
              <input type="checkbox" checked={voucherRule ?? returnVouchers} disabled={voucherRule !== null} onChange={(e) => setReturnVouchers(e.target.checked)} className="accent-amber-500 disabled:opacity-60" />
              Poly Vouchers Return
            </label>
            {role === 'Business Administrator' && reasonRule !== null && (
              <button
                type="button"
                onClick={() => {
                  if (!voucherOverride) setReturnVouchers(reasonRule);
                  setVoucherOverride(!voucherOverride);
                }}
                className="text-xs font-semibold px-2 py-1 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
              >
                {voucherOverride ? 'Undo Override' : 'Override'}
              </button>
            )}
          </div>
          {reasonRule !== null && (
            <p className="text-xs text-slate-500 mt-1 ml-6">
              {voucherOverride
                ? 'Business Administrator override: the choice will be recorded in the case note.'
                : reason === 'Client requested cancellation'
                  ? `Locked: cancelled ${reasonRule ? 'more' : 'less'} than ${POLY_CANCEL_NOTICE_HOURS} hours before the appointment.`
                  : `Locked by the cancellation reason.`}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Keep Reservation</button>
          <button type="submit" disabled={saving || !reason} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold">{passed ? 'Cancel Reservation' : 'Cancel Reservation & Reopen'}</button>
        </div>
      </form>
    </div>
  );
}
