import { toDisplayBalance } from './balance';

// Attendance balance math uses the same display sign as the balance shown on the card.
// Each row stores the balance after its session, so the "before" balance is rebuilt from that row alone.
export const signedMoney = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
export const attendanceBalanceChange = (att: any) => {
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
export const addsToOwed = (fin: any) => fin.type === 'Charge' || PAYMENT_REVERSAL_TYPES.includes(fin.type);

// Financial Ledger row colors: fees red, refunds and disputes amber, payments green
export const LEDGER_TONES = {
  charge: { text: 'text-red-400', badge: 'text-red-400 bg-red-500/10 border-red-500/30' },
  reversal: { text: 'text-amber-400', badge: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  payment: { text: 'text-emerald-400', badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
};

// What's left of a credit card payment after its refunds and disputes (a won dispute puts its amount back),
// and how much is in dispute while one is open
export const cardPaymentStatus = (payment: any, ledger: any[]) => {
  let refunded = 0;
  let kept = Number(payment.amount || 0);
  let lastDispute = 0;
  for (const row of ledger) {
    if (row.relatedtransactionid !== payment.transactionid) continue;
    const amount = Number(row.amount || 0);
    if (row.type === 'Refund') refunded += amount;
    if (PAYMENT_REVERSAL_TYPES.includes(row.type)) kept -= amount;
    else if (row.type === 'Dispute Won') kept += amount;
    if (row.type === 'Dispute') lastDispute = amount;
  }
  return {
    refunded,
    kept: Math.round(kept * 100) / 100,
    openDispute: payment.disputestatus === 'Open' ? lastDispute : 0,
  };
};

// Ledger rows store the balance after each transaction. Working back from the amount gives the balance before it.
export const ledgerBalanceChange = (fin: any) => {
  if (fin.finalbalance === null || fin.finalbalance === undefined) return null;
  const amount = Number(fin.amount || 0);
  const after = Number(fin.finalbalance);
  // Poly fee payments are tracked apart from the account, so they leave the balance where it was
  const changesBalance = fin.feetype !== 'Poly Fee';
  const before = !changesBalance ? after : addsToOwed(fin) ? after - amount : after + amount;
  return { before: toDisplayBalance(before), after: toDisplayBalance(after), changesBalance };
};
