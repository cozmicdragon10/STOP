import type { FinancialSummaryData } from '../api';

// Adds up the Financial Summary report (GET /api/reports/financial-summary) for one date range.
//   Collected  payments (ledger) plus what was paid at check-ins imported from the old system (no ledger rows),
//              less refunds and chargebacks (Dispute rows), plus disputes won back.
//   Charged    check-in fees from attendance (the ledger's check-in Charge rows repeat them, so they are skipped),
//              plus charges not tied to a check-in (custom fees, polygraph copays).
//   Credits    Adjustment rows: debt forgiven and polygraph copays credited back. They lower balances without money.
//   Funded     assessments a DHS invoice or voucher covers: billed to them, not to the client's account.

// other: checks, money orders, Direct Deposit, Tribal, DHS (utils/paymentMethods.ts)
export interface MethodLine { label: string; count: number; cash: number; card: number; other: number; unrecorded: number; total: number }
export interface AmountLine { label: string; count: number; amount: number }
export interface MonthTotals { month: string; charged: number; credits: number; collected: number; refunded: number; net: number }
export interface CashLine { label: string; cash: number; deposited: number; held: number; heldCount: number }
export interface BalanceLine { status: string; clients: number; owing: number; owed: number; inCredit: number; credit: number }

export interface FinancialSummary {
  payments: MethodLine[];
  paymentTotals: MethodLine;
  refunds: AmountLine;
  disputes: AmountLine;
  disputesWon: AmountLine;
  netCollected: number;
  charges: AmountLine[];
  chargeTotal: number;
  credits: AmountLine[];
  creditTotal: number;
  funded: AmountLine[];
  fundedTotal: number;
  months: MonthTotals[];
  cash: CashLine[];
  cashTotals: CashLine;
  balances: BalanceLine[];
  balanceTotals: BalanceLine;
}

const num = (v: unknown) => Number(v) || 0;
export const cents = (n: number) => Math.round(n * 100) / 100;
export const OLD_SYSTEM_LABEL = 'Old system check-ins';

// YYYY-MM for every month from one date's month to another's, inclusive
export const monthsBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  if (!y || !m || !ty || !tm) return out;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
};

const methodKey = (method: string): 'cash' | 'card' | 'other' | 'unrecorded' =>
  method === 'Cash' ? 'cash' : method === 'Credit Card' ? 'card' : method === 'Other' ? 'other' : 'unrecorded';

// Adds amount to the line with that label, making it if needed
const addTo = (map: Map<string, AmountLine>, label: string, count: number, amount: number) => {
  const line = map.get(label) ?? { label, count: 0, amount: 0 };
  line.count += count;
  line.amount = cents(line.amount + amount);
  map.set(label, line);
};
const sorted = (map: Map<string, AmountLine>) => [...map.values()].filter(l => l.count > 0 || l.amount !== 0).sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
const sumOf = (lines: AmountLine[]) => cents(lines.reduce((t, l) => t + l.amount, 0));

