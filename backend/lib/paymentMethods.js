// How a payment was made. Cash and Credit Card, or Other with a kind (PaymentSubtype) and an optional reference number
// (PaymentReference: check #, money order #, deposit or voucher reference). Assessments are cash only (routes/sessions.js).
// Mirrors frontend utils/paymentMethods.ts (backend/test/sharedRules.test.js checks they match).
const PAYMENT_METHODS = ['Cash', 'Credit Card', 'Other'];
const OTHER_PAYMENT_TYPES = ['Check', 'Money Order', "Cashier's Check", 'Direct Deposit', 'Tribal', 'DHS'];
// Paper payments someone holds until they're dropped off at the bank, like cash (Cash Deposits, Closed Groups > Cash)
const HELD_OTHER_TYPES = ['Check', 'Money Order', "Cashier's Check"];
// Money already in the bank or billed to an agency: only Business Administrators record these
const ADMIN_ONLY_OTHER_TYPES = ['Direct Deposit', 'Tribal', 'DHS'];
const REFERENCE_MAX = 100;

// The problem with a payment's method for this role (effective role: DEV reads as Business Administrator), or null.
// Only checked when something is paid.
const paymentMethodProblem = ({ method, subtype, role }) => {
    if (!PAYMENT_METHODS.includes(method)) return 'Choose a payment method: Cash, Credit Card, or Other.';
    if (method !== 'Other') return null;
    if (!OTHER_PAYMENT_TYPES.includes(subtype)) return `Choose what kind of Other payment: ${OTHER_PAYMENT_TYPES.join(', ')}.`;
    if (ADMIN_ONLY_OTHER_TYPES.includes(subtype) && role !== 'Business Administrator') {
        return `Only Business Administrators can record ${subtype} payments.`;
    }
    return null;
};

// What's saved with the payment: the kind and reference only for Other
const paymentDetails = ({ method, subtype, reference }) => (method === 'Other'
    ? { subtype, reference: String(reference ?? '').trim().slice(0, REFERENCE_MAX) || null }
    : { subtype: null, reference: null });

// The method as shown in logs and messages: "Cash", "Credit Card", "Check #1042", "DHS"
const paymentMethodText = (method, subtype, reference) => {
    if (method !== 'Other') return method || '';
    const ref = String(reference ?? '').trim();
    return `${subtype || 'Other'}${ref ? ` #${ref}` : ''}`;
};

// SQL: a row's payment is money someone holds until it's dropped off (cash, or a check / money order / cashier's check).
// prefix is the table alias with its dot ('a.', 'f.') or ''.
const HELD_PAYMENT_SQL = (prefix = '') =>
    `(${prefix}PaymentMethod = 'Cash' OR (${prefix}PaymentMethod = 'Other' AND ${prefix}PaymentSubtype IN (${HELD_OTHER_TYPES.map(t => `'${t.replace(/'/g, "''")}'`).join(', ')})))`;

module.exports = {
    PAYMENT_METHODS, OTHER_PAYMENT_TYPES, HELD_OTHER_TYPES, ADMIN_ONLY_OTHER_TYPES,
    paymentMethodProblem, paymentDetails, paymentMethodText, HELD_PAYMENT_SQL,
};
