const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cashDiscardProblem, keepPrintedMarks, printedEntries, printedReceiptProblem } = require('../lib/printedReceipts');

const entry = (clientid, extra = {}) => ({
    client: { clientid, firstname: 'Jason', lastname: `Client${clientid}` },
    fee: 180, payment: 10, paymentMethod: 'Cash', cardPaid: 0, balance: -20, voucher: false, comments: '', ...extra,
});
const saved = [entry(1, { receiptPrinted: true }), entry(2)];

test('a sheet with no printed receipt can change freely', () => {
    assert.equal(printedReceiptProblem([entry(1), entry(2)], [entry(2, { fee: 0 })]), null);
    assert.equal(printedReceiptProblem(undefined, [entry(1)]), null);
    assert.equal(printedEntries(saved).length, 1);
});

test('a printed client cannot be removed from the open sheet', () => {
    assert.match(printedReceiptProblem(saved, [entry(2)]), /Client1, Jason.*can't be removed/);
});

test('other clients can still be removed, and notes can change, while a printed client stays', () => {
    assert.equal(printedReceiptProblem(saved, [entry(1, { comments: 'late' })]), null);
});

test('the printed fee and payment cannot change', () => {
    assert.match(printedReceiptProblem(saved, [entry(1, { payment: 0 })]), /can't change/);
    assert.match(printedReceiptProblem(saved, [entry(1, { fee: 90 })]), /can't change/);
    assert.match(printedReceiptProblem(saved, [entry(1, { paymentMethod: 'Credit Card' })]), /can't change/);
});

test('an older screen cannot clear the printed mark', () => {
    const next = keepPrintedMarks(saved, [entry(1), entry(2)]);
    assert.equal(next[0].receiptPrinted, true);
    assert.equal(next[1].receiptPrinted, undefined);
});

test('closing the group must include each printed client as printed', () => {
    const batch = (accountPaid, groupFee = 180) => [{ client: 1, groupFee, accountPaid, paymentMethod: 'Cash' }];
    assert.equal(printedReceiptProblem(saved, batch(10), { closing: true }), null);
    assert.match(printedReceiptProblem(saved, [{ client: 2, groupFee: 180, accountPaid: 10, paymentMethod: 'Cash' }], { closing: true }), /can't be removed/);
    assert.match(printedReceiptProblem(saved, batch(0), { closing: true }), /can't change/);
    assert.match(printedReceiptProblem(saved, batch(10, 0), { closing: true }), /can't change/);
});


test('a sheet with cash entered cannot be discarded, and says who paid', () => {
    const sheet = [
        { client: { clientid: 1, lastname: 'Doe', firstname: 'Jan' }, payment: 20, paymentMethod: 'Cash' },
        { client: { clientid: 2, lastname: 'Roe', firstname: 'Sam' }, payment: 0, cardPaid: 40 },
    ];
    const problem = cashDiscardProblem(sheet);
    assert.match(problem, /Doe, Jan \(\$20\.00\)/);
    assert.doesNotMatch(problem, /Roe/);
});

test('a sheet with only card payments or no money can be discarded', () => {
    assert.equal(cashDiscardProblem([{ client: { clientid: 2 }, payment: 0, cardPaid: 40 }]), null);
    assert.equal(cashDiscardProblem([]), null);
    assert.equal(cashDiscardProblem(null), null);
});
