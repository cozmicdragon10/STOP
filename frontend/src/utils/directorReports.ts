import type { AgingClient, AgingReport, CensusRow, OutcomeRow } from '../api';
import { escapeHtml } from './receipt';
import { todayLocal } from '../hooks/useGroupCheckIn';

// Adds up the director's reports (backend/lib/directorReports.js has how the server works out each number), and turns
// any of them into tables for CSV download and printing.

const num = (v: unknown) => Number(v) || 0;
const cents = (n: number) => Math.round(n * 100) / 100;
export const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 1000) / 10}%` : '—');
export const monthLabel = (month: string) =>
  new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString([], { month: 'short', year: 'numeric' });

const pad = (n: number) => String(n).padStart(2, '0');
export const formatDate = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString();
export const rangeText = (from: string, to: string) => (from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`);

// The 1st of the month n months before this one
export const monthsAgo = (n: number) => {
  const d = new Date(`${todayLocal().slice(0, 8)}01T00:00:00`);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

// --- Accounts receivable aging ---
export type StatusGroup = 'Active' | 'Inactive' | 'Discharged';
export const statusGroup = (status: string): StatusGroup => (status === 'Active' ? 'Active' : status === 'Inactive' ? 'Inactive' : 'Discharged');

export interface AgingRow { label: string; clients: number; balance: number; buckets: number[] }
export interface AgingSummary {
  bucketLabels: string[];
  clients: AgingClient[];
  byGroup: AgingRow[];
  byProgram: AgingRow[];
  total: AgingRow;
}

const agingRow = (label: string, list: AgingClient[], keys: string[]): AgingRow => ({
  label,
  clients: list.length,
  balance: cents(list.reduce((t, c) => t + num(c.balance), 0)),
  buckets: keys.map(k => cents(list.reduce((t, c) => t + num(c[k]), 0))),
});

// filter: status group ('' for all), program ('' for all), and a name or ID search
export function summarizeAging(report: AgingReport, filter: { group: string; program: string; search: string }): AgingSummary {
  const keys = report.buckets.map(b => b.key);
  const search = filter.search.trim().toLowerCase();
  const clients = report.clients.filter(c =>
    (!filter.group || statusGroup(c.programstatus) === filter.group)
    && (!filter.program || c.programtype === filter.program)
    && (!search || `${c.lastname}, ${c.firstname} ${c.firstname} ${c.lastname} ${c.docnumber ?? ''}`.toLowerCase().includes(search)));
  const groupBy = (keyOf: (c: AgingClient) => string) => {
    const map = new Map<string, AgingClient[]>();
    for (const c of clients) map.set(keyOf(c), [...(map.get(keyOf(c)) ?? []), c]);
    return [...map.entries()].map(([label, list]) => agingRow(label, list, keys)).sort((a, b) => b.balance - a.balance);
  };
  const order: StatusGroup[] = ['Active', 'Inactive', 'Discharged'];
  return {
    bucketLabels: report.buckets.map(b => b.label),
    clients,
    byGroup: groupBy(c => statusGroup(c.programstatus)).sort((a, b) => order.indexOf(a.label as StatusGroup) - order.indexOf(b.label as StatusGroup)),
    byProgram: groupBy(c => c.programtype),
    total: agingRow('All clients', clients, keys),
  };
}

// --- Census ---
export interface CensusMonth { month: string; enrolled: number; intakes: number; discharged: number; wentInactive: number; seen: number }
export interface CensusSummary {
  programs: string[];
  months: CensusMonth[];
  // Each program's latest month, with the change in enrollment since the first month
  byProgram: (CensusMonth & { program: string; change: number; intakesTotal: number; dischargedTotal: number })[];
  first: CensusMonth | null;
  last: CensusMonth | null;
  intakesTotal: number;
  dischargedTotal: number;
  inactiveTotal: number;
}

const emptyMonth = (month: string): CensusMonth => ({ month, enrolled: 0, intakes: 0, discharged: 0, wentInactive: 0, seen: 0 });
const addRow = (m: CensusMonth, r: CensusRow) => {
  m.enrolled += num(r.enrolled);
  m.intakes += num(r.intakes);
  m.discharged += num(r.discharged);
  m.wentInactive += num(r.wentinactive);
  m.seen += num(r.seen);
};

export function summarizeCensus(rows: CensusRow[], program: string): CensusSummary {
  const programs = [...new Set(rows.map(r => r.programtype))].sort((a, b) => (a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : a.localeCompare(b)));
  const shown = program ? rows.filter(r => r.programtype === program) : rows;
  const months = new Map<string, CensusMonth>();
  for (const r of shown) {
    if (!months.has(r.month)) months.set(r.month, emptyMonth(r.month));
    addRow(months.get(r.month)!, r);
  }
  const list = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  const byProgram = programs.map(p => {
    const mine = rows.filter(r => r.programtype === p).sort((a, b) => a.month.localeCompare(b.month));
    const last = emptyMonth(mine.at(-1)?.month ?? '');
    if (mine.length) addRow(last, mine.at(-1)!);
    return {
      ...last, program: p,
      change: num(mine.at(-1)?.enrolled) - num(mine[0]?.enrolled),
      intakesTotal: mine.reduce((t, r) => t + num(r.intakes), 0),
      dischargedTotal: mine.reduce((t, r) => t + num(r.discharged), 0),
    };
  }).filter(p => p.enrolled > 0 || p.intakesTotal > 0 || p.dischargedTotal > 0 || p.seen > 0)
    .sort((a, b) => b.enrolled - a.enrolled);
  return {
    programs,
    months: list,
    byProgram,
    first: list[0] ?? null,
    last: list.at(-1) ?? null,
    intakesTotal: list.reduce((t, m) => t + m.intakes, 0),
    dischargedTotal: list.reduce((t, m) => t + m.discharged, 0),
    inactiveTotal: list.reduce((t, m) => t + m.wentInactive, 0),
  };
}

// --- Discharge outcomes ---
// Transfers and deaths aren't a success or a failure of treatment, so the completion rate leaves them out
export const NEUTRAL_OUTCOMES = ['Transferred', 'Deceased'];
export const OUTCOME_ORDER = ['Completed', 'Discharged Supervision', 'Program Failed', 'Revoked', 'Terminated', 'Transferred', 'Deceased'];

export interface OutcomeLine { label: string; count: number; avgDays: number | null }
export interface OutcomeProgram { program: string; total: number; completed: number; counted: number; byType: Record<string, number> }
export interface OutcomeSummary {
  total: number;
  estimated: number;
  completed: number;
  // Discharges the completion rate is out of (all but transfers and deaths)
  counted: number;
  byType: OutcomeLine[];
  // Reasons recorded on Program Failed, Revoked, and Terminated discharges ('Not recorded' when none was)
  reasons: (OutcomeLine & { type: string })[];
  byProgram: OutcomeProgram[];
  months: { month: string; total: number; byType: Record<string, number> }[];
  types: string[];
}

const avg = (days: number, n: number) => (n > 0 ? Math.round(days / n) : null);

export function summarizeOutcomes(rows: OutcomeRow[], program: string, includeEstimated: boolean): OutcomeSummary {
  const shown = rows.filter(r => (!program || r.programtype === program) && (includeEstimated || !r.estimated));
  const types = new Map<string, { count: number; days: number; withDays: number }>();
  const reasons = new Map<string, { type: string; label: string; count: number; days: number; withDays: number }>();
  const programs = new Map<string, OutcomeProgram>();
  const months = new Map<string, { month: string; total: number; byType: Record<string, number> }>();
  let total = 0;
  let estimated = 0;
  for (const r of shown) {
    const count = num(r.count);
    total += count;
    if (r.estimated) estimated += count;
    const t = types.get(r.type) ?? { count: 0, days: 0, withDays: 0 };
    t.count += count; t.days += num(r.totaldays); t.withDays += num(r.withdays);
    types.set(r.type, t);
    if (['Program Failed', 'Revoked', 'Terminated'].includes(r.type)) {
      // A discharge with more than one reason counts under each
      for (const reason of (r.subcategory || 'Not recorded').split(', ')) {
        const key = `${r.type}|${reason}`;
        const line = reasons.get(key) ?? { type: r.type, label: reason, count: 0, days: 0, withDays: 0 };
        line.count += count; line.days += num(r.totaldays); line.withDays += num(r.withdays);
        reasons.set(key, line);
      }
    }
    const p = programs.get(r.programtype) ?? { program: r.programtype, total: 0, completed: 0, counted: 0, byType: {} };
    p.total += count;
    if (r.type === 'Completed') p.completed += count;
    if (!NEUTRAL_OUTCOMES.includes(r.type)) p.counted += count;
    p.byType[r.type] = (p.byType[r.type] ?? 0) + count;
    programs.set(r.programtype, p);
    const m = months.get(r.month) ?? { month: r.month, total: 0, byType: {} };
    m.total += count;
    m.byType[r.type] = (m.byType[r.type] ?? 0) + count;
    months.set(r.month, m);
  }
  const rank = (type: string) => (OUTCOME_ORDER.includes(type) ? OUTCOME_ORDER.indexOf(type) : OUTCOME_ORDER.length);
  const typeList = [...types.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const completed = types.get('Completed')?.count ?? 0;
  return {
    total,
    estimated,
    completed,
    counted: typeList.filter(t => !NEUTRAL_OUTCOMES.includes(t)).reduce((s, t) => s + types.get(t)!.count, 0),
    byType: typeList.map(label => ({ label, count: types.get(label)!.count, avgDays: avg(types.get(label)!.days, types.get(label)!.withDays) })),
    reasons: [...reasons.values()].sort((a, b) => rank(a.type) - rank(b.type) || b.count - a.count)
      .map(({ type, label, count, days, withDays }) => ({ type, label, count, avgDays: avg(days, withDays) })),
    byProgram: [...programs.values()].sort((a, b) => b.total - a.total),
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    types: typeList,
  };
}

// --- CSV and printing: a report is a list of tables ---
export interface ReportTable { title: string; head: string[]; rows: (string | number)[][]; foot?: (string | number)[] }

export function tablesToCsv(title: string, subtitle: string, tables: ReportTable[]): string {
  const q = (v: string | number) => {
    const t = String(v);
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines: (string | number)[][] = [[title, subtitle]];
  for (const t of tables) {
    lines.push([], [t.title], t.head, ...t.rows);
    if (t.foot) lines.push(t.foot);
  }
  return lines.map(l => l.map(q).join(',')).join('\r\n');
}

// Numbers and money line up on the right; the first column is the label
export function tablesToHtml(title: string, subtitle: string, tables: ReportTable[]): string {
  const cell = (v: string | number, i: number, tag: 'td' | 'th') =>
    `<${tag}${i > 0 ? ' class="r"' : ''}>${escapeHtml(String(v))}</${tag}>`;
  const body = tables.map(t => `<h2>${escapeHtml(t.title)}</h2><table>
    <thead><tr>${t.head.map((h, i) => cell(h, i, 'th')).join('')}</tr></thead>
    <tbody>${t.rows.map(r => `<tr>${r.map((v, i) => cell(v, i, 'td')).join('')}</tr>`).join('') || `<tr><td colspan="${t.head.length}">None</td></tr>`}</tbody>
    ${t.foot ? `<tfoot><tr>${t.foot.map((v, i) => cell(v, i, 'td')).join('')}</tr></tfoot>` : ''}</table>`).join('');
  return `<!doctype html><html><head><title>${escapeHtml(`${title} ${subtitle}`)}</title><style>
    body{font-family:Arial,sans-serif;color:#000;padding:24px;font-size:12px}h1{font-size:18px;margin:0}.muted{color:#555;margin:2px 0}
    h2{font-size:14px;margin:18px 0 4px}table{width:100%;border-collapse:collapse}th,td{padding:4px 6px;text-align:left}
    th{border-bottom:2px solid #000;font-size:11px;text-transform:uppercase}td{border-bottom:1px solid #e3e3e3}.r{text-align:right}
    tfoot td{border-top:1px solid #000;font-weight:bold}tr{page-break-inside:avoid}
    </style></head><body><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(subtitle)}</p>
    <p class="muted">Printed ${escapeHtml(new Date().toLocaleString())}</p>${body}</body></html>`;
}

// Opens the tables in a plain window and prints them; false when pop-ups are blocked
export function printTables(title: string, subtitle: string, tables: ReportTable[]): boolean {
  const win = window.open('', '_blank', 'width=1000,height=800');
  if (!win) return false;
  win.document.write(tablesToHtml(title, subtitle, tables));
  win.document.close();
  win.focus();
  win.print();
  return true;
}

export function downloadCsv(fileName: string, title: string, subtitle: string, tables: ReportTable[]) {
  const url = URL.createObjectURL(new Blob([tablesToCsv(title, subtitle, tables)], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
