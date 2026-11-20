const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HELD_PAYMENT_SQL, paymentDetails, paymentMethodProblem, paymentMethodText } = require('../lib/paymentMethods');

test('cash and card need nothing more; Other needs a known kind', () => {
    assert.equal(paymentMethodProblem({ method: 'Cash', role: 'Counselor' }), null);
    assert.equal(paymentMethodProblem({ method: 'Credit Card', role: 'Counselor' }), null);
    assert.match(paymentMethodProblem({ method: 'Bitcoin', role: 'Business Administrator' }), /Cash, Credit Card, or Other/);
    assert.match(paymentMethodProblem({ method: 'Other', subtype: '', role: 'Business Administrator' }), /what kind/);
    assert.match(paymentMethodProblem({ method: 'Other', subtype: 'Venmo', role: 'Business Administrator' }), /what kind/);
});

test('anyone takes checks, money orders and cashier\'s checks; only Business Administrators take Direct Deposit, Tribal and DHS', () => {
    for (const role of ['Counselor', 'Office Admin', 'Business Administrator']) {
        for (const subtype of ['Check', 'Money Order', "Cashier's Check"]) {
            assert.equal(paymentMethodProblem({ method: 'Other', subtype, role }), null, `${role} ${subtype}`);
        }
    }
    for (const subtype of ['Direct Deposit', 'Tribal', 'DHS']) {
        assert.equal(paymentMethodProblem({ method: 'Other', subtype, role: 'Business Administrator' }), null);
        assert.match(paymentMethodProblem({ method: 'Other', subtype, role: 'Office Admin' }), /Only Business Administrators/);
        assert.match(paymentMethodProblem({ method: 'Other', subtype, role: 'Counselor' }), /Only Business Administrators/);
    }
});

test('the kind and reference are kept only for Other, and the method reads naturally', () => {
    assert.deepEqual(paymentDetails({ method: 'Other', subtype: 'Check', reference: ' 1042 ' }), { subtype: 'Check', reference: '1042' });
    assert.deepEqual(paymentDetails({ method: 'Other', subtype: 'DHS', reference: '' }), { subtype: 'DHS', reference: null });
    assert.deepEqual(paymentDetails({ method: 'Cash', subtype: 'Check', reference: '1' }), { subtype: null, reference: null });
    assert.equal(paymentMethodText('Other', 'Check', '1042'), 'Check #1042');
    assert.equal(paymentMethodText('Other', 'DHS', null), 'DHS');
    assert.equal(paymentMethodText('Cash'), 'Cash');
});

test('cash and paper payments are held until dropped off', () => {
    const sql = HELD_PAYMENT_SQL('f.');
    assert.match(sql, /f\.PaymentMethod = 'Cash'/);
    assert.match(sql, /'Check', 'Money Order', 'Cashier''s Check'/);
    assert.doesNotMatch(sql, /DHS|Tribal|Direct Deposit/);
});
