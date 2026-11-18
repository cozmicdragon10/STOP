// Forgiving debt: a Business Administrator (or DEV) writes off some or all of what a client owes. It is saved as an
// Adjustment ledger row (FeeType 'Debt Forgiven'): it lowers the balance without being a payment, so cash and income
// reports leave it out. Mirrors forgivenessProblem in frontend/src/utils/ledger.ts.
const FORGIVEN_FEE_TYPE = 'Debt Forgiven';

const cents = (n) => Math.round(Number(n) * 100);

// Why a forgiveness can't be saved, or null. owed: what the client owes now (stored balance, positive = owes);
// expectedOwed: what the screen showed when the form was opened (refused if it changed meanwhile).
const forgivenessProblem = ({ amount, reason, owed, expectedOwed }) => {
    if (!(cents(owed) > 0)) return 'This client does not owe anything, so there is no debt to forgive.';
    if (expectedOwed !== undefined && expectedOwed !== null && cents(expectedOwed) !== cents(owed)) {
        return `The balance changed while the form was open: the client now owes $${Number(owed).toFixed(2)}. Check the amount and try again.`;
    }
    if (!(cents(amount) > 0)) return 'Enter an amount to forgive, more than $0.00.';
    if (cents(amount) > cents(owed)) return `You can forgive up to what the client owes, $${Number(owed).toFixed(2)}.`;
    if (!String(reason || '').trim()) return 'A reason is required to forgive debt.';
    return null;
};

module.exports = { FORGIVEN_FEE_TYPE, forgivenessProblem };
