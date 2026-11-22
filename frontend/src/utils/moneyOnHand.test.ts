import { describe, expect, it } from 'vitest';
import type { MoneyItem } from '../api';
import {
  cashAndChecks, checkText, daysSince, depositDifference, depositStatus, depositStatusText, heldForText, holdersOf,
  isPickable, itemTitle, moneyText, pickedOf,
} from './moneyOnHand';

const item = (over: Partial<MoneyItem>): MoneyItem => ({
  itemkey: 'p:1', kind: 'payment', groupid: null, sessionnumber: null, transactionid: 1, clientid: 5, label: 'Payment',
  clientname: 'Smith, John', eventdate: '2026-11-20', collectedon: null, amount: '10.00', collector: 'amy@x', collectorname: 'Amy',
  method: 'Cash', checks: [], holder: 'amy@x', holdername: 'Amy', heldsince: null, pendinghandoffid: null, pendingto: null,
  ...over,
});

describe('money on hand', () => {
  it('names group sessions and payments', () => {
    expect(itemTitle(item({ kind: 'group', label: 'Tulsa BIP', sessionnumber: 1 }))).toBe('Tulsa BIP · 11/20/2026');
    expect(itemTitle(item({ kind: 'group', label: 'Tulsa BIP', sessionnumber: 2 }))).toBe('Tulsa BIP · 11/20/2026 · Session 2');
    expect(itemTitle(item({ label: 'Assessment Fee' }))).toBe('Smith, John · Assessment Fee · 11/20/2026');
    expect(checkText({ kind: 'Money Order', reference: 'MO-7' })).toBe('Money Order #MO-7');
    expect(checkText({ kind: null, reference: null })).toBe('Check');
  });

  it('splits cash from checks to the cent', () => {
    const r = cashAndChecks([
      { amount: '120.10', checks: [{ kind: 'Check', reference: '1', amount: 40.05, client: 'A' }] },
      { amount: 0.2, checks: [] },
      { amount: '30', checks: [{ kind: 'Money Order', reference: null, amount: '30', client: 'B' }] },
    ]);
    expect(r).toEqual({ total: 150.3, cash: 80.25, checkTotal: 70.05, checks: expect.any(Array) });
    expect(r.checks).toHaveLength(2);
  });

  it('groups by holder with the viewer first', () => {
    const holders = holdersOf([
      item({ itemkey: 'p:1', holder: 'zed@x', holdername: 'Zed', amount: '5' }),
      item({ itemkey: 'p:2', holder: 'Me@x', holdername: 'Me', amount: '0.1' }),
      item({ itemkey: 'p:3', holder: 'amy@x', holdername: 'Amy', amount: '1' }),
      item({ itemkey: 'p:4', holder: 'me@x', holdername: 'Me', amount: '0.2' }),
    ], 'me@x');
    expect(holders.map(h => h.name)).toEqual(['Me', 'Amy', 'Zed']);
    expect(holders[0].total).toBe(0.3);
    expect(holders[0].items).toHaveLength(2);
  });

  it('leaves out money waiting on a hand-off, and sends amounts as shown', () => {
    expect(isPickable(item({}))).toBe(true);
    expect(isPickable(item({ pendinghandoffid: 4 }))).toBe(false);
    expect(pickedOf([item({ itemkey: 'g:1:2026-11-20:1', amount: '120.50' })])).toEqual([{ key: 'g:1:2026-11-20:1', amount: 120.5 }]);
  });

  it('counts days held by calendar day', () => {
    const now = new Date(2026, 10, 22, 9, 0);
    expect(daysSince(new Date(2026, 10, 22, 8, 0).toISOString(), now)).toBe(0);
    expect(daysSince(new Date(2026, 10, 21, 23, 0).toISOString(), now)).toBe(1);
    expect(daysSince(new Date(2026, 10, 17, 12, 0).toISOString(), now)).toBe(5);
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince('not a date', now)).toBeNull();
    expect(heldForText(0)).toBe('today');
    expect(heldForText(1)).toBe('1 day');
    expect(heldForText(4)).toBe('4 days');
  });

  it('shows a deposit as waiting, matched, short, over, or voided', () => {
    const d = { total: '160.00', bankamount: null, verifiedon: null, voidedon: null };
    expect(depositStatus(d)).toBe('waiting');
    expect(depositDifference(d)).toBeNull();
    expect(depositStatus({ ...d, bankamount: '160', verifiedon: 'x' })).toBe('balanced');
    expect(depositStatus({ ...d, bankamount: 155.5, verifiedon: 'x' })).toBe('short');
    expect(depositStatusText({ ...d, bankamount: 155.5, verifiedon: 'x' })).toBe('Bank shows $4.50 short');
    expect(depositStatusText({ ...d, bankamount: '170.01', verifiedon: 'x' })).toBe('Bank shows $10.01 over');
    expect(depositStatus({ ...d, voidedon: 'x' })).toBe('voided');
    expect(moneyText(0.1 + 0.2)).toBe('$0.30');
  });
});
