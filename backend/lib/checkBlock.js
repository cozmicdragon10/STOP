// Clients a Business Administrator has stopped from paying by check (Clients.CheckPaymentsBlocked), usually after one of
// their checks bounced. Every check payment goes through assertCheckAllowed, so the block holds on every screen.
// Only personal checks are blocked: money orders and cashier's checks are paid in advance, so they're still taken.
// CHECK_BLOCKED_TYPES mirrors frontend utils/checkBlock.ts (backend/test/sharedRules.test.js checks they match).
const CHECK_BLOCKED_TYPES = ['Check'];

// Whether a payment is one the check block stops (an Other payment of kind Check)
const isCheckPayment = (method, subtype) => method === 'Other' && CHECK_BLOCKED_TYPES.includes(subtype);

const checkBlockedMessage = (name, reason) =>
    `${name || 'This client'} can't pay by check${reason ? ` (${reason})` : ''}. Take another payment method instead; a Business Administrator can lift the block on the client's Ledger tab.`;

// Throws (status 403) when the client may not pay by check. db is a pool or a client inside a transaction.
async function assertCheckAllowed(db, clientId) {
    const res = await db.query('SELECT FirstName, LastName, CheckPaymentsBlocked, CheckBlockReason FROM Clients WHERE ClientId = $1', [clientId]);
    const c = res.rows[0];
    if (c?.checkpaymentsblocked) {
        throw Object.assign(new Error(checkBlockedMessage(`${c.firstname} ${c.lastname}`, c.checkblockreason)), { status: 403 });
    }
}

module.exports = { CHECK_BLOCKED_TYPES, isCheckPayment, checkBlockedMessage, assertCheckAllowed };
