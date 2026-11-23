// A Business Administrator can stop a client from paying by check (usually after one of their checks bounced).
// Payment screens leave Check out of the Other payment kinds for them; the server refuses check payments too.
// Only personal checks are blocked: money orders and cashier's checks are still taken.
// CHECK_BLOCKED_TYPES mirrors backend lib/checkBlock.js (backend/test/sharedRules.test.js checks they match).
export const CHECK_BLOCKED_TYPES = ['Check'];

interface MaybeBlocked {
  checkpaymentsblocked?: boolean | null;
  checkblockreason?: string | null;
}

export const checkBlocked = (client: MaybeBlocked | null | undefined): boolean => Boolean(client?.checkpaymentsblocked);

// Whether a payment is one the check block stops (an Other payment of kind Check)
export const isCheckPayment = (method: string | null | undefined, subtype: string | null | undefined): boolean =>
  method === 'Other' && CHECK_BLOCKED_TYPES.includes(subtype || '');

// The Other payment kinds this client may use: Check is left out while checks are blocked
export const otherTypesForClient = (types: string[], client: MaybeBlocked | null | undefined): string[] =>
  checkBlocked(client) ? types.filter(t => !CHECK_BLOCKED_TYPES.includes(t)) : types;

// Shown under the payment method choices
export const checkBlockedText = (client: MaybeBlocked | null | undefined): string =>
  `Check payments are blocked for this client${client?.checkblockreason ? ` (${client.checkblockreason})` : ''}. Money orders and cashier's checks are still taken.`;
