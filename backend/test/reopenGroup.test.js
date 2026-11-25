const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reopenProblem, sheetEntryFromAttendance } = require('../lib/reopenGroup');

const ok = { groupActive: true, openSheet: false, deposited: false, pendingHandoff: false, refundedOrDisputed: false, cardPaid: [] };

test('a closed group can be reopened unless that would lose track of money', () => {
    assert.equal(reopenProblem(ok), null);
    assert.match(reopenProblem({ ...ok, groupActive: false }), /inactive/);
    assert.match(reopenProblem({ ...ok, openSheet: true }), /already has an open check-in/);
    assert.match(reopenProblem({ ...ok, deposited: true }), /already on a deposit/);
    assert.match(reopenProblem({ ...ok, pendingHandoff: true }), /hand-off/);
    assert.match(reopenProblem({ ...ok, refundedOrDisputed: true }), /refunded or disputed/);
    assert.match(reopenProblem({ ...ok, cardPaid: ['Roe, Sam'] }), /^Roe, Sam: .*card payment/);
    assert.match(reopenProblem({ ...ok, twice: ['Roe, Sam'] }), /^Roe, Sam is checked in to this session more than once/);
});

test('each check-in goes back on the sheet with what it was closed with', () => {
    const client = { clientid: 7, lastname: 'Roe', firstname: 'Sam', accountbalance: '40.00' };
    const att = {
        client: 7, groupfee: '180.00', accountpaid: '60.00', paymentmethod: 'Cash', paymentsubtype: null, paymentreference: null,
        voucherused: false, comments: null, durationband: null,
    };
    assert.deepEqual(sheetEntryFromAttendance({ att, client, note: 'Did well.' }), {
        client, fee: 180, payment: 60, paymentMethod: 'Cash', paymentSubtype: null, paymentReference: null,
        cardPaid: 0, balance: 40, voucher: false, comments: 'Did well.',
    });
    // A check payment keeps its kind and number; a make-up and a Federal SO duration stay marked
    const other = sheetEntryFromAttendance({
        att: { ...att, paymentmethod: 'Other', paymentsubtype: 'Check', paymentreference: '1042', comments: 'Approved make-up attendance', durationband: '60-89' },
        client, note: '',
    });
    assert.equal(other.paymentMethod, 'Other');
    assert.equal(other.paymentSubtype, 'Check');
    assert.equal(other.paymentReference, '1042');
    assert.equal(other.makeup, true);
    assert.equal(other.durationBand, '60-89');
    assert.equal(other.comments, '');
    // No payment: Cash with nothing on it, like a new check-in
    const unpaid = sheetEntryFromAttendance({ att: { ...att, accountpaid: '0', paymentmethod: null, voucherused: true }, client, note: '' });
    assert.equal(unpaid.payment, 0);
    assert.equal(unpaid.paymentMethod, 'Cash');
    assert.equal(unpaid.voucher, true);
});
