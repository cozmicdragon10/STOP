import { describe, expect, it } from 'vitest';
import { financialCsv, monthsBetween, OLD_SYSTEM_LABEL, summarizeFinancials } from './financialReport';
import type { FinancialSummaryData } from '../api';

const cash = { cash: 0, deposited: 0, held: 0, heldcount: 0 };
const data = (over: Partial<FinancialSummaryData>): FinancialSummaryData => ({
  ledger: [], attendance: [], groupCash: { ...cash, sessions: 0 }, userCash: { ...cash, payments: 0 }, balances: [], ...over,
});
const ledger = (type: string, amount: number, extra: Partial<FinancialSummaryData['ledger'][number]> = {}) =>
  ({ month: '2026-10', type, feetype: '', paymentmethod: '', atcheckin: false, count: 1, amount: String(amount), ...extra });
const att = (type: string, fees: number, extra: Partial<FinancialSummaryData['attendance'][number]> = {}) =>
  ({ month: '2026-10', type, fundedby: '' as const, count: 1, fees: String(fees), fundedprice: '0', importedpaid: '0', ...extra });

describe('monthsBetween', () => {
  it('lists every month in the range, across a year end', () => {
    expect(monthsBetween('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-03-01', '2026-03-31')).toEqual(['2026-03']);
  });
});

describe('summarizeFinancials', () => {
  it('nets refunds and disputes out of payments, and adds disputes won back', () => {
    const s = summarizeFinancials(data({
      ledger: [
        ledger('Payment', 100, { feetype: 'Group Fee', paymentmethod: 'Cash', count: 2 }),
        ledger('Payment', 60, { feetype: 'Group Fee', paymentmethod: 'Credit Card' }),
        ledger('Payment', 250, { feetype: 'Poly Fee', paymentmethod: 'Credit Card' }),
        ledger('Refund', 20, { paymentmethod: 'Credit Card' }),
        ledger('Dispute', 60, { paymentmethod: 'Credit Card' }),
        ledger('Dispute Won', 60, { paymentmethod: 'Credit Card' }),
      ],
    }), '2026-10-01', '2026-10-31');
    expect(s.paymentTotals).toMatchObject({ cash: 100, card: 310, total: 410, count: 4 });
    expect(s.payments.map(p => p.label)).toEqual(['Poly Fee', 'Group Fee']);
    expect(s.netCollected).toBe(390);
    expect(s.months).toEqual([{ month: '2026-10', charged: 0, credits: 0, collected: 410, refunded: 20, net: 390 }]);
  });

  it('counts check-in fees from attendance, not the check-in Charge rows that repeat them', () => {
    const s = summarizeFinancials(data({
      ledger: [
        ledger('Charge', 35, { feetype: 'Group Fee', atcheckin: true }),
        ledger('Charge', 50, { feetype: 'Custom Fee' }),
        ledger('Charge', 40, { feetype: 'Polygraph Copay' }),
      ],
      attendance: [att('Group', 35), att('Assessment', 0, { fundedby: 'DHS Invoice', fundedprice: '150' }), att('Holiday', 0)],
    }), '2026-10-01', '2026-10-31');
    expect(s.charges).toEqual([
      { label: 'Custom Fee', count: 1, amount: 50 },
      { label: 'Polygraph Copay', count: 1, amount: 40 },
      { label: 'Group fees', count: 1, amount: 35 },
    ]);
    expect(s.chargeTotal).toBe(125);
    expect(s.funded).toEqual([{ label: 'Assessments billed to DHS (invoice)', count: 1, amount: 150 }]);
  });

  it('keeps debt forgiven and copay credits apart from money collected', () => {
    const s = summarizeFinancials(data({
      ledger: [ledger('Adjustment', 75, { feetype: 'Debt Forgiven' }), ledger('Adjustment', 40, { feetype: 'Polygraph Copay' })],
    }), '2026-10-01', '2026-10-31');
    expect(s.credits.map(c => c.label)).toEqual(['Debt Forgiven', 'Polygraph copays credited back']);
    expect(s.creditTotal).toBe(115);
    expect(s.netCollected).toBe(0);
  });

  it('adds payments from imported old-system check-ins as method not recorded', () => {
    const s = summarizeFinancials(data({ attendance: [att('Group', 30, { month: '2025-01', importedpaid: '30' })] }), '2025-01-01', '2025-02-28');
    expect(s.payments).toEqual([{ label: OLD_SYSTEM_LABEL, count: 0, cash: 0, card: 0, other: 0, unrecorded: 30, total: 30 }]);
    expect(s.months.map(m => [m.month, m.collected])).toEqual([['2025-01', 30], ['2025-02', 0]]);
  });

  it('totals cash deposits and client balances', () => {
    const s = summarizeFinancials(data({
      groupCash: { cash: '120', deposited: '100', held: '20', heldcount: 1, sessions: 3 },
      userCash: { cash: '45.5', deposited: '0', held: '45.5', heldcount: 2, payments: 2 },
      balances: [
        { programstatus: 'Active', clients: 10, owing: 4, owed: '300', incredit: 1, credit: '15' },
        { programstatus: 'Completed', clients: 5, owing: 1, owed: '40', incredit: 0, credit: '0' },
      ],
    }), '2026-10-01', '2026-10-31');
    expect(s.cashTotals).toEqual({ label: 'Total cash', cash: 165.5, deposited: 100, held: 65.5, heldCount: 3 });
    expect(s.balanceTotals).toEqual({ status: 'All clients', clients: 15, owing: 5, owed: 340, inCredit: 1, credit: 15 });
  });

  it('exports CSV with quoted labels', () => {
    const s = summarizeFinancials(data({ ledger: [ledger('Charge', 10, { feetype: 'Fee, special' })] }), '2026-10-01', '2026-10-31');
    const csv = financialCsv(s, '2026-10-01', '2026-10-31');
    expect(csv).toContain('"Fee, special",1,10.00');
    expect(csv.split('\r\n')[0]).toBe('Financial Summary,2026-10-01 to 2026-10-31');
  });
});
