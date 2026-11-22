// Money on Hand screen rules (components/moneyOnHand/MoneyOnHand.tsx). The server (backend lib/moneyOnHand.js) decides
// who holds what and checks every hand-off and deposit; these only group and total what it sent.
import type { BankDeposit, MoneyCheck, MoneyItem, PickedMoney } from '../api';

export const toCents = (n: number | string | null | undefined) => Math.round(Number(n || 0) * 100);
export const moneyText = (n: number | string | null | undefined) => `$${(toCents(n) / 100).toFixed(2)}`;
export const sameEmail = (a?: string | null, b?: string | null) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

export const shortDate = (ymd: string) => {
  const [y, m, d] = String(ymd || '').split('-');
  return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : ymd;
};

// "Tulsa BIP · 11/20/2026 · Session 2", or "Smith, John · Assessment Fee · 11/16/2026"
export const itemTitle = (i: Pick<MoneyItem, 'kind' | 'label' | 'clientname' | 'eventdate' | 'sessionnumber'>) => (i.kind === 'group'
  ? `${i.label} · ${shortDate(i.eventdate)}${Number(i.sessionnumber) > 1 ? ` · Session ${i.sessionnumber}` : ''}`
  : `${i.clientname || 'Unknown client'} · ${i.label} · ${shortDate(i.eventdate)}`);

// "Check #1042", "Money Order", ...
export const checkText = (c: Pick<MoneyCheck, 'kind' | 'reference'>) => `${c.kind || 'Check'}${c.reference ? ` #${c.reference}` : ''}`;

// The cash part of some money (everything that isn't a check, money order or cashier's check) and the checks
export const cashAndChecks = (items: { amount: number | string; checks: MoneyCheck[] }[]) => {
  let total = 0;
  let checkTotal = 0;
  const checks: MoneyCheck[] = [];
  for (const i of items) {
    total += toCents(i.amount);
    for (const c of i.checks || []) {
      checkTotal += toCents(c.amount);
      checks.push(c);
    }
  }
  return { total: total / 100, cash: (total - checkTotal) / 100, checkTotal: checkTotal / 100, checks };
};

export interface Holder {
  email: string;
  name: string;
  items: MoneyItem[];
  total: number;
}

// The money on hand by who holds it: the viewer first, then by name
export const holdersOf = (items: MoneyItem[], me: string): Holder[] => {
  const byEmail = new Map<string, Holder>();
  for (const i of items) {
    const key = i.holder.trim().toLowerCase();
    let h = byEmail.get(key);
    if (!h) byEmail.set(key, h = { email: i.holder, name: i.holdername || i.holder, items: [], total: 0 });
    h.items.push(i);
    h.total = (toCents(h.total) + toCents(i.amount)) / 100;
  }
  return [...byEmail.values()].sort((a, b) => Number(sameEmail(b.email, me)) - Number(sameEmail(a.email, me)) || a.name.localeCompare(b.name));
};

// Items that can go in a hand-off or deposit now: not waiting on a hand-off
export const isPickable = (i: MoneyItem) => !i.pendinghandoffid;

// What's sent for the picked items: each one's key and the amount shown
export const pickedOf = (items: MoneyItem[]): PickedMoney => items.map(i => ({ key: i.itemkey, amount: Number(i.amount) }));

// Whole days since a time (0 the same day). null when unknown.
export const daysSince = (when: string | null | undefined, now = new Date()) => {
  if (!when) return null;
  const then = new Date(when);
  if (Number.isNaN(then.getTime())) return null;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((startOf(now) - startOf(then)) / 86_400_000));
};

// Money held longer than this many days is flagged so it gets to the bank
export const HELD_TOO_LONG_DAYS = 3;

// "today", "1 day", "5 days"
export const heldForText = (days: number | null) => (days === null ? '' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`);

// The bank's amount minus what was dropped off (positive over, negative short), or null until checked
export const depositDifference = (d: Pick<BankDeposit, 'total' | 'bankamount'>) => (d.bankamount === null || d.bankamount === undefined || d.bankamount === ''
  ? null
  : (toCents(d.bankamount) - toCents(d.total)) / 100);

export type DepositStatus = 'voided' | 'waiting' | 'balanced' | 'short' | 'over';
export const depositStatus = (d: Pick<BankDeposit, 'total' | 'bankamount' | 'verifiedon' | 'voidedon'>): DepositStatus => {
  if (d.voidedon) return 'voided';
  if (!d.verifiedon) return 'waiting';
  const diff = depositDifference(d) ?? 0;
  return diff === 0 ? 'balanced' : diff < 0 ? 'short' : 'over';
};

export const depositStatusText = (d: Pick<BankDeposit, 'total' | 'bankamount' | 'verifiedon' | 'voidedon'>) => {
  const status = depositStatus(d);
  const diff = Math.abs(depositDifference(d) ?? 0);
  return {
    voided: 'Voided',
    waiting: 'Not checked against the bank yet',
    balanced: 'Bank matches',
    short: `Bank shows ${moneyText(diff)} short`,
    over: `Bank shows ${moneyText(diff)} over`,
  }[status];
};
