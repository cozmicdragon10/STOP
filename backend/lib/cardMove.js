const { OPEN_GROUP_ADMIN_ROLES } = require('./access');

// Moving a credit card payment to another client's account: the wrong client was checked in and charged, so the payment
// goes to the client who actually paid. The ledger row itself moves (one card charge, on the right account), so only an
// account payment nothing else hangs on can move: no refund, dispute or saved check-in tied to it. The person who took
// the payment, an Office Admin or a Business Administrator may move it.
// tx: the FinancialTransactions row (lowercase columns). relatedCount: rows pointing at it (refunds, disputes).
// user: the signed-in employee (req.user). Returns the reason it can't move, or null.
const cardMoveProblem = ({ tx, relatedCount, fromClient, toClient, user }) => {
    if (!tx) return 'That payment no longer exists.';
    if (Number(tx.client) !== Number(fromClient)) return 'That payment is no longer on this client\'s account.';
    if (tx.type !== 'Payment' || tx.paymentmethod !== 'Credit Card') return 'Only a credit card payment can be moved this way.';
    if (tx.feetype !== 'Account Payment') return 'Only an account payment can be moved (not a poly fee payment).';
    if (tx.attendanceid) return 'This payment is already part of a saved check-in, so it can\'t be moved.';
    if (tx.disputestatus || Number(relatedCount) > 0) return 'This payment has a refund or dispute, so it can\'t be moved.';
    if (!(Number(toClient) > 0)) return 'Pick the client who paid.';
    if (Number(toClient) === Number(tx.client)) return 'Pick a different client.';
    const admin = OPEN_GROUP_ADMIN_ROLES.includes(user?.role);
    const sameEmployee = String(tx.enteredby || '').toLowerCase() === String(user?.employeeemail || '').toLowerCase();
    if (!admin && !sameEmployee) return 'Only the person who took this payment, an Office Admin or a Business Administrator can move it.';
    return null;
};

module.exports = { cardMoveProblem };
