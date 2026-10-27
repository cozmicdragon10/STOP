import { Fragment } from 'react';
import ClientPaymentDialog from '../payments/ClientPaymentDialog';
import type { PolyAssignment } from '../../hooks/usePolyAssignment';
import { formatDisplayTime } from '../../utils/dates';
import { POLY_VOUCHER_MAX, polySchedulingNeeds } from '../../utils/polygraph';

/* eslint-disable @typescript-eslint/no-explicit-any -- slot and client rows are untyped throughout App */
interface Props {
  assignment: PolyAssignment;
  slots: any[];
  clients: any[];
  userEmail: string;
  examinerName: (email: string) => string;
  // A client's account is open: the payment prompt then points at its Schedule button
  accountOpen: boolean;
  // A payment from the prompt changed this client's balance and poly fee figures
  onClientUpdated: (client: any) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// The polygraph assignment prompts: confirm the booking, bypass the post-NDI waiting period (Business
// Administrators), and take the payment a client needs before booking. Rendered outside the Polygraph tab so they
// also open over a client's account.
export default function PolyAssignDialogs({ assignment: a, slots, clients, userEmail, examinerName, accountOpen, onClientUpdated, onSuccess, onError }: Props) {
  const pendingSlotId = a.pendingSlotId;
  return (
    <>
      {pendingSlotId !== null && (() => {
        const pendingSlot = slots.find(s => s.slotid === pendingSlotId);
        const pendingClient = clients.find(c => String(c.clientid) === a.choices.clientOf(pendingSlotId));
        const pendingComment = a.choices.commentOf(pendingSlotId).trim();
        const details: [string, string][] = [
          ['Client', pendingClient ? `${pendingClient.lastname}, ${pendingClient.firstname}` : 'Not selected'],
          ['Poly Type', a.choices.typeOf(pendingSlotId)],
          ['Location', pendingSlot?.location || '—'],
          ['Address', pendingSlot?.address || 'Not set'],
          ['Date', pendingSlot ? `${new Date(pendingSlot.date).toLocaleDateString()} @ ${formatDisplayTime(pendingSlot.time)}` : '—'],
          ['Examiner', pendingSlot ? examinerName(pendingSlot.polygrapher) : '—'],
        ];
        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md space-y-4 text-sm">
              <div>
                <h3 className="font-semibold text-white">Confirm Polygraph Assignment</h3>
                <p className="text-xs text-slate-400 mt-1">Review the details below. This will be added to the client's case notes.</p>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                {details.map(([label, value]) => (
                  <Fragment key={label}>
                    <dt className="text-slate-400 uppercase">{label}</dt>
                    <dd className={label === 'Client' ? 'text-emerald-400 font-semibold' : 'text-slate-200'}>{value}</dd>
                  </Fragment>
                ))}
                {pendingComment && (
                  <>
                    <dt className="text-slate-400 uppercase">Comment</dt>
                    <dd className="text-slate-200 whitespace-pre-wrap">{pendingComment}</dd>
                  </>
                )}
              </dl>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => a.setPendingSlotId(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Go Back</button>
                <button
                  type="button"
                  disabled={a.saving}
                  onClick={async () => {
                    a.setPendingSlotId(null);
                    await a.assign(pendingSlotId);
                  }}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold">
                  Accept & Assign
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {a.waitBypassPrompt && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="wait-bypass-title">
          <div className="bg-slate-900 border border-amber-500/40 rounded-xl p-6 w-full max-w-md space-y-4 text-sm">
            <div>
              <h3 id="wait-bypass-title" className="font-semibold text-white">Bypass Polygraph Waiting Period?</h3>
              <p className="text-xs text-slate-400 mt-1">
                <span className="text-emerald-400 font-semibold">{a.waitBypassPrompt.clientName}</span>'s last polygraph
                ({a.waitBypassPrompt.lastPolyDate}) was No Deception Indicated. The next one normally cannot be before {a.waitBypassPrompt.earliestDate} (5 months and 2 weeks).
              </p>
            </div>
            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              As a Business Administrator you can schedule this polygraph anyway. The override is recorded in the client's case notes and the system log.
            </p>
            <label className="flex items-start gap-2.5 cursor-pointer text-slate-200">
              <input
                type="checkbox"
                checked={a.waitBypassConfirmed}
                onChange={e => a.setWaitBypassConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-amber-500"
              />
              <span>I confirm I want to schedule this polygraph before {a.waitBypassPrompt.earliestDate}, bypassing the waiting period.</span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => a.setWaitBypassPrompt(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Cancel</button>
              <button
                type="button"
                disabled={!a.waitBypassConfirmed || a.saving}
                onClick={async () => {
                  const { slotId } = a.waitBypassPrompt!;
                  a.setWaitBypassPrompt(null);
                  await a.assign(slotId, true);
                }}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-semibold"
              >
                Bypass &amp; Assign
              </button>
            </div>
          </div>
        </div>
      )}

      {a.paymentPrompt && (
        <ClientPaymentDialog
          client={a.paymentPrompt.client}
          balance={Number(a.paymentPrompt.client.accountbalance) || 0}
          noteLabel="Poly fee payment"
          initialAmount={a.paymentPrompt.amountDue}
          initialApplyToPolyFee={polySchedulingNeeds(a.paymentPrompt.client).polyDue > 0}
          lockApplyToPolyFee
          notice={a.paymentPrompt.notice}
          createdBy={userEmail}
          onClose={() => a.setPaymentPrompt(null)}
          onSuccess={onSuccess}
          onError={onError}
          onProcessed={(newBalance, polyFeePaid, polyFeeVoucher) => {
            const updated = { ...a.paymentPrompt!.client, accountbalance: newBalance, polyfeepaid: polyFeePaid, polyfeevoucher: polyFeeVoucher };
            onClientUpdated(updated);
            if (polySchedulingNeeds(updated).met) {
              onSuccess(`${POLY_VOUCHER_MAX}/${POLY_VOUCHER_MAX} poly fee vouchers and the account is paid up. Click ${accountOpen ? 'Schedule' : 'Confirm & Assign Slot'} to schedule.`);
            }
          }}
        />
      )}
    </>
  );
}
