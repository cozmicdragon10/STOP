const { test } = require('node:test');
const assert = require('node:assert/strict');
const { monthStart } = require('../lib/busPasses');

test('the bus pass refill month is the first of the local calendar month', () => {
    assert.equal(monthStart(new Date(2026, 10, 9, 15, 30)), '2026-11-01');
    assert.equal(monthStart(new Date(2026, 11, 31, 23, 59)), '2026-12-01');
    assert.equal(monthStart(new Date(2027, 0, 1, 0, 0)), '2027-01-01');
});
