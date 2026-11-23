import { SO_PHASES } from './soPhases';
import { isWholeNumber } from './clients';

// Click-to-sort for tables. A table starts in its own order; clicking a column header sorts by it ascending, clicking
// again sorts descending, and a third click puts the table back in its own order.

export type SortValue = string | number | null | undefined;
export type SortDir = 'asc' | 'desc';
export type SortState<K extends string = string> = { key: K; dir: SortDir } | null;

// The next sort after clicking a column header
export const nextSort = <K extends string>(current: SortState<K>, key: K): SortState<K> => {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : null;
};

const isEmpty = (v: SortValue) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && Number.isNaN(v));

// Compares two cell values ascending: numbers by size, text alphabetically (numbers inside text in number order).
// Empty cells are not compared here; sortRows always puts them last.
export const compareValues = (a: SortValue, b: SortValue) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

// The rows in the sort's order (a new array; the rows passed in are not changed). Empty cells go last in either
// direction, and rows that tie keep their own order. With no sort, the rows come back in their own order.
export const sortRows = <T, K extends string>(rows: readonly T[], sort: SortState<K>, valueOf: (row: T, key: K) => SortValue): T[] => {
  if (!sort) return [...rows];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row, sort.key) }))
    .sort((x, y) => {
      const ex = isEmpty(x.value), ey = isEmpty(y.value);
      if (ex || ey) return ex === ey ? x.index - y.index : ex ? 1 : -1;
      return compareValues(x.value, y.value) * sign || x.index - y.index;
    })
    .map(r => r.row);
};

// The sort value of a row's field, for tables whose column keys are the row's own field names
export const byField = <T, K extends keyof T & string>(row: T, key: K): SortValue => {
  const v = row[key] as unknown;
  return typeof v === 'number' || typeof v === 'string' ? v : typeof v === 'boolean' ? Number(v) : null;
};

// A sort value for a cell shown as text: amounts ("$1,234.50", "-$20.00"), counts, signed changes ("+3") and percents
// ("12.5%") sort as numbers; dates written as M/D/YYYY sort by date; "—" is empty; anything else sorts as text.
export const valueFromText = (text: string | number | null | undefined): SortValue => {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return text;
  const t = text.trim();
  if (t === '' || t === '—' || t === '-') return null;
  const n = t.match(/^([+-])?\$?([\d,]*\.?\d+)%?$/);
  if (n) return Number(n[2].replace(/,/g, '')) * (n[1] === '-' ? -1 : 1);
  const d = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (d) return Number(d[3]) * 10000 + Number(d[1]) * 100 + Number(d[2]);
  return t;
};

// A phase in program order (the SO phases in order, then numbered phases, then anything else alphabetically), the same
// order the Client Roster uses; no phase is empty
export const phaseValue = (phase: string | null | undefined): SortValue => {
  const p = String(phase ?? '').trim();
  if (!p || p === '—') return null;
  const rank = SO_PHASES.includes(p) ? SO_PHASES.indexOf(p) : isWholeNumber(p) ? 100 + Number(p) : 999999;
  return `${String(rank).padStart(6, '0')} ${p.toLowerCase()}`;
};

// Time value of a date or timestamp text for sorting; empty or unreadable is null
export const timeValue = (value: string | null | undefined): SortValue => {
  if (!value) return null;
  const s = String(value);
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  return Number.isNaN(ms) ? null : ms;
};
