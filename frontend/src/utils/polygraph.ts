import { formatDisplayTime, localYmd, timeBetween, toLocalDay } from './dates';
import { POLY_VOUCHER_MAX_BY_PHASE } from './soPhases';
import { FEDERAL_PROGRAM_TYPES, federalPolyNeeds } from './clients';

export const POLY_OVERDUE_MONTHS = 6;

// The fields of a polygraph result and of a slot these helpers read
type PolygraphTaken = { polygraphdatetime?: string | null; date?: string | null };
type SlotTime = { date?: string | null; time?: string | null } | null | undefined;

// BIP, Fed Drug Test and Chaperon clients don't take polygraphs, so they have no polygraph notices, poly fee or bookings.
// Mirrors NO_POLY_PROGRAM_TYPES in backend/routes/polygraphs.js.
export const NO_POLY_PROGRAM_TYPES = ['BIP', 'Fed Drug Test', 'Chaperon'];
export const takesPolygraphs = (programtype?: string | null) => !NO_POLY_PROGRAM_TYPES.includes(programtype ?? '');

// When the client's most recent polygraph was taken: the actual polygraph date, falling back to the recorded date for older results without one
export const lastPolygraphTaken = (polygraphs: PolygraphTaken[]): Date | null => {
  const taken = polygraphs
    .map(p => p.polygraphdatetime ? new Date(p.polygraphdatetime) : p.date ? toLocalDay(p.date) : null)
    .filter((d): d is Date => !!d && !isNaN(d.getTime()));
  return taken.length ? new Date(Math.max(...taken.map(d => d.getTime()))) : null;
};
export const isPolygraphOverdue = (last: Date, today = new Date()) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate()) >= new Date(last.getFullYear(), last.getMonth() + POLY_OVERDUE_MONTHS, last.getDate());
// For a client booked into a polygraph: how long since their last one, or that they haven't taken one yet
export const polygraphHistoryText = (polygraphs: PolygraphTaken[], today = new Date()) => {
  const last = lastPolygraphTaken(polygraphs);
  if (!last) return 'No polygraph taken yet.';
  const since = timeBetween(localYmd(last), localYmd(today));
  return `${since === 'Same day' ? 'Last polygraph was today' : `${since} since last polygraph`} (${last.toLocaleDateString()})${isPolygraphOverdue(last, today) ? ', overdue' : ''}.`;
};
// Red polygraph notice for a client's account, or null when none applies (none for programs that don't take polygraphs)
export const polygraphNotice = (
  client: { programtype?: string | null; nopolyrequired?: boolean | null; lastdateattended?: string | null },
  polygraphs: PolygraphTaken[],
  today = new Date()) => {
  if (!takesPolygraphs(client.programtype) || client.nopolyrequired) return null;
  const last = lastPolygraphTaken(polygraphs);
  if (last) {
    return isPolygraphOverdue(last, today) ? 'Client is overdue for their next Polygraph' : null;
  }
  // Shown once the client has attended
  if (!client.lastdateattended) return null;
  return "Client hasn't taken their first polygraph yet";
};
// The same notice for a Client Roster row, which carries only its last polygraph's date (lastpoly) and last attendance
export const rosterPolygraphNotice = (
  client: { programtype?: string | null; nopolyrequired?: boolean | null; lastpoly?: string | null; lastattended?: string | null; lastdateattended?: string | null },
  today = new Date()) =>
  polygraphNotice(
    { programtype: client.programtype, nopolyrequired: client.nopolyrequired, lastdateattended: client.lastattended ?? client.lastdateattended },
    client.lastpoly ? [{ date: client.lastpoly }] : [],
    today);

// A client's poly fee voucher runs 0 to this; the server fills it when the poly fee is paid in full
export const POLY_VOUCHER_MAX = 6;

// A client's full set of vouchers for their phase (smaller for quarterly and semi-annual clients): what they earn up to,
// what paying the poly fee in full fills them to, and what scheduling needs and uses. Mirrors polyVoucherMax in backend/lib/poly.js.
export const polyVoucherMax = (phase?: string | null): number => POLY_VOUCHER_MAX_BY_PHASE[phase ?? ''] ?? POLY_VOUCHER_MAX;

