// Clients a Business Administrator has stopped from paying by credit card (Clients.CardPaymentsBlocked), usually after
// a card payment was disputed. Every card payment goes through assertCardAllowed, so the block holds on every screen.

const cardBlockedMessage = (name, reason) =>
    `${name || 'This client'} can't pay by credit card${reason ? ` (${reason})` : ''}. Take cash instead; a Business Administrator can lift the block on the client's Ledger tab.`;

// Throws (status 403) when the client may not pay by card. db is a pool or a client inside a transaction.
async function assertCardAllowed(db, clientId) {
    const res = await db.query('SELECT FirstName, LastName, CardPaymentsBlocked, CardBlockReason FROM Clients WHERE ClientId = $1', [clientId]);
    const c = res.rows[0];
    if (c?.cardpaymentsblocked) {
        throw Object.assign(new Error(cardBlockedMessage(`${c.firstname} ${c.lastname}`, c.cardblockreason)), { status: 403 });
    }
}

module.exports = { assertCardAllowed, cardBlockedMessage };
