const { test } = require('node:test');
const assert = require('node:assert/strict');
const { forgivenessProblem } = require('../lib/debtForgiveness');
const { isCounselorAllowed } = require('../lib/counselorAccess');
const { isAllowed } = require('../lib/polygrapherAccess');

const ok = { amount: 50, reason: 'Hardship, approved by the director', owed: 120, expectedOwed: 120 };

test('debt can be forgiven up to what is owed, with a reason', () => {
    assert.equal(forgivenessProblem(ok), null);
    assert.equal(forgivenessProblem({ ...ok, amount: 120 }), null);
    assert.equal(forgivenessProblem({ ...ok, amount: '120.00', owed: '120.00', expectedOwed: '120' }), null);
    // Sent without the balance the form saw: only the server's checks apply
    assert.equal(forgivenessProblem({ ...ok, expectedOwed: undefined }), null);
});

test('forgiving debt is refused when nothing is owed, the amount is wrong, or there is no reason', () => {
    assert.match(forgivenessProblem({ ...ok, owed: 0, expectedOwed: 0 }), /does not owe/);
    assert.match(forgivenessProblem({ ...ok, owed: -30, expectedOwed: -30 }), /does not owe/);
    for (const amount of [0, -5, '', null, 'abc']) assert.match(forgivenessProblem({ ...ok, amount }), /more than \$0\.00/);
    // Can't push the account into credit
    assert.match(forgivenessProblem({ ...ok, amount: 120.01 }), /up to what the client owes, \$120\.00/);
    assert.match(forgivenessProblem({ ...ok, reason: '   ' }), /reason is required/);
});

test('a balance that changed while the form was open is refused', () => {
    // Someone took a $40 payment meanwhile
    assert.match(forgivenessProblem({ ...ok, owed: 80 }), /changed while the form was open: the client now owes \$80\.00/);
});

test('Counselors and Polygraphers cannot forgive debt', () => {
    assert.equal(isCounselorAllowed('POST', '/api/clients/12/forgive-debt'), false);
    assert.equal(isAllowed('POST', '/api/clients/12/forgive-debt'), false);
});
