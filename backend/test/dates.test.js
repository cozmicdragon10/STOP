const { test } = require('node:test');
const assert = require('node:assert/strict');
const { todayLocal, ymdLocal, ymdOf } = require('../lib/dates');

test('today is the local calendar day, even late in the evening', () => {
    // 9:30 PM local on Nov 12: in UTC (Oklahoma is UTC-6) it is already Nov 13
    const evening = new Date(2026, 10, 12, 21, 30);
    assert.equal(todayLocal(evening), '2026-11-12');
    assert.equal(ymdLocal(new Date(2026, 0, 5)), '2026-01-05');
});

test('a stored date reads back as the day it was stored', () => {
    // pg returns DATE columns as local midnight
    assert.equal(ymdOf(new Date(2026, 10, 3)), '2026-11-03');
    assert.equal(ymdOf('2026-11-03'), '2026-11-03');
    assert.equal(ymdOf('2026-11-03T06:00:00.000Z'), '2026-11-03');
    assert.equal(ymdOf(null), '');
});
