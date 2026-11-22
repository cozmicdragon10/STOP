const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    groupItemKey, paymentItemKey, parseItemKey, itemLabel, openSheetMoney, pickedItemsProblem, handoffProblem,
    handoffActionProblem, depositProblem, verifyProblem, voidProblem, depositDifference, itemTimeline,
} = require('../lib/moneyOnHand');

const admin = { employeeemail: 'boss@stop.local', role: 'Business Administrator' };
const amy = { employeeemail: 'amy@stop.local', role: 'Counselor' };
const ben = { employeeemail: 'ben@stop.local', role: 'Office Admin' };

const groupItem = {
    itemkey: 'g:3:2026-11-20:1', kind: 'group', label: 'Tulsa BIP', eventdate: '2026-11-20', sessionnumber: 1,
    amount: '120.00', holder: 'Amy@stop.local', holdername: 'Amy', collector: 'amy@stop.local', pendinghandoffid: null,
};
const paymentItem = {
    itemkey: 'p:41', kind: 'payment', label: 'Payment', clientname: 'Smith, John', eventdate: '2026-11-21',
    amount: '40', holder: 'amy@stop.local', holdername: 'Amy', collector: 'amy@stop.local', pendinghandoffid: null,
};
const heldMap = (...items) => new Map(items.map(i => [i.itemkey, i]));
const pick = (...items) => items.map(i => ({ key: i.itemkey, amount: Number(i.amount) }));
const toBen = { employeeemail: 'ben@stop.local', role: 'Office Admin', active: true };

test('item keys round-trip and reject anything else', () => {
    assert.equal(groupItemKey(3, '2026-11-20', 2), 'g:3:2026-11-20:2');
    assert.equal(groupItemKey('3', '2026-11-20', null), 'g:3:2026-11-20:1');
    assert.equal(paymentItemKey('41'), 'p:41');
    assert.deepEqual(parseItemKey('g:3:2026-11-20:2'), { kind: 'group', groupId: 3, sessionDate: '2026-11-20', sessionNumber: 2 });
    assert.deepEqual(parseItemKey('p:41'), { kind: 'payment', transactionId: 41 });
    for (const bad of ['', null, 'p:', 'p:4x', 'g:3:11/20/2026:1', "p:1' OR 1=1", 'x:1']) assert.equal(parseItemKey(bad), null, String(bad));
});

test('items are named by group and date, or by client', () => {
    assert.equal(itemLabel(groupItem), 'Tulsa BIP 11/20/2026');
    assert.equal(itemLabel({ ...groupItem, sessionnumber: 2 }), 'Tulsa BIP 11/20/2026 #2');
    assert.equal(itemLabel(paymentItem), 'Smith, John: Payment 11/21/2026');
});

test('an open sheet counts cash and checks, not cards or DHS', () => {
    const entries = [
        { client: { clientid: 1, lastname: 'Smith', firstname: 'John' }, payment: 25, paymentMethod: 'Cash' },
        { client: { clientid: 2, lastname: 'Doe', firstname: 'Jane' }, payment: 30.5, paymentMethod: 'Other', paymentSubtype: 'Check', paymentReference: '1042' },
        { client: 3, payment: 50, paymentMethod: 'Other', paymentSubtype: 'DHS' },
        { client: 4, payment: 0, paymentMethod: 'Cash' },
        { client: 5, payment: 20, paymentMethod: 'Credit Card', cardPaid: 20 },
        null,
    ];
    assert.deepEqual(openSheetMoney(entries), {
        amount: 55.5,
        checks: [{ kind: 'Check', reference: '1042', amount: 30.5, client: 'Doe, Jane' }],
    });
    assert.deepEqual(openSheetMoney(null), { amount: 0, checks: [] });
});