// To be scheduled for a polygraph a client needs a full set of poly fee vouchers and an account balance of
// $0.00 or better (stored sign: positive = owes). Mirrors the server's check on assignment.
// Federal clients don't use vouchers and can owe any amount: their Polygraph Copay (federalCopay) is charged to the
// account when they are scheduled, and they only pay first when it would put them past a Max Debt Override.
export const polySchedulingNeeds = (client: { polyfeevoucher?: unknown; polyfeepaid?: unknown; polyfee?: unknown; accountbalance?: unknown; phase?: string | null;
  programtype?: string | null; polycopay?: unknown; maxowed?: unknown }) => {
  const vouchers = Number(client.polyfeevoucher ?? 0);
  const fullSet = polyVoucherMax(client.phase);
  const polyFeePaid = Number(client.polyfeepaid ?? 0);
  const polyFee = Number(client.polyfee ?? 0);
  if (FEDERAL_PROGRAM_TYPES.includes(client.programtype ?? '')) {
    const { copay, amountDue } = federalPolyNeeds(client.polycopay, client.accountbalance, client.maxowed);
    return { vouchers, fullSet, polyFeePaid, polyFee, short: false, polyDue: 0, balanceDue: amountDue, met: amountDue === 0, federalCopay: copay };
  }
  const short = vouchers < fullSet;
  // Paying off the poly fee is what fills the vouchers, so it is only owed while they are short
  const polyDue = short ? Math.max(0, polyFee - polyFeePaid) : 0;
  const balanceDue = Math.max(0, Number(client.accountbalance) || 0);
  return { vouchers, fullSet, polyFeePaid, polyFee, short, polyDue, balanceDue, met: !short && balanceDue === 0, federalCopay: null as number | null };
};

export const POLY_CANCEL_REASONS =['Client requested cancellation', 'Client late / did not show', 'Examiner rescheduled', 'Weather', 'Other'];

// Rescheduling keeps the vouchers already used, so a client's own request isn't one of these: it goes through a
// cancellation, where the notice rule decides the vouchers
export const POLY_RESCHEDULE_REASONS = ['Examiner rescheduled', 'Weather', 'Other'];

// Results that can keep the client in the NDI voucher incentive, but only by Business Administrator override
export const POLY_INCENTIVE_OVERRIDE_RESULTS = ['Inconclusive', 'No Opinion'];

// How a polygraph result reads: passed (NDI, NSR), failed (DI), or neither (Inconclusive, No Opinion,
// Unable to Perform Test, Other - See Test, anything else)
export type PolyResultTone = 'pass' | 'fail' | 'unclear';
export const polyResultTone = (result: string | null | undefined): PolyResultTone => {
  const r = (result ?? '').trim().toLowerCase();
  if (r === 'deception indicated') return 'fail';
  if (r === 'no deception indicated' || r === 'no significant response') return 'pass';
  return 'unclear';
};

// Hours of notice a client must give for a requested cancellation to get their poly fee vouchers back
export const POLY_CANCEL_NOTICE_HOURS = 48;

// When a slot starts, in local time. Times may be stored as "14:30:00" or "2:30 PM".
export const slotStart = (slot: SlotTime): Date | null => {
  const [year, month, day] = String(slot?.date || '').split('T')[0].split('-').map(Number);
  const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*$/i.exec(String(slot?.time || ''));
  if (!year || !month || !day || !match) return null;
  let hours = parseInt(match[1], 10) % (match[3] ? 12 : 24);
  if (match[3]?.toLowerCase() === 'pm') hours += 12;
  return new Date(year, month - 1, day, hours, Number(match[2]));
};

// Cancelling a reservation reopens the slot, unless the appointment time has passed: then the slot closes (the server
// decides; PolyCancelDialog says so too). The cancel button's label and hover text say which.
export const slotHasPassed = (slot: SlotTime, now = new Date()) => {
  const start = slotStart(slot);
  return start !== null && start.getTime() <= now.getTime();
};
export const cancelReservationLabel = (slot: SlotTime, now = new Date()) =>
  (slotHasPassed(slot, now) ? 'Cancel Reservation' : 'Cancel Reservation & Reopen');
export const cancelReservationHint = (slot: SlotTime, now = new Date()) =>
  (slotHasPassed(slot, now) ? 'The appointment time has passed, so cancelling closes the slot instead of reopening it.' : undefined);

// One-line description of a slot: date @ time · location
export const slotSummary = (slot: { date: string; time?: string; location?: string | null }) =>
  `${new Date(slot.date).toLocaleDateString()} @ ${formatDisplayTime(slot.time)}${slot.location ? ` · ${slot.location}` : ''}`;

// Whether a cancellation returns the booking's poly fee vouchers: true/false is fixed by the reason, null leaves it to staff
export const polyVoucherReturnRule = (reason: string, slot: SlotTime): boolean | null => {
  switch (reason) {
    case 'Weather':
    case 'Examiner rescheduled':
      return true;
    case 'Client late / did not show':
      return false;
    case 'Client requested cancellation': {
      const start = slotStart(slot);
      return start ? start.getTime() - Date.now() > POLY_CANCEL_NOTICE_HOURS * 60 * 60 * 1000 : null;
    }
    default:
      return null;
  }
};
