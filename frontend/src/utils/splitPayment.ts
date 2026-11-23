// Payment amounts typed at group check-in, including a split payment: part by Credit Card and the rest in Cash or Other
// (check, money order, ...). The card part is saved to the account as soon as it is processed; the Cash or Other part is
// recorded when the group closes, like a single Cash or Other payment.
import type { PaymentMethod } from './paymentMethods';

export interface PaymentAmounts {
  // Single payment: the amount, paid by paymentMethod. Split: the Cash or Other part (paymentMethod is Cash or Other).
  payment: string;
  paymentMethod: PaymentMethod;
  split: boolean;
  // Split: the Credit Card part
  cardAmount: string;
}

// A typed amount: blank is 0; null when it isn't an amount of 0 or more
export const parseAmount = (text: string): number | null => {
  const n = text.trim() === '' ? 0 : Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// Every typed amount is valid
export const amountsValid = (row: PaymentAmounts): boolean =>
  parseAmount(row.payment) !== null && (!row.split || parseAmount(row.cardAmount) !== null);

// The Cash or Other part, recorded when the group closes
export const cashPart = (row: PaymentAmounts): number =>
  row.split || row.paymentMethod !== 'Credit Card' ? parseAmount(row.payment) ?? 0 : 0;

// The amount typed for the card, as text and as a number
export const cardText = (row: PaymentAmounts): string =>
  row.split ? row.cardAmount : row.paymentMethod === 'Credit Card' ? row.payment : '';
export const cardPart = (row: PaymentAmounts): number => parseAmount(cardText(row)) ?? 0;

// Turns a split on or off. On: an amount already typed for a card stays the card part, any other amount stays the Cash or
// Other part. Off: the Cash or Other part becomes the single payment and the card part is dropped.
export const toggleSplit = (row: PaymentAmounts): Pick<PaymentAmounts, 'split' | 'payment' | 'paymentMethod' | 'cardAmount'> => {
  if (row.split) return { split: false, payment: row.payment, paymentMethod: row.paymentMethod, cardAmount: '' };
  const card = row.paymentMethod === 'Credit Card';
  return {
    split: true,
    cardAmount: card ? row.payment : '',
    payment: card ? '' : row.payment,
    paymentMethod: card ? 'Cash' : row.paymentMethod,
  };
};
