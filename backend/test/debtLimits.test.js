const { test } = require('node:test');
const assert = require('node:assert/strict');
const { debtLimitProblem, MAX_DEBT_LIMIT } = require('../lib/debtLimits');
const { minimumCheckInPayment } = require('../lib/attendance');
const { isCounselorAllowed } = require('../lib/counselorAccess');

const ok = { maxOwed: 150, expirationDate: '2026-12-31', today: '2026-11-16' };

test('a max debt override needs an amount above $0.00, up to the ceiling, and a date from today on', () => {
    assert.equal(debtLimitProblem(ok), null);
    assert.equal(debtLimitProblem({ ...ok, expirationDate: '2026-11-16' }), null);
    for (const maxOwed of ['', null, 0, -5, 'abc']) assert.match(debtLimitProblem({ ...ok, maxOwed }), /more than \$0\.00/);
    assert.match(debtLimitProblem({ ...ok, maxOwed: MAX_DEBT_LIMIT + 1 }), /up to/);
    assert.match(debtLimitProblem({ ...ok, expirationDate: '' }), /expiration date/);
    assert.match(debtLimitProblem({ ...ok, validDate: false }), /expiration date/);
    assert.match(debtLimitProblem({ ...ok, expirationDate: '2026-11-15' }), /past/);
});

test('the override raises the balance a check-in allows', () => {
    // First check-in of the month: owing $80 normally needs $80; with a $100 limit nothing; owing $130 needs $30
    assert.equal(minimumCheckInPayment('first', 80, 40, false), 80);
    assert.equal(minimumCheckInPayment('first', 80, 40, false, 100), 0);
    assert.equal(minimumCheckInPayment('first', 130, 40, false, 100), 30);
    // Later check-ins in the month stay unchecked
    assert.equal(minimumCheckInPayment('first', 500, 40, true, 100), 0);
    // Chaperon: the balance after today's fee may reach the limit
    assert.equal(minimumCheckInPayment('each', 50, 40, true, 100), 0);
    assert.equal(minimumCheckInPayment('each', 80, 40, true, 100), 20);
});

test('counselors can see the override but not change it', () => {
    assert.equal(isCounselorAllowed('GET', '/api/clients/5/debt-limit'), true);
    assert.equal(isCounselorAllowed('POST', '/api/clients/5/debt-limit'), false);
    assert.equal(isCounselorAllowed('DELETE', '/api/clients/5/debt-limit'), false);
});
