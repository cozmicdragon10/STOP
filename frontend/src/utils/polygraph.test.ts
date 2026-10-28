import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLY_VOUCHER_MAX, polygraphHistoryText, polygraphNotice, polySchedulingNeeds, polyVoucherReturnRule, slotStart } from './polygraph';

afterEach(() => {
  vi.useRealTimers();
});

describe('polySchedulingNeeds', () => {
  it('is met with full vouchers and nothing owed (a credit balance is fine)', () => {
    expect(polySchedulingNeeds({ polyfeevoucher: POLY_VOUCHER_MAX, accountbalance: '-25.00' }).met).toBe(true);
  });

  it('asks for the rest of the poly fee while vouchers are short', () => {
    const needs = polySchedulingNeeds({ polyfeevoucher: 2, polyfeepaid: '100', polyfee: '250', accountbalance: '0' });
    expect(needs).toMatchObject({ short: true, polyDue: 150, balanceDue: 0, met: false });
  });

  it('asks for the account balance even with full vouchers', () => {
    const needs = polySchedulingNeeds({ polyfeevoucher: POLY_VOUCHER_MAX, polyfeepaid: '0', polyfee: '250', accountbalance: '40' });
    expect(needs).toMatchObject({ short: false, polyDue: 0, balanceDue: 40, met: false });
  });
});

describe('slotStart', () => {
  it('reads 12-hour and 24-hour slot times as local time', () => {
    expect(slotStart({ date: '2026-03-10', time: '2:30 PM' })).toEqual(new Date(2026, 2, 10, 14, 30));
    expect(slotStart({ date: '2026-03-10T00:00:00.000Z', time: '14:30:00' })).toEqual(new Date(2026, 2, 10, 14, 30));
    expect(slotStart({ date: '2026-03-10', time: '12:15 AM' })).toEqual(new Date(2026, 2, 10, 0, 15));
  });

  it('returns null when the slot cannot be read', () => {
    expect(slotStart({ date: '2026-03-10', time: 'noon' })).toBeNull();
    expect(slotStart(null)).toBeNull();
  });
});

describe('polyVoucherReturnRule', () => {
  const slot = { date: '2026-03-10', time: '14:00' };

  it('is fixed by the reason for examiner, weather, and no-show cancellations', () => {
    expect(polyVoucherReturnRule('Weather', slot)).toBe(true);
    expect(polyVoucherReturnRule('Examiner rescheduled', slot)).toBe(true);
    expect(polyVoucherReturnRule('Client late / did not show', slot)).toBe(false);
    expect(polyVoucherReturnRule('Other', slot)).toBeNull();
  });

  it('returns vouchers for client cancellations only with 48 hours notice', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 7, 10, 0));
    expect(polyVoucherReturnRule('Client requested cancellation', slot)).toBe(true);
    vi.setSystemTime(new Date(2026, 2, 9, 10, 0));
    expect(polyVoucherReturnRule('Client requested cancellation', slot)).toBe(false);
    expect(polyVoucherReturnRule('Client requested cancellation', { date: '', time: '' })).toBeNull();
  });
});

describe('polygraphNotice', () => {
  const today = new Date(2026, 6, 15);

  it('does not apply to BIP clients or clients with No Poly Required', () => {
    expect(polygraphNotice({ programtype: 'BIP' }, [], today)).toBeNull();
    expect(polygraphNotice({ programtype: 'State SO', nopolyrequired: true }, [], today)).toBeNull();
  });

  it('flags a polygraph six or more months old', () => {
    const client = { programtype: 'State SO' };
    expect(polygraphNotice(client, [{ date: '2026-01-15' }], today)).toBe('Client is overdue for their next Polygraph');
    expect(polygraphNotice(client, [{ date: '2026-01-16' }], today)).toBeNull();
  });

  it('says the first polygraph is still to come once the client has attended', () => {
    expect(polygraphNotice({ programtype: 'State SO', lastdateattended: '2026-07-05' }, [], today))
      .toBe("Client hasn't taken their first polygraph yet");
    expect(polygraphNotice({ programtype: 'State SO' }, [], today)).toBeNull();
  });
});

describe('polygraphHistoryText', () => {
  it('says when no polygraph has been taken', () => {
    expect(polygraphHistoryText([])).toBe('No polygraph taken yet.');
  });

  it('uses the polygraph date and time over the recorded date', () => {
    const text = polygraphHistoryText([{ date: '2026-01-01', polygraphdatetime: new Date(2026, 6, 10, 9).toISOString() }], new Date(2026, 6, 15));
    expect(text.startsWith('5 days since last polygraph')).toBe(true);
    expect(text.endsWith(').')).toBe(true);
  });
});
