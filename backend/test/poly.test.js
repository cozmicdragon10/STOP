// Poly fee payment changes: what moves PolyFeePaid and what is owed on the account instead
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitPolyPaidChange } = require('../lib/poly');

test('a decrease within what was paid comes off the poly fee only', () => {
    assert.deepEqual(splitPolyPaidChange(50, -20), { polyDelta: -20, toAccount: 0 });
});

test('a decrease larger than what was paid stops the poly fee at $0 and the rest is owed on the account', () => {
    assert.deepEqual(splitPolyPaidChange(0, -10), { polyDelta: 0, toAccount: -10 });
    assert.deepEqual(splitPolyPaidChange(15, -40), { polyDelta: -15, toAccount: -25 });
});

test('an already negative poly fee paid takes nothing more', () => {
    assert.deepEqual(splitPolyPaidChange(-10, -5), { polyDelta: 0, toAccount: -5 });
});

test('an increase goes to the poly fee', () => {
    assert.deepEqual(splitPolyPaidChange(0, 30), { polyDelta: 30, toAccount: 0 });
});
