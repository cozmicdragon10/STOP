const { test } = require('node:test');
const assert = require('node:assert/strict');
const { forgivenessEditProblem, forgivenessProblem } = require('../lib/debtForgiveness');
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

test('Counselors and Polygraphers cannot forgive debt or change a forgiveness', () => {
    assert.equal(isCounselorAllowed('POST', '/api/clients/12/forgive-debt'), false);
    assert.equal(isAllowed('POST', '/api/clients/12/forgive-debt'), false);
    assert.equal(isCounselorAllowed('PUT', '/api/financials/7/forgiveness'), false);
    assert.equal(isAllowed('PUT', '/api/financials/7/forgiveness'), false);
});

// $30 was forgiven; the client owes $70 now
const edit = { oldAmount: 30, newAmount: 20, expectedAmount: 30, owed: 70, reason: 'Should have been $20' };

test('a forgiveness can be lowered, undone, or raised up to what is owed', () => {
    assert.equal(forgivenessEditProblem(edit), null);
    // Undo: the client owes the $30 again (wrong client, or forgiven by mistake)
    assert.equal(forgivenessEditProblem({ ...edit, newAmount: 0 }), null);
    assert.equal(forgivenessEditProblem({ ...edit, newAmount: '0.00' }), null);
    // Raised to $100 forgives the other $70 too
    assert.equal(forgivenessEditProblem({ ...edit, newAmount: 100 }), null);
    // Lowering or undoing works even when the client is in credit now
    assert.equal(forgivenessEditProblem({ ...edit, newAmount: 0, owed: -15 }), null);
});

test('a forgiveness correction is refused when it would make a credit, is unchanged, stale, or has no reason', () => {
    assert.match(forgivenessEditProblem({ ...edit, newAmount: 100.01 }), /owes \$70\.00, so this can forgive at most \$100\.00/);
    assert.match(forgivenessEditProblem({ ...edit, newAmount: 31, owed: 0 }), /at most \$30\.00/);
    assert.match(forgivenessEditProblem({ ...edit, newAmount: 30 }), /already \$30\.00/);
    for (const newAmount of ['', null, -1, 'abc']) assert.match(forgivenessEditProblem({ ...edit, newAmount }), /\$0\.00 to undo/);
    assert.match(forgivenessEditProblem({ ...edit, expectedAmount: 25 }), /changed while the form was open: it is now \$30\.00/);
    assert.match(forgivenessEditProblem({ ...edit, reason: ' ' }), /reason is required/);
});
