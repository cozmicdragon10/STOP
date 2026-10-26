import { localYmd, timeBetween, toLocalDay } from './dates';

export const POLY_OVERDUE_MONTHS = 6;

// When the client's most recent polygraph was taken: the actual polygraph date, falling back to the recorded date for older results without one
export const lastPolygraphTaken = (polygraphs: any[]): Date | null => {
  const taken = polygraphs
    .map(p => p.polygraphdatetime ? new Date(p.polygraphdatetime) : p.date ? toLocalDay(p.date) : null)
    .filter((d): d is Date => !!d && !isNaN(d.getTime()));
  return taken.length ? new Date(Math.max(...taken.map(d => d.getTime()))) : null;
};
export const isPolygraphOverdue = (last: Date, today = new Date()) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate()) >= new Date(last.getFullYear(), last.getMonth() + POLY_OVERDUE_MONTHS, last.getDate());
// For a client booked into a polygraph: how long since their last one, or that they haven't taken one yet
export const polygraphHistoryText = (polygraphs: any[], today = new Date()) => {
  const last = lastPolygraphTaken(polygraphs);
  if (!last) return 'No polygraph taken yet.';
  const since = timeBetween(localYmd(last), localYmd(today));
  return `${since === 'Same day' ? 'Last polygraph was today' : `${since} since last polygraph`} (${last.toLocaleDateString()})${isPolygraphOverdue(last, today) ? ', overdue' : ''}.`;
};
// Red polygraph notice for a client's account, or null when none applies. BIP clients don't take polygraphs.
export const polygraphNotice = (client: any, polygraphs: any[], today = new Date()) => {
  if (client.programtype === 'BIP' || client.nopolyrequired) return null;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const last = lastPolygraphTaken(polygraphs);
  if (last) {
    return isPolygraphOverdue(last, today) ? 'Client is overdue for their next Polygraph' : null;
  }
  if (!client.lastdateattended) return null;
  const days = Math.round((startOfToday.getTime() - toLocalDay(client.lastdateattended).getTime()) / 86400000);
  return `Client hasn't taken their first polygraph in ${days} day${days === 1 ? '' : 's'}`;
};

// A client's poly fee voucher runs 0 to this; the server fills it when the poly fee is paid in full
export const POLY_VOUCHER_MAX = 6;

export const POLY_CANCEL_REASONS =['Client requested cancellation', 'Client late / did not show', 'Examiner rescheduled', 'Weather', 'Other'];

// Results that can keep the client in the NDI voucher incentive, but only by Business Administrator override
export const POLY_INCENTIVE_OVERRIDE_RESULTS = ['Inconclusive', 'No Opinion'];

// Hours of notice a client must give for a requested cancellation to get their poly fee vouchers back
export const POLY_CANCEL_NOTICE_HOURS = 48;

// When a slot starts, in local time. Times may be stored as "14:30:00" or "2:30 PM".
export const slotStart = (slot: any): Date | null => {
  const [year, month, day] = String(slot?.date || '').split('T')[0].split('-').map(Number);
  const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*$/i.exec(String(slot?.time || ''));
  if (!year || !month || !day || !match) return null;
  let hours = parseInt(match[1], 10) % (match[3] ? 12 : 24);
  if (match[3]?.toLowerCase() === 'pm') hours += 12;
  return new Date(year, month - 1, day, hours, Number(match[2]));
};

// Whether a cancellation returns the booking's poly fee vouchers: true/false is fixed by the reason, null leaves it to staff
export const polyVoucherReturnRule = (reason: string, slot: any): boolean | null => {
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
