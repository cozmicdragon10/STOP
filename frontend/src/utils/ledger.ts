import { toDisplayBalance } from './balance';
import type { ClientAttendance, FinancialTransaction } from '../api';

// Only the fields each helper reads, so partial rows (and tests) fit
type LedgerFields<K extends keyof FinancialTransaction> = Partial<Pick<FinancialTransaction, K>>;

// Attendance balance math uses the same display sign as the balance shown on the card.
// Each row stores the balance after its session, so the "before" balance is rebuilt from that row alone.
export const signedMoney = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
// Same format as signedMoney, for amounts entered on forms and shown in messages
export const formatMoney = signedMoney;
export const attendanceBalanceChange = (att: Partial<Pick<ClientAttendance, 'groupfee' | 'accountpaid' | 'accounttotal'>>) => {
  const fee = Number(att.groupfee || 0);
  const paid = Number(att.accountpaid || 0);
  return {
    fee,
    paid,
    before: toDisplayBalance(Number(att.accounttotal || 0) - fee + paid),
    after: toDisplayBalance(att.accounttotal),
  };
};

// Refunds and disputes take money back off a credit card payment, so like a charge they add to what the client owes
export const PAYMENT_REVERSAL_TYPES = ['Refund', 'Dispute'];
export const addsToOwed = (fin: LedgerFields<'type'>) => fin.type === 'Charge' || PAYMENT_REVERSAL_TYPES.includes(fin.type ?? '');

// Financial Ledger row colors: fees red, refunds and disputes amber, payments green
export const LEDGER_TONES = {
  charge: { text: 'text-red-400', badge: 'text-red-400 bg-red-500/10 border-red-500/30' },
  reversal: { text: 'text-amber-400', badge: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  payment: { text: 'text-emerald-400', badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
};

// What's left of a credit card payment after its refunds and disputes (a won dispute puts its amount back),
// and how much is in dispute while one is open
export const cardPaymentStatus = (
  payment: LedgerFields<'amount' | 'transactionid' | 'disputestatus'>,
  ledger: LedgerFields<'relatedtransactionid' | 'amount' | 'type'>[],
) => {
  let refunded = 0;
  let kept = Number(payment.amount || 0);
  let lastDispute = 0;
  for (const row of ledger) {
    if (row.relatedtransactionid !== payment.transactionid) continue;
    const amount = Number(row.amount || 0);
    if (row.type === 'Refund') refunded += amount;
    if (PAYMENT_REVERSAL_TYPES.includes(row.type ?? '')) kept -= amount;
    else if (row.type === 'Dispute Won') kept += amount;
    if (row.type === 'Dispute') lastDispute = amount;
  }
  return {
    refunded,
    kept: Math.round(kept * 100) / 100,
    openDispute: payment.disputestatus === 'Open' ? lastDispute : 0,
  };
};

// A check-in that took a payment has one ledger row, the payment; sessionfee is the fee charged at that check-in
// (SESSION_FEE_SQL in backend/lib/sql.js). 0 for every other row.
export const sessionFeeOf = (fin: LedgerFields<'sessionfee'>) => Number(fin.sessionfee || 0);
// What a month's rows charged: fee rows, plus the fees of check-ins whose row is their payment
export const feesCharged = (rows: LedgerFields<'type' | 'amount' | 'sessionfee'>[]) => rows.reduce((t, f) => t + (f.type === 'Charge' ? Number(f.amount || 0) : sessionFeeOf(f)), 0);

// Ledger rows store the balance after each transaction. Working back from the amount gives the balance before it.
export const ledgerBalanceChange = (fin: LedgerFields<'amount' | 'feetype' | 'type' | 'sessionfee'> & { finalbalance?: FinancialTransaction['finalbalance'] | null }) => {
  if (fin.finalbalance === null || fin.finalbalance === undefined) return null;
  const amount = Number(fin.amount || 0);
  const after = Number(fin.finalbalance);
  // Poly fee payments are tracked apart from the account, so they leave the balance where it was
  const changesBalance = fin.feetype !== 'Poly Fee';
  // A check-in's payment row also carries its fee: the balance went up by the fee and down by the payment
  const before = !changesBalance ? after : addsToOwed(fin) ? after - amount : after + amount - sessionFeeOf(fin);
  return { before: toDisplayBalance(before), after: toDisplayBalance(after), changesBalance };
};

// Forgiven debt is an Adjustment row with this fee type: it lowers what's owed but isn't money paid
export const FORGIVEN_FEE_TYPE = 'Debt Forgiven';

// Why the Forgive Debt form can't be sent yet, or null. owed: what the client owes (stored balance, positive = owes).
// Mirrors forgivenessProblem in backend/lib/debtForgiveness.js (the server also refuses a balance that changed meanwhile).
export const forgivenessProblem = ({ amount, reason, owed }: { amount: number | string; reason: string; owed: number | string }): string | null => {
  const cents = (n: number | string) => Math.round(Number(n) * 100);
  if (!(cents(owed) > 0)) return 'This client does not owe anything, so there is no debt to forgive.';
  if (!(cents(amount) > 0)) return 'Enter an amount to forgive, more than $0.00.';
  if (cents(amount) > cents(owed)) return `You can forgive up to what the client owes, $${Number(owed).toFixed(2)}.`;
  if (!reason.trim()) return 'A reason is required to forgive debt.';
  return null;
};
