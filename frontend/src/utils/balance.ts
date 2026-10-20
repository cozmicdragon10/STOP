// The database stores a balance as what the client owes: positive = owes, negative = credit.
// The office reads it the other way around: positive = credit, negative = debt.
// Only the display is flipped here; stored values and the payment/charge math are unchanged.

export const toDisplayBalance = (stored: number | string | null | undefined): number => -(Number(stored) || 0);

export const formatBalance = (stored: number | string | null | undefined): string => {
  const shown = toDisplayBalance(stored);
  return `${shown < 0 ? '-' : ''}$${Math.abs(shown).toFixed(2)}`;
};