export function summarizeFinancials(data: FinancialSummaryData, from: string, to: string): FinancialSummary {
  const months = new Map(monthsBetween(from, to).map(month => [month, { month, charged: 0, credits: 0, collected: 0, refunded: 0, net: 0 }]));
  const monthOf = (month: string) => {
    if (!months.has(month)) months.set(month, { month, charged: 0, credits: 0, collected: 0, refunded: 0, net: 0 });
    return months.get(month)!;
  };

  const payments = new Map<string, MethodLine>();
  const pay = (label: string, method: string, count: number, amount: number) => {
    const line = payments.get(label) ?? { label, count: 0, cash: 0, card: 0, other: 0, unrecorded: 0, total: 0 };
    line.count += count;
    line[methodKey(method)] = cents(line[methodKey(method)] + amount);
    line.total = cents(line.total + amount);
    payments.set(label, line);
  };
  const refunds: AmountLine = { label: 'Refunds', count: 0, amount: 0 };
  const disputes: AmountLine = { label: 'Chargebacks (disputes opened)', count: 0, amount: 0 };
  const disputesWon: AmountLine = { label: 'Disputes won back', count: 0, amount: 0 };
  const charges = new Map<string, AmountLine>();
  const credits = new Map<string, AmountLine>();
  const funded = new Map<string, AmountLine>();

  for (const r of data.ledger) {
    const amount = num(r.amount);
    const m = monthOf(r.month);
    if (r.type === 'Payment') {
      pay(r.feetype || 'Payment (no fee type)', r.paymentmethod, r.count, amount);
      m.collected = cents(m.collected + amount);
    } else if (r.type === 'Refund' || r.type === 'Dispute') {
      const line = r.type === 'Refund' ? refunds : disputes;
      line.count += r.count;
      line.amount = cents(line.amount + amount);
      m.refunded = cents(m.refunded + amount);
    } else if (r.type === 'Dispute Won') {
      disputesWon.count += r.count;
      disputesWon.amount = cents(disputesWon.amount + amount);
      m.refunded = cents(m.refunded - amount);
    } else if (r.type === 'Charge') {
      // Check-in charges are counted from attendance
      if (r.atcheckin) continue;
      addTo(charges, r.feetype || 'Other charges', r.count, amount);
      m.charged = cents(m.charged + amount);
    } else if (r.type === 'Adjustment') {
      addTo(credits, r.feetype === 'Polygraph Copay' ? 'Polygraph copays credited back' : r.feetype || 'Other adjustments', r.count, amount);
      m.credits = cents(m.credits + amount);
    }
  }

  for (const r of data.attendance) {
    const m = monthOf(r.month);
    const fees = num(r.fees);
    if (fees !== 0) {
      addTo(charges, `${r.type} fees`, r.count, fees);
      m.charged = cents(m.charged + fees);
    }
    if (r.fundedby) addTo(funded, `Assessments billed to ${r.fundedby === 'DHS Voucher' ? 'DHS vouchers' : 'invoices'}`, r.count, num(r.fundedprice));
    const imported = num(r.importedpaid);
    if (imported !== 0) {
      pay(OLD_SYSTEM_LABEL, '', 0, imported);
      m.collected = cents(m.collected + imported);
    }
  }

  const paymentLines = [...payments.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  const paymentTotals = paymentLines.reduce<MethodLine>((t, l) => ({
    label: 'Total payments', count: t.count + l.count, cash: cents(t.cash + l.cash), card: cents(t.card + l.card), other: cents(t.other + l.other),
    unrecorded: cents(t.unrecorded + l.unrecorded), total: cents(t.total + l.total),
  }), { label: 'Total payments', count: 0, cash: 0, card: 0, other: 0, unrecorded: 0, total: 0 });

  const monthList = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const m of monthList) m.net = cents(m.collected - m.refunded);

  const cashLine = (label: string, c: FinancialSummaryData['groupCash'] | FinancialSummaryData['userCash']): CashLine =>
    ({ label, cash: num(c?.cash), deposited: num(c?.deposited), held: num(c?.held), heldCount: num(c?.heldcount) });
  const cash = [cashLine('Group sessions', data.groupCash), cashLine('Taken outside a group', data.userCash)];
  const cashTotals = cash.reduce<CashLine>((t, c) => ({
    label: 'Total cash', cash: cents(t.cash + c.cash), deposited: cents(t.deposited + c.deposited),
    held: cents(t.held + c.held), heldCount: t.heldCount + c.heldCount,
  }), { label: 'Total cash', cash: 0, deposited: 0, held: 0, heldCount: 0 });

  const balances: BalanceLine[] = data.balances.map(b => ({
    status: b.programstatus, clients: num(b.clients), owing: num(b.owing), owed: num(b.owed), inCredit: num(b.incredit), credit: num(b.credit),
  })).sort((a, b) => b.owed - a.owed || a.status.localeCompare(b.status));
  const balanceTotals = balances.reduce<BalanceLine>((t, b) => ({
    status: 'All clients', clients: t.clients + b.clients, owing: t.owing + b.owing, owed: cents(t.owed + b.owed),
    inCredit: t.inCredit + b.inCredit, credit: cents(t.credit + b.credit),
  }), { status: 'All clients', clients: 0, owing: 0, owed: 0, inCredit: 0, credit: 0 });

  const chargeLines = sorted(charges);
  const creditLines = sorted(credits);
  const fundedLines = sorted(funded);
  return {
    payments: paymentLines,
    paymentTotals,
    refunds,
    disputes,
    disputesWon,
    netCollected: cents(paymentTotals.total - refunds.amount - disputes.amount + disputesWon.amount),
    charges: chargeLines,
    chargeTotal: sumOf(chargeLines),
    credits: creditLines,
    creditTotal: sumOf(creditLines),
    funded: fundedLines,
    fundedTotal: sumOf(fundedLines),
    months: monthList,
    cash,
    cashTotals,
    balances,
    balanceTotals,
  };
}

// The summary as CSV rows (section, item, count, amount...) for a spreadsheet
export function financialCsv(s: FinancialSummary, from: string, to: string): string {
  const q = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows: (string | number)[][] = [['Financial Summary', `${from} to ${to}`], []];
  rows.push(['Money Collected', 'Count', 'Cash', 'Credit Card', 'Other', 'Not Recorded', 'Total']);
  for (const p of [...s.payments, s.paymentTotals]) rows.push([p.label, p.count, p.cash.toFixed(2), p.card.toFixed(2), p.other.toFixed(2), p.unrecorded.toFixed(2), p.total.toFixed(2)]);
  for (const l of [s.refunds, s.disputes]) rows.push([`Less ${l.label.toLowerCase()}`, l.count, '', '', '', '', (-l.amount).toFixed(2)]);
  rows.push([`Plus ${s.disputesWon.label.toLowerCase()}`, s.disputesWon.count, '', '', '', '', s.disputesWon.amount.toFixed(2)]);
  rows.push(['Net collected', '', '', '', '', '', s.netCollected.toFixed(2)], []);
  const section = (title: string, lines: AmountLine[], total: number) => {
    rows.push([title, 'Count', 'Amount']);
    for (const l of lines) rows.push([l.label, l.count, l.amount.toFixed(2)]);
    rows.push(['Total', '', total.toFixed(2)], []);
  };
  section('Charged to Client Accounts', s.charges, s.chargeTotal);
  section('Credits and Debt Forgiven', s.credits, s.creditTotal);
  section('Billed to Funders', s.funded, s.fundedTotal);
  rows.push(['Cash Deposits', 'Cash Taken', 'Deposited', 'Not Deposited', 'Items Not Deposited']);
  for (const c of [...s.cash, s.cashTotals]) rows.push([c.label, c.cash.toFixed(2), c.deposited.toFixed(2), c.held.toFixed(2), c.heldCount]);
  rows.push([], ['By Month', 'Charged', 'Credits', 'Collected', 'Refunds & Disputes', 'Net Collected']);
  for (const m of s.months) rows.push([m.month, m.charged.toFixed(2), m.credits.toFixed(2), m.collected.toFixed(2), m.refunded.toFixed(2), m.net.toFixed(2)]);
  rows.push([], ['Client Balances Today', 'Clients', 'Owing', 'Owed', 'In Credit', 'Credit']);
  for (const b of [...s.balances, s.balanceTotals]) rows.push([b.status, b.clients, b.owing, b.owed.toFixed(2), b.inCredit, b.credit.toFixed(2)]);
  return rows.map(r => r.map(q).join(',')).join('\r\n');
}
