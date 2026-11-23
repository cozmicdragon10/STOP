const { test } = require('node:test');
const assert = require('node:assert');
const { cardMoveProblem } = require('../lib/cardMove');

const tx = (over = {}) => ({
    transactionid: 9, client: 1, type: 'Payment', paymentmethod: 'Credit Card', feetype: 'Account Payment',
    attendanceid: null, disputestatus: null, enteredby: 'desk@stop.local', amount: '40.00', ...over,
});
const desk = { employeeemail: 'desk@stop.local', role: 'Counselor' };
const move = (over = {}) => cardMoveProblem({ tx: tx(), relatedCount: 0, fromClient: 1, toClient: 2, user: desk, ...over });

test('a card payment taken at check-in moves to another client', () => {
    assert.strictEqual(move(), null);
    // The person who took it, in any letter case
    assert.strictEqual(move({ user: { employeeemail: 'DESK@stop.local', role: 'Counselor' } }), null);
});

test('an Office Admin or Business Administrator can move one someone else took', () => {
    const other = (role) => move({ user: { employeeemail: 'someone@stop.local', role } });
    assert.strictEqual(other('Office Admin'), null);
    assert.strictEqual(other('Business Administrator'), null);
    assert.match(other('Counselor'), /Only the person who took this payment/);
});

test('only an untouched card account payment can move', () => {
    assert.match(move({ tx: null }), /no longer exists/);
    assert.match(move({ fromClient: 3 }), /no longer on this client/);
    assert.match(move({ tx: tx({ paymentmethod: 'Cash' }) }), /Only a credit card payment/);
    assert.match(move({ tx: tx({ type: 'Refund' }) }), /Only a credit card payment/);
    assert.match(move({ tx: tx({ feetype: 'Poly Fee' }) }), /not a poly fee/);
    assert.match(move({ tx: tx({ attendanceid: 77 }) }), /saved check-in/);
    assert.match(move({ tx: tx({ disputestatus: 'Open' }) }), /refund or dispute/);
    assert.match(move({ relatedCount: 1 }), /refund or dispute/);
});

test('the payment goes to a different, real client', () => {
    assert.match(move({ toClient: 1 }), /different client/);
    assert.match(move({ toClient: null }), /Pick the client/);
});
