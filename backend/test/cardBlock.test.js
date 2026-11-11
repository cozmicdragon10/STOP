const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertCardAllowed, cardBlockedMessage } = require('../lib/cardBlock');

// A stand-in for the database: answers the client lookup with the given row
const dbWith = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });

test('a client without a block may pay by card', async () => {
    await assertCardAllowed(dbWith({ firstname: 'Jason', lastname: 'Sanchez', cardpaymentsblocked: false }), 1);
    await assertCardAllowed(dbWith(null), 1);
});

test('a blocked client is refused with a 403 naming them and the reason', async () => {
    await assert.rejects(
        assertCardAllowed(dbWith({ firstname: 'Jason', lastname: 'Sanchez', cardpaymentsblocked: true, cardblockreason: 'Disputed charge' }), 1),
        (err) => err.status === 403 && /Jason Sanchez can't pay by credit card \(Disputed charge\)/.test(err.message),
    );
});

test('the message reads well without a reason', () => {
    assert.match(cardBlockedMessage('Jason Sanchez', null), /^Jason Sanchez can't pay by credit card\. Take cash/);
});
