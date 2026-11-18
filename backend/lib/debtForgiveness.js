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

// Why a correction to a forgiveness can't be saved, or null. A wrong amount is changed to the right one; a wrong client
// (or one forgiven by mistake) is undone by changing it to $0.00, so the client owes it again. oldAmount: what the row
// forgives now; expectedAmount: what the screen showed (refused if someone corrected it meanwhile); owed: what the
// client owes now. Forgiving more can't put the account in credit. The ledger's Change/Undo form applies the same
// limits (frontend/src/components/clients/ClientLedger.tsx).
const forgivenessEditProblem = ({ oldAmount, newAmount, expectedAmount, owed, reason }) => {
    if (expectedAmount !== undefined && expectedAmount !== null && cents(expectedAmount) !== cents(oldAmount)) {
        return `This forgiveness was changed while the form was open: it is now $${Number(oldAmount).toFixed(2)}. Check it and try again.`;
    }
    if (newAmount === '' || newAmount === null || newAmount === undefined || !Number.isFinite(Number(newAmount)) || cents(newAmount) < 0) {
        return 'Enter the amount that should have been forgiven, or $0.00 to undo it.';
    }
    if (cents(newAmount) === cents(oldAmount)) return `The forgiveness is already $${Number(oldAmount).toFixed(2)}.`;
    const more = cents(newAmount) - cents(oldAmount);
    if (more > Math.max(0, cents(owed))) {
        return `The client owes $${Math.max(0, Number(owed)).toFixed(2)}, so this can forgive at most $${((cents(oldAmount) + Math.max(0, cents(owed))) / 100).toFixed(2)}.`;
    }
    if (!String(reason || '').trim()) return 'A reason is required to change or undo a forgiveness.';
    return null;
};

module.exports = { FORGIVEN_FEE_TYPE, forgivenessProblem, forgivenessEditProblem };
