const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertCheckAllowed, checkBlockedMessage, isCheckPayment } = require('../lib/checkBlock');

// A stand-in for the database: answers the client lookup with the given row
const dbWith = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });

test('only a personal check counts as a check payment', () => {
    assert.equal(isCheckPayment('Other', 'Check'), true);
    assert.equal(isCheckPayment('Other', 'Money Order'), false);
    assert.equal(isCheckPayment('Other', "Cashier's Check"), false);
    assert.equal(isCheckPayment('Cash', null), false);
    assert.equal(isCheckPayment('Credit Card', 'Check'), false);
});

test('a client without a block may pay by check', async () => {
    await assertCheckAllowed(dbWith({ firstname: 'Jason', lastname: 'Sanchez', checkpaymentsblocked: false }), 1);
    await assertCheckAllowed(dbWith(null), 1);
});

test('a blocked client is refused with a 403 naming them and the reason', async () => {
    await assert.rejects(
        assertCheckAllowed(dbWith({ firstname: 'Jason', lastname: 'Sanchez', checkpaymentsblocked: true, checkblockreason: 'Check #1042 returned NSF' }), 1),
        (err) => err.status === 403 && /Jason Sanchez can't pay by check \(Check #1042 returned NSF\)/.test(err.message),
    );
});

test('the message reads well without a reason', () => {
    assert.match(checkBlockedMessage('Jason Sanchez', null), /^Jason Sanchez can't pay by check\. Take another/);
});
