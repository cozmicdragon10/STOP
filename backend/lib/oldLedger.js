// Ledger rows for the old system's money (import/importLedger.js): each imported check-in's fee and payment, and the old
// system's account-only entries (payments with no check-in, which the attendance import turned into case notes).
//
// Amounts are as the old system recorded them (the same ones the imported attendance shows), and the balance on the
// entry's last row is the old system's balance after it. The old system's arithmetic doesn't always add up from one entry
// to the next (edits, polygraph money in the paid amount), so the ledger shows these rows' balance after, not before.
//
// Rows follow the app's own: a check-in that took a payment has one row, its payment (the ledger shows the check-in's
// fee beside it, SESSION_FEE_SQL in lib/sql.js); one with no payment has a Charge row for its fee. Negative amounts in the
// old data become a Refund (money paid back) or an Adjustment (a fee taken off), which move the balance the right way.

const cents = (n) => Math.round(Number(n || 0) * 100) / 100;
const money = (n) => `$${Math.abs(cents(n)).toFixed(2)}`;
const FROM_OLD = 'From the old system.';
const CHECK_IN_FEE_TYPES = { Group: 'Group Fee', Assessment: 'Assessment Fee', Individual: 'Individual Fee' };
const OLD_CREDIT_FEE_TYPE = 'Old System Credit';
const OLD_ACCOUNT_FEE_TYPE = 'Old System Fee';

// How a row moves what the client owes (stored sign: positive = owes)
const effectOf = (row) => (row.type === 'Charge' || row.type === 'Refund' ? row.amount : -row.amount) + (row.sessionFee || 0);

// Gives each row its balance after, working back from the entry's final balance (finalOwed, stored sign)
const withBalances = (rows, finalOwed) => {
    let after = cents(finalOwed);
    for (let i = rows.length - 1; i >= 0; i--) {
        rows[i].finalBalance = after;
        after = cents(after - effectOf(rows[i]));
    }
    return rows.map(({ sessionFee: _sessionFee, ...row }) => row);
};

/**
 * Rows for one imported check-in, oldest first: { type, amount, feeType, finalBalance, comments }.
 * @param {{ type: string, day: string, fee: number, paid: number, finalOwed: number }} p  type: Group, Assessment or
 *   Individual; day: YYYY-MM-DD; finalOwed: the attendance's balance after (AccountTotal, stored sign)
 */
const checkInRows = ({ type, day, fee, paid, finalOwed }) => {
    fee = cents(fee); paid = cents(paid);
    const feeType = CHECK_IN_FEE_TYPES[type] || `${type} Fee`;
    const paymentText = `Payment applied during ${type} session on ${day}. ${FROM_OLD}`;
    const rows = [];
    if (paid > 0 && fee > 0) {
        rows.push({ type: 'Payment', amount: paid, feeType, comments: paymentText, sessionFee: fee });
    } else {
        if (fee > 0) rows.push({ type: 'Charge', amount: fee, feeType, comments: `${type} fee assessed on ${day}. ${FROM_OLD}` });
        if (fee < 0) rows.push({ type: 'Adjustment', amount: -fee, feeType: OLD_CREDIT_FEE_TYPE, comments: `${type} on ${day}: ${money(fee)} taken off the fee. ${FROM_OLD}` });
        if (paid > 0) rows.push({ type: 'Payment', amount: paid, feeType, comments: paymentText });
    }
    if (paid < 0) rows.push({ type: 'Refund', amount: -paid, feeType, comments: `${type} on ${day}: ${money(paid)} paid back. ${FROM_OLD}` });
    return withBalances(rows, finalOwed);
};

/**
 * Rows for one old account-only entry (no check-in), oldest first. comment: the old entry's text.
 * @param {{ fee: number, paid: number, finalOwed: number, comment?: string|null }} p
 */
const accountRows = ({ fee, paid, finalOwed, comment }) => {
    fee = cents(fee); paid = cents(paid);
    const text = `Old system account entry${comment ? `: ${comment}` : '.'}`;
    const rows = [];
    if (fee > 0) rows.push({ type: 'Charge', amount: fee, feeType: OLD_ACCOUNT_FEE_TYPE, comments: text });
    if (fee < 0) rows.push({ type: 'Adjustment', amount: -fee, feeType: OLD_CREDIT_FEE_TYPE, comments: text });
    if (paid > 0) rows.push({ type: 'Payment', amount: paid, feeType: 'Account Payment', comments: text });
    if (paid < 0) rows.push({ type: 'Refund', amount: -paid, feeType: 'Account Payment', comments: `${text} (${money(paid)} paid back)` });
    return withBalances(rows, finalOwed);
};

module.exports = { checkInRows, accountRows, OLD_CREDIT_FEE_TYPE, OLD_ACCOUNT_FEE_TYPE, FROM_OLD };
