import { Fragment, useState } from 'react';
import { setClientNoPolyRequired } from '../../api';
import { POLY_VOUCHER_MAX, polySchedulingNeeds, slotStart, slotSummary } from '../../utils/polygraph';
import { formatLogMonthDay, formatLogYear, localYmd, timeBetween } from '../../utils/dates';

/* eslint-disable @typescript-eslint/no-explicit-any -- client, slot, and polygraph rows are untyped throughout App */
interface Props {
  client: any;
  role: string;
  userEmail: string;
  // The client's polygraph results, newest first (loaded by App with the account)
  polygraphs: any[];
  // Every polygraph slot; open ones that haven't started are offered for scheduling
  slots: any[];
  // The slot this client is booked into, if any
  bookedSlot: any | null;
  examinerName: (email: string) => string;
  // Polygraph tab access: View Slot is shown only with it
  canViewSlot: boolean;
  onViewSlot: (slotId: number) => void;
  // Starts the shared booking flow (confirmation, payment, waiting-period prompts)
  onSchedule: (slotId: number, type: string, comment: string) => void;
  scheduling: boolean;
  // The page's error banner is hidden behind the account drawer, so errors are repeated under the form
  error: string;
  // No Poly Required was saved (App updates the client and reloads the case notes)
  onNoPolyRequiredSaved: (saved: boolean) => void;
  onError: (message: string) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const POLY_TYPES: [string, string][] = [
  ['Instant', 'Instant Poly'],
  ['Maintenance', 'Maintenance'],
  ['Sexual History', 'Sexual History'],
  ['Specific', 'Specific Issue'],
  ['Monitoring', 'Monitoring'],
];

// Schedule Polygraph form; shown only while the client isn't booked, so it starts empty again after a booking
function SchedulePolygraphForm({ openSlots, examinerName, onSchedule, scheduling, error }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openSlots: any[];
  examinerName: (email: string) => string;
  onSchedule: (slotId: number, type: string, comment: string) => void;
  scheduling: boolean;
  error: string;
}) {
  const [slotId, setSlotId] = useState('');
  const [type, setType] = useState('Maintenance');
  const [comment, setComment] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (slotId) onSchedule(Number(slotId), type, comment);
      }}
      className="grid grid-cols-1 md:grid-cols-2 gap-3"
    >
      <label className="md:col-span-2 text-xs text-slate-400">Open Slot
        <select value={slotId} onChange={(e) => setSlotId(e.target.value)} required className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-xs">
          <option value="">Choose a slot…</option>
          {openSlots.map(s => (
            <option key={s.slotid} value={s.slotid}>{slotSummary(s)} · {examinerName(s.polygrapher)}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-400">Poly Type
        <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-xs">
          {POLY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="text-xs text-slate-400">Comment <span className="text-slate-500">(optional)</span>
        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Added to the case note"
          className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-xs"
        />
      </label>
      {error && <p className="md:col-span-2 text-xs text-red-400">{error}</p>}
      <div className="md:col-span-2 flex justify-end">
        <button type="submit" disabled={scheduling || !slotId} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-semibold">
          Schedule
        </button>
      </div>
    </form>
  );
}

// The Polygraphs tab of a client's account: No Poly Required, scheduling or the booked slot, and the result history
export default function ClientPolygraphs({
  client, role, userEmail, polygraphs, slots, bookedSlot, examinerName, canViewSlot, onViewSlot, onSchedule, scheduling, error,
  onNoPolyRequiredSaved, onError,
}: Props) {
  // No Poly Required stays locked until a Business Administrator overrides it; each change is saved right away
  const [noPolyOverride, setNoPolyOverride] = useState(false);
  const [noPolySaving, setNoPolySaving] = useState(false);
  // Open slots are those not yet started when the tab was opened
  const [now] = useState(() => Date.now());

  const handleNoPolyRequiredChange = async (checked: boolean) => {
    setNoPolySaving(true);
    try {
      const saved = await setClientNoPolyRequired(client.clientid, checked, userEmail);
      setNoPolyOverride(false);
      onNoPolyRequiredSaved(saved);
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Failed to update No Poly Required.');
    } finally {
      setNoPolySaving(false);
    }
  };

  // Not booked: open slots that haven't started yet, soonest first
  const openSlots = slots
    .filter(s => s.status === 'Open' && (slotStart(s)?.getTime() ?? Infinity) > now)
    .sort((a, b) => (slotStart(a)?.getTime() ?? Infinity) - (slotStart(b)?.getTime() ?? Infinity));
  const needs = polySchedulingNeeds(client);

  return (
    <div className="space-y-3">
      <div className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <label className={`flex items-center gap-1.5 text-slate-200 whitespace-nowrap ${noPolyOverride && !noPolySaving ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
            <input
              type="checkbox"
              checked={!!client.nopolyrequired}
              disabled={!noPolyOverride || noPolySaving}
              onChange={e => handleNoPolyRequiredChange(e.target.checked)}
              className="accent-blue-500 disabled:opacity-60"
            />
            No Poly Required
          </label>
          <span className="text-slate-500 truncate">
            {noPolySaving
              ? 'Saving...'
              : noPolyOverride
                ? 'Override on: check or uncheck to save (recorded in case notes).'
                : 'Locked'}
          </span>
        </div>
        {role === 'Business Administrator' && (
          <button
            type="button"
            disabled={noPolySaving}
            onClick={() => setNoPolyOverride(o => !o)}
            className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
          >
            {noPolyOverride ? 'Cancel Override' : 'Override'}
          </button>
        )}
      </div>

      {!bookedSlot ? (
        <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Schedule Polygraph</p>
            <p className={`text-xs ${needs.met ? 'text-emerald-400' : 'text-amber-400'}`}>
              Vouchers {Number(client.polyfeevoucher ?? 0)}/{POLY_VOUCHER_MAX}
              {!needs.met && ' · payment needed before scheduling'}
            </p>
          </div>
          {role !== 'Business Administrator' ? (
            <p className="text-xs text-slate-400 italic">Only Business Administrators can assign polygraph slots to clients.</p>
          ) : openSlots.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No open polygraph slots are coming up. Add slots under Polygraphs › Poly Admin.</p>
          ) : (
            <SchedulePolygraphForm openSlots={openSlots} examinerName={examinerName} onSchedule={onSchedule} scheduling={scheduling} error={error} />
          )}
        </div>
      ) : (
        <div className="bg-blue-500/5 border border-blue-500/30 p-4 rounded-xl text-sm flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Scheduled Polygraph</p>
            <p className="text-white mt-0.5">{slotSummary(bookedSlot)}</p>
            <p className="text-xs text-slate-400 mt-0.5">Examiner: {examinerName(bookedSlot.polygrapher)}{bookedSlot.type ? ` · ${bookedSlot.type}` : ''}</p>
          </div>
          {canViewSlot && (
            <button type="button" onClick={() => onViewSlot(bookedSlot.slotid)} className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">View Slot</button>
          )}
        </div>
      )}

      {polygraphs.map((poly, i) => {
        // Gap to the previous card, by the polygraph date when one was recorded (the list is ordered the same way)
        const polyDay = (p: { polygraphdatetime?: string; date?: string }) => localYmd(p.polygraphdatetime || p.date);
        const prev = polygraphs[i - 1];
        const gap = prev && polyDay(prev) && polyDay(poly) ? timeBetween(polyDay(poly), polyDay(prev)) : null;
        // Above the newest polygraph: how long it has been since then
        const since = i === 0 && polyDay(poly) ? timeBetween(polyDay(poly), localYmd(new Date(now))) : null;
        const label = since
          ? (since === 'Same day' ? 'Last polygraph was today' : `${since} since last polygraph`)
          : gap && (gap === 'Same day' ? 'Same day' : `${gap} apart`);
        return (
          <Fragment key={poly.resultid}>
            {label && (
              <div className={`flex items-center gap-3 px-4 ${since ? '' : '-my-1'}`}>
                <div className="flex-1 border-t border-dashed border-slate-800" />
                <span className={`text-[11px] rounded-full px-2.5 py-0.5 whitespace-nowrap border ${since ? 'text-blue-300 bg-blue-500/10 border-blue-500/30 font-semibold' : 'text-slate-400 bg-slate-900 border-slate-800'}`}>{label}</span>
                <div className="flex-1 border-t border-dashed border-slate-800" />
              </div>
            )}
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex gap-5">
              <div className="shrink-0 w-28 flex flex-col justify-center border-r border-slate-800 pr-5">
                <p className="text-2xl font-bold text-white leading-tight">{formatLogMonthDay(poly.date)}</p>
                <p className="text-sm text-slate-400 mt-0.5">{formatLogYear(poly.date)}</p>
                {/* Date is when the result was recorded (no time is stored for it) */}
                <p className="text-xs text-slate-500 mt-1">Recorded</p>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start gap-3 font-semibold text-white">
                  <span>{poly.type} Polygraph</span>
                  <span className="text-xs text-emerald-400 text-right">{poly.results}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">Examiner: {examinerName(poly.polygrapher)}</p>
                <p className="text-xs text-slate-400 mt-1">
                  Polygraph Date:{' '}
                  <span className="text-slate-200">
                    {poly.polygraphdatetime
                      ? (() => { const d = new Date(poly.polygraphdatetime); return `${d.toLocaleDateString()} @ ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; })()
                      : 'Not recorded'}
                  </span>
                </p>
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