test('picked money must still be on hand, not waiting on a hand-off, and unchanged', () => {
    const held = heldMap(groupItem, paymentItem);
    assert.equal(pickedItemsProblem(pick(groupItem, paymentItem), held), null);
    assert.equal(pickedItemsProblem([{ key: 'p:41', amount: '40.00' }], held), null);
    assert.equal(pickedItemsProblem([], held).status, 400);
    assert.equal(pickedItemsProblem([{ key: 'p:41', amount: 40 }, { key: 'p:41', amount: 40 }], held).status, 400);
    assert.equal(pickedItemsProblem([{ key: 'nope', amount: 1 }], held).status, 400);
    // Deposited by someone else since the list was shown
    assert.match(pickedItemsProblem([{ key: 'p:99', amount: 40 }], held).error, /dropped off at the bank already/);
    const pending = pickedItemsProblem(pick(groupItem), heldMap({ ...groupItem, pendinghandoffid: 5 }));
    assert.equal(pending.status, 409);
    assert.match(pending.error, /waiting on a hand-off/);
    // A payment adjusted, or another client checked in, since the list was shown
    const changed = pickedItemsProblem([{ key: groupItem.itemkey, amount: 100 }], held);
    assert.equal(changed.status, 409);
    assert.match(changed.error, /Tulsa BIP 11\/20\/2026 is now \$120\.00, not \$100\.00/);
});

test('a holder hands their own money to another active employee', () => {
    const held = heldMap(groupItem, paymentItem);
    assert.equal(handoffProblem({ viewer: amy, to: toBen, picked: pick(groupItem, paymentItem), held }), null);
    // A Business Administrator can enter one for the holder
    assert.equal(handoffProblem({ viewer: admin, to: toBen, picked: pick(groupItem), held }), null);
    // Someone else's money
    const notMine = handoffProblem({ viewer: ben, to: { ...toBen, employeeemail: 'boss@stop.local' }, picked: pick(groupItem), held });
    assert.equal(notMine.status, 403);
    assert.match(notMine.error, /held by Amy/);
    // Mixed holders in one hand-off
    const mixed = heldMap(groupItem, { ...paymentItem, holder: 'carl@stop.local' });
    assert.match(handoffProblem({ viewer: admin, to: toBen, picked: pick(groupItem, paymentItem), held: mixed }).error, /one person is holding/);
    assert.match(handoffProblem({ viewer: amy, to: null, picked: pick(groupItem), held }).error, /active employee/);
    assert.match(handoffProblem({ viewer: amy, to: { ...toBen, active: false }, picked: pick(groupItem), held }).error, /active employee/);
    assert.match(handoffProblem({ viewer: amy, to: { ...toBen, role: 'Polygrapher' }, picked: pick(groupItem), held }).error, /Polygrapher/);
    assert.match(handoffProblem({ viewer: amy, to: { ...toBen, employeeemail: 'AMY@stop.local' }, picked: pick(groupItem), held }).error, /already holding/);
});

test('only the receiver accepts or declines; the giver, its enterer, or an admin cancels', () => {
    const handoff = { status: 'Pending', fromemployee: 'amy@stop.local', toemployee: 'ben@stop.local', createdby: 'amy@stop.local' };
    assert.equal(handoffActionProblem({ viewer: ben, handoff, action: 'accept' }), null);
    assert.equal(handoffActionProblem({ viewer: ben, handoff, action: 'decline' }), null);
    assert.equal(handoffActionProblem({ viewer: amy, handoff, action: 'accept' }).status, 403);
    // Not even an admin can accept for the receiver: accepting is the receiver saying they have the money
    assert.equal(handoffActionProblem({ viewer: admin, handoff, action: 'accept' }).status, 403);
    assert.equal(handoffActionProblem({ viewer: amy, handoff, action: 'cancel' }), null);
    assert.equal(handoffActionProblem({ viewer: admin, handoff, action: 'cancel' }), null);
    assert.equal(handoffActionProblem({ viewer: ben, handoff, action: 'cancel' }).status, 403);
    assert.equal(handoffActionProblem({ viewer: ben, handoff: { ...handoff, createdby: 'ben@stop.local' }, action: 'cancel' }), null);
    assert.match(handoffActionProblem({ viewer: ben, handoff: { ...handoff, status: 'Accepted' }, action: 'accept' }).error, /already accepted/);
    assert.equal(handoffActionProblem({ viewer: ben, handoff: undefined, action: 'accept' }).status, 404);
    assert.equal(handoffActionProblem({ viewer: ben, handoff, action: 'take' }).status, 400);
});

