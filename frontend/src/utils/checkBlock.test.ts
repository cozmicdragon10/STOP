import { describe, expect, it } from 'vitest';
import { checkBlocked, checkBlockedText, isCheckPayment, otherTypesForClient } from './checkBlock';
import { OTHER_PAYMENT_TYPES } from './paymentMethods';

describe('check payment block', () => {
  it('leaves Check out of the Other kinds only while blocked', () => {
    expect(otherTypesForClient(OTHER_PAYMENT_TYPES, { checkpaymentsblocked: false })).toEqual(OTHER_PAYMENT_TYPES);
    expect(otherTypesForClient(OTHER_PAYMENT_TYPES, null)).toEqual(OTHER_PAYMENT_TYPES);
    const blocked = otherTypesForClient(OTHER_PAYMENT_TYPES, { checkpaymentsblocked: true });
    expect(blocked).not.toContain('Check');
    expect(blocked).toContain('Money Order');
    expect(blocked).toContain("Cashier's Check");
  });

  it('knows a check payment', () => {
    expect(isCheckPayment('Other', 'Check')).toBe(true);
    expect(isCheckPayment('Other', "Cashier's Check")).toBe(false);
    expect(isCheckPayment('Cash', null)).toBe(false);
  });

  it('explains the block with or without a reason', () => {
    expect(checkBlocked({ checkpaymentsblocked: true })).toBe(true);
    expect(checkBlockedText({ checkblockreason: 'Check #1042 returned NSF' })).toContain('(Check #1042 returned NSF)');
    expect(checkBlockedText({})).toMatch(/^Check payments are blocked for this client\. /);
  });
});
