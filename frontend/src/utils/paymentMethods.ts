// How a payment was made. Cash and Credit Card, or Other with a kind (paymentSubtype) and an optional reference number
// (paymentReference: check #, money order #, deposit or voucher reference). Assessments are cash only.
// Mirrors backend lib/paymentMethods.js (backend/test/sharedRules.test.js checks they match).
export const PAYMENT_METHODS = ['Cash', 'Credit Card', 'Other'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export const OTHER_PAYMENT_TYPES = ['Check', 'Money Order', "Cashier's Check", 'Direct Deposit', 'Tribal', 'DHS'];
// Paper payments someone holds until they're dropped off at the bank, like cash
export const HELD_OTHER_TYPES = ['Check', 'Money Order', "Cashier's Check"];
// Money already in the bank or billed to an agency: only Business Administrators record these
export const ADMIN_ONLY_OTHER_TYPES = ['Direct Deposit', 'Tribal', 'DHS'];

// The Other payment kinds this role may record (the server checks the same)
export const otherTypesFor = (role: string | null | undefined) =>
  role === 'Business Administrator' ? OTHER_PAYMENT_TYPES : OTHER_PAYMENT_TYPES.filter(t => !ADMIN_ONLY_OTHER_TYPES.includes(t));

// The problem with a payment's method for this role, or null (only matters when something is paid)
export const paymentMethodProblem = (method: string, subtype: string | null | undefined, role: string | null | undefined): string | null => {
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) return 'Choose a payment method: Cash, Credit Card, or Other.';
  if (method !== 'Other') return null;
  if (!subtype || !OTHER_PAYMENT_TYPES.includes(subtype)) return 'Choose what kind of Other payment it is.';
  if (!otherTypesFor(role).includes(subtype)) return `Only Business Administrators can record ${subtype} payments.`;
  return null;
};

// The method as shown: "Cash", "Credit Card", "Check #1042", "DHS"
export const paymentMethodText = (method: string | null | undefined, subtype?: string | null, reference?: string | null) => {
  if (method !== 'Other') return method || '';
  const ref = String(reference ?? '').trim();
  return `${subtype || 'Other'}${ref ? ` #${ref}` : ''}`;
};

// Whether a payment is money someone holds until it's dropped off (cash, check, money order, cashier's check)
export const isHeldPayment = (method: string | null | undefined, subtype?: string | null) =>
  method === 'Cash' || (method === 'Other' && HELD_OTHER_TYPES.includes(subtype || ''));