test('a deposit is the holder\'s money, dated today or earlier, with an optional slip number', () => {
    const held = heldMap(groupItem, paymentItem);
    const ok = { viewer: amy, picked: pick(groupItem, paymentItem), held, depositDate: '2026-11-22', slipNumber: '', today: '2026-11-22' };
    assert.equal(depositProblem(ok), null);
    assert.equal(depositProblem({ ...ok, slipNumber: 'A-1042' }), null);
    assert.match(depositProblem({ ...ok, depositDate: '' }).error, /date the deposit/);
    assert.match(depositProblem({ ...ok, depositDate: '2026-11-23' }).error, /future/);
    assert.match(depositProblem({ ...ok, slipNumber: 'x'.repeat(101) }).error, /up to 100/);
    const notMine = depositProblem({ ...ok, viewer: ben });
    assert.equal(notMine.status, 403);
    assert.match(notMine.error, /held by Amy/);
    // A Business Administrator can deposit anyone's
    assert.equal(depositProblem({ ...ok, viewer: admin }), null);
});

test('checking against the bank and voiding are for Business Administrators', () => {
    const deposit = { total: '160.00', verifiedon: null, voidedon: null };
    assert.equal(verifyProblem({ viewer: admin, deposit, bankAmount: '160' }), null);
    assert.equal(verifyProblem({ viewer: admin, deposit, bankAmount: 0 }), null);
    assert.equal(verifyProblem({ viewer: ben, deposit, bankAmount: 160 }).status, 403);
    for (const bankAmount of ['', null, undefined, -1, 'abc']) assert.equal(verifyProblem({ viewer: admin, deposit, bankAmount }).status, 400, String(bankAmount));
    assert.equal(verifyProblem({ viewer: admin, deposit: { ...deposit, voidedon: 'x' }, bankAmount: 160 }).status, 409);

    assert.equal(voidProblem({ viewer: admin, deposit, reason: 'Wrong bag' }), null);
    assert.match(voidProblem({ viewer: admin, deposit, reason: '  ' }).error, /reason is required/);
    assert.equal(voidProblem({ viewer: amy, deposit, reason: 'Oops' }).status, 403);
    assert.match(voidProblem({ viewer: admin, deposit: { ...deposit, verifiedon: 'x' }, reason: 'Oops' }).error, /already checked against the bank/);
    assert.match(voidProblem({ viewer: admin, deposit: { ...deposit, voidedon: 'x' }, reason: 'Oops' }).error, /already voided/);
});

test('the bank difference is over, short, or balanced to the cent', () => {
    assert.equal(depositDifference('160.00', '160'), 0);
    assert.equal(depositDifference(160, 155.5), -4.5);
    assert.equal(depositDifference(0.1 + 0.2, 0.3), 0);
    assert.equal(depositDifference(160, 170.01), 10.01);
    assert.equal(depositDifference(160, null), null);
});

test('an item\'s history reads in time order', () => {
    const events = itemTimeline({
        origin: { kind: 'group', amount: 120, collectorname: 'Amy', collectedon: '2026-11-20T18:00:00Z' },
        handoffs: [
            { createdon: '2026-11-20T19:00:00Z', fromname: 'Amy', toname: 'Ben', fromemployee: 'amy', createdby: 'amy', status: 'Declined', resolvedon: '2026-11-20T19:05:00Z' },
            { createdon: '2026-11-21T09:00:00Z', fromname: 'Amy', toname: 'Ben', fromemployee: 'amy', createdby: 'boss', createdbyname: 'Boss', notes: 'In the safe', status: 'Accepted', resolvedon: '2026-11-21T09:30:00Z' },
        ],
        deposits: [{
            recordedon: '2026-11-21T15:00:00Z', droppedoffbyname: 'Ben', depositdate: '2026-11-21', bankdepositid: 9, slipnumber: 'A1',
            total: 160, verifiedon: '2026-11-23T10:00:00Z', verifiedbyname: 'Boss', bankamount: 155,
        }],
    });
    assert.deepEqual(events.map(e => e.kind), ['collected', 'offered', 'declined', 'offered', 'accepted', 'deposited', 'checked']);
    assert.match(events[0].text, /\$120\.00 in cash and checks; Amy responsible/);
    assert.match(events[3].text, /Amy handed it to Ben \(entered by Boss\): "In the safe"/);
    assert.match(events[5].text, /Ben dropped it off at the bank on 11\/21\/2026 \(deposit 9, slip A1, \$160\.00 in all\)/);
    assert.match(events[6].text, /\$155\.00 credited, short \$5\.00/);
});
