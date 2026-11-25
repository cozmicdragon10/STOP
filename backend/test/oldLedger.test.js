const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkInRows, accountRows } = require('../lib/oldLedger');

const day = '2025-03-04';

test('a check-in that took a payment is one payment row, with its fee shown beside it', () => {
    const rows = checkInRows({ type: 'Group', day, fee: 40, paid: 60, finalOwed: -20 });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
        type: 'Payment', amount: 60, feeType: 'Group Fee', finalBalance: -20,
        // Starts like the app's own, so the ledger shows the check-in's fee beside it (SESSION_FEE_SQL)
        comments: 'Payment applied during Group session on 2025-03-04. From the old system.',
    });
});

test('a check-in with no payment is its fee', () => {
    assert.deepEqual(checkInRows({ type: 'Assessment', day, fee: 150, paid: 0, finalOwed: 150 }), [
        { type: 'Charge', amount: 150, feeType: 'Assessment Fee', finalBalance: 150, comments: 'Assessment fee assessed on 2025-03-04. From the old system.' },
    ]);
    // A payment with no fee is just the payment
    assert.deepEqual(checkInRows({ type: 'Group', day, fee: 0, paid: 25, finalOwed: 10 }).map(r => [r.type, r.amount, r.finalBalance]), [['Payment', 25, 10]]);
    // Nothing either way: no rows
    assert.deepEqual(checkInRows({ type: 'Group', day, fee: 0, paid: 0, finalOwed: 10 }), []);
});

test('negative old amounts become an adjustment or a refund, with the balance worked back', () => {
    // A fee of -$35 (taken off) and a $20 payment: the credit first, then the payment that ends at the old balance
    assert.deepEqual(checkInRows({ type: 'Group', day, fee: -35, paid: 20, finalOwed: 5 }).map(r => [r.type, r.amount, r.feeType, r.finalBalance]), [
        ['Adjustment', 35, 'Old System Credit', 25],
        ['Payment', 20, 'Group Fee', 5],
    ]);
    // A $40 fee with $15 paid back
    assert.deepEqual(checkInRows({ type: 'Group', day, fee: 40, paid: -15, finalOwed: 55 }).map(r => [r.type, r.amount, r.finalBalance]), [
        ['Charge', 40, 40],
        ['Refund', 15, 55],
    ]);
});

test('old account-only entries: a charge, then the payment, ending at the old balance', () => {
    assert.deepEqual(accountRows({ fee: 35, paid: 50, finalOwed: -15, comment: 'ACCOUNT: paid on note' }), [
        { type: 'Charge', amount: 35, feeType: 'Old System Fee', finalBalance: 35, comments: 'Old system account entry: ACCOUNT: paid on note' },
        { type: 'Payment', amount: 50, feeType: 'Account Payment', finalBalance: -15, comments: 'Old system account entry: ACCOUNT: paid on note' },
    ]);
    assert.deepEqual(accountRows({ fee: 0, paid: -10, finalOwed: 10, comment: null }).map(r => [r.type, r.amount, r.comments]), [
        ['Refund', 10, 'Old system account entry. ($10.00 paid back)'],
    ]);
});
