// The database stores a balance as what the client owes: positive = owes, negative = credit.
// The office reads it the other way around: positive = credit, negative = debt.
// Only the display is flipped here; stored values and the payment/charge math are unchanged.

// A client's first group check-in of a calendar month needs a balance of $0.00 or better (owing at most this much,
// after any payment taken at check-in). Mirrors FIRST_CHECKIN_MAX_OWED in backend/lib/attendance.js.
export const FIRST_CHECKIN_MAX_OWED = 0;

// Which payment rule a client's group check-in follows (mirrors checkInPaymentRule in backend/lib/attendance.js):
//   'none'    BIP clients: no balance requirement
//   'federal' Federal SO, Fed Drug Test and Poly Only clients: no balance requirement, so they can owe any amount, unless
//             a Max Debt Override is set: then a check-in that charges a copay can't leave them owing more than it
//   'each'    Chaperon clients: every attendance is paid the day of it, so the balance after check-in, today's fee
//             included, must be $0.00 or better
//   'first'   everyone else: the first group check-in of the month needs the balance before today's fee at $0.00 or better
export type CheckInPaymentRule = 'none' | 'federal' | 'each' | 'first';
export const NO_CHECKIN_LIMIT_PROGRAMS = ['BIP'];
export const FEDERAL_PAYMENT_PROGRAMS = ['Federal SO', 'Fed Drug Test', 'Poly Only'];
export const PAY_EACH_VISIT_PROGRAMS = ['Chaperon'];
export const checkInPaymentRule = (programType?: string | null): CheckInPaymentRule =>
  NO_CHECKIN_LIMIT_PROGRAMS.includes(programType || '') ? 'none'
    : FEDERAL_PAYMENT_PROGRAMS.includes(programType || '') ? 'federal'
      : PAY_EACH_VISIT_PROGRAMS.includes(programType || '') ? 'each' : 'first';

// A Max Debt Override (Business Administrators) lets a client owe up to its amount and still attend; this is the most it
// can be. Mirrors MAX_DEBT_LIMIT in backend/lib/debtLimits.js.
export const MAX_DEBT_LIMIT = 10000;
// How much the client may owe at a checked check-in: FIRST_CHECKIN_MAX_OWED, or more under a Max Debt Override
export const allowedOwed = (maxOwed?: number | string | null): number => Math.max(FIRST_CHECKIN_MAX_OWED, Number(maxOwed) || 0);

// The smallest payment that lets a group or individual check-in through, from the balance before it (stored sign:
// positive = owes) and today's fee; 0 when nothing has to be paid. maxOwed: the client's Max Debt Override, if any (for
// federal clients, the most a charge may leave them owing). Mirrors minimumCheckInPayment in backend/lib/attendance.js.
export const minimumCheckInPayment = (rule: CheckInPaymentRule, balance: number | string | null | undefined, fee: number, attendedThisMonth: boolean, maxOwed: number | string | null = 0): number => {
  const owed = rule === 'each' || (rule === 'federal' && Number(fee) > 0 && Number(maxOwed) > 0) ? Number(balance || 0) + Number(fee || 0)
    : rule === 'first' && !attendedThisMonth ? Number(balance || 0) : -Infinity;
  return Math.max(0, Math.round((owed - allowedOwed(maxOwed)) * 100) / 100);
};

export const toDisplayBalance = (stored: number | string | null | undefined): number => -(Number(stored) || 0);

export const formatBalance = (stored: number | string | null | undefined): string => {
  const shown = toDisplayBalance(stored);
  return `${shown < 0 ? '-' : ''}$${Math.abs(shown).toFixed(2)}`;
};

// A client's standing balance with a word saying which way it runs, e.g. "-$180.00 owed" or "$55.00 credit", so a
// reader who doesn't know the office's sign convention can't take it backwards. Fee and payment amounts keep formatBalance.
export const balanceWord = (stored: number | string | null | undefined): string => {
  const shown = toDisplayBalance(stored);
  return shown < 0 ? 'owed' : shown > 0 ? 'credit' : '';
};

export const formatBalanceLabeled = (stored: number | string | null | undefined): string => {
  const word = balanceWord(stored);
  return word ? `${formatBalance(stored)} ${word}` : formatBalance(stored);
};
