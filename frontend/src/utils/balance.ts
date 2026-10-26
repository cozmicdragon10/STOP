// The database stores a balance as what the client owes: positive = owes, negative = credit.
// The office reads it the other way around: positive = credit, negative = debt.
// Only the display is flipped here; stored values and the payment/charge math are unchanged.

// A client's first group check-in of a calendar month needs a balance of -$180.00 or better (owing at most this much,
// after any payment taken at check-in). BIP clients are exempt. Mirrors FIRST_CHECKIN_MAX_OWED in backend/lib/attendance.js.
export const FIRST_CHECKIN_MAX_OWED = 180;

export const toDisplayBalance = (stored: number | string | null | undefined): number => -(Number(stored) || 0);

export const formatBalance = (stored: number | string | null | undefined): string => {
  const shown = toDisplayBalance(stored);
  return `${shown < 0 ? '-' : ''}$${Math.abs(shown).toFixed(2)}`;
};
