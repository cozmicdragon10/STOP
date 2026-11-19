import { describe, expect, it } from 'vitest';
import { statusGroup, summarizeAging, summarizeCensus, summarizeOutcomes, tablesToCsv } from './directorReports';
import type { AgingClient, CensusRow, OutcomeRow } from '../api';

const buckets = [{ key: 'current', label: '0–30 days' }, { key: 'over365', label: 'Over 1 year' }];
const client = (id: number, status: string, program: string, current: number, over: number): AgingClient => ({
  clientid: id, balance: String(current + over), firstname: 'Pat', lastname: `Client${id}`, docnumber: String(1000 + id), doctype: 'DOC',
  programtype: program, programstatus: status, lastattended: null, lastpayment: null, current: String(current), over365: String(over),
});

describe('summarizeAging', () => {
  const report = { buckets, clients: [client(1, 'Active', 'BIP', 50, 0), client(2, 'Program Failed', 'State SO', 0, 300), client(3, 'Inactive', 'State SO', 20, 30)] };

  it('groups statuses into active, inactive, and discharged', () => {
    expect(['Active', 'Inactive', 'Revoked', 'Completed'].map(statusGroup)).toEqual(['Active', 'Inactive', 'Discharged', 'Discharged']);
  });

  it('totals each bucket by status group and program', () => {
    const s = summarizeAging(report, { group: '', program: '', search: '' });
    expect(s.total).toEqual({ label: 'All clients', clients: 3, balance: 400, buckets: [70, 330] });
    expect(s.byGroup.map(g => [g.label, g.balance])).toEqual([['Active', 50], ['Inactive', 50], ['Discharged', 300]]);
    expect(s.byProgram.map(g => [g.label, g.buckets])).toEqual([['State SO', [20, 330]], ['BIP', [50, 0]]]);
  });

  it('filters by status group, program, and name or ID', () => {
    expect(summarizeAging(report, { group: 'Discharged', program: '', search: '' }).clients.map(c => c.clientid)).toEqual([2]);
    expect(summarizeAging(report, { group: '', program: 'State SO', search: '' }).total.clients).toBe(2);
    expect(summarizeAging(report, { group: '', program: '', search: '1003' }).clients.map(c => c.clientid)).toEqual([3]);
    expect(summarizeAging(report, { group: '', program: '', search: 'pat client1' }).clients.map(c => c.clientid)).toEqual([1]);
  });
});

describe('summarizeCensus', () => {
  const row = (month: string, programtype: string, enrolled: number, intakes = 0, discharged = 0): CensusRow =>
    ({ month, programtype, enrolled, intakes, discharged, wentinactive: 0, seen: enrolled - 1 });
  const rows = [row('2026-01', 'BIP', 100, 10, 5), row('2026-02', 'BIP', 104, 8, 4), row('2026-01', 'State SO', 50, 2, 1), row('2026-02', 'State SO', 49, 1, 2), row('2026-02', 'Chaperon', 0)];

  it('adds programs together per month', () => {
    const s = summarizeCensus(rows, '');
    expect(s.months.map(m => [m.month, m.enrolled, m.intakes, m.discharged])).toEqual([['2026-01', 150, 12, 6], ['2026-02', 153, 9, 6]]);
    expect([s.intakesTotal, s.dischargedTotal]).toEqual([21, 12]);
  });

  it('shows each program with its change over the range, leaving out empty ones', () => {
    const s = summarizeCensus(rows, '');
    expect(s.byProgram.map(p => [p.program, p.enrolled, p.change])).toEqual([['BIP', 104, 4], ['State SO', 49, -1]]);
  });

  it('limits to one program', () => {
    expect(summarizeCensus(rows, 'State SO').last?.enrolled).toBe(49);
  });
});

describe('summarizeOutcomes', () => {
  const row = (type: string, count: number, extra: Partial<OutcomeRow> = {}): OutcomeRow =>
    ({ month: '2026-03', programtype: 'BIP', type, subcategory: '', estimated: false, count, totaldays: count * 100, withdays: count, ...extra });
  const rows = [
    row('Completed', 6),
    row('Program Failed', 2, { subcategory: 'Attendance, Polys' }),
    row('Program Failed', 1, { programtype: 'State SO', month: '2026-04' }),
    row('Transferred', 1),
    row('Completed', 3, { estimated: true, totaldays: 0, withdays: 0 }),
  ];

  it('works out the completion rate without transfers and deaths', () => {
    const s = summarizeOutcomes(rows, '', true);
    expect([s.total, s.completed, s.counted, s.estimated]).toEqual([13, 9, 12, 3]);
    expect(s.byType.map(t => [t.label, t.count, t.avgDays])).toEqual([['Completed', 9, 100], ['Program Failed', 3, 100], ['Transferred', 1, 100]]);
  });

  it('counts a discharge with several reasons under each one', () => {
    const s = summarizeOutcomes(rows, '', true);
    expect(s.reasons.map(r => [r.label, r.count])).toEqual([['Attendance', 2], ['Polys', 2], ['Not recorded', 1]]);
  });

  it('can leave out estimated discharges and filter by program', () => {
    expect(summarizeOutcomes(rows, '', false).total).toBe(10);
    const bip = summarizeOutcomes(rows, 'BIP', true);
    expect(bip.byProgram).toEqual([{ program: 'BIP', total: 12, completed: 9, counted: 11, byType: { Completed: 9, 'Program Failed': 2, Transferred: 1 } }]);
    expect(bip.months.map(m => m.month)).toEqual(['2026-03']);
  });
});

describe('tablesToCsv', () => {
  it('writes each table with its title, header, rows, and footer', () => {
    const csv = tablesToCsv('Census', 'Jan 2026', [{ title: 'By Month', head: ['Month', 'Enrolled'], rows: [['Jan, 2026', 5]], foot: ['Total', 5] }]);
    expect(csv.split('\r\n')).toEqual(['Census,Jan 2026', '', 'By Month', 'Month,Enrolled', '"Jan, 2026",5', 'Total,5']);
  });
});
