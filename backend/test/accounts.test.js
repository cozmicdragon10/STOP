const { test } = require('node:test');
const assert = require('node:assert/strict');
const { accountChangeProblem } = require('../lib/accounts');

const owner = { employeeemail: 'owner@stop.local', role: 'Business Administrator' };
const office = { employeeemail: 'office@stop.local', role: 'Office Admin' };
const account = (role, changes = {}) => ({ employeeemail: 'someone@stop.local', role, active: true, ...changes });
const problem = (actor, target, next, otherActiveTopRole = 1) => accountChangeProblem({ actor, target, next, otherActiveTopRole });

test('a Business Administrator can create and change any account', () => {
    assert.equal(problem(owner, null, { role: 'Business Administrator', active: true }), null);
    assert.equal(problem(owner, account('Counselor'), { role: 'Office Admin', active: true }), null);
    assert.equal(problem(owner, account('Business Administrator'), { role: 'Counselor', active: false }), null);
});

test('nobody else can hand out, change, or take over the Business Administrator role', () => {
    assert.match(problem(office, null, { role: 'Business Administrator', active: true }), /Only a Business Administrator can give/);
    assert.match(problem(office, account('Counselor'), { role: 'Business Administrator', active: true }), /Only a Business Administrator can give/);
    // Even a change that keeps the role (a password reset, deactivating) is refused
    assert.match(problem(office, account('Business Administrator'), { role: 'Business Administrator', active: true }), /can change a Business Administrator account/);
    assert.match(problem(office, account('Business Administrator'), { role: 'Business Administrator', active: false }), /can change a Business Administrator account/);
});

test('nobody changes their own role or deactivates themselves', () => {
    const self = { employeeemail: 'OWNER@stop.local ', role: 'Business Administrator', active: true };
    assert.match(problem(owner, self, { role: 'Office Admin', active: true }), /your own role/);
    assert.match(problem(owner, self, { role: 'Business Administrator', active: false }), /deactivate your own/);
    assert.equal(problem(owner, self, { role: 'Business Administrator', active: true }), null);
});

test('the only active Business Administrator cannot be demoted or deactivated', () => {
    const last = account('Business Administrator');
    assert.match(problem(owner, last, { role: 'Counselor', active: true }, 0), /only active Business Administrator/);
    assert.match(problem(owner, last, { role: 'Business Administrator', active: false }, 0), /only active Business Administrator/);
    assert.equal(problem(owner, last, { role: 'Business Administrator', active: true }, 0), null);
    // An already inactive one can be changed freely
    assert.equal(problem(owner, account('Business Administrator', { active: false }), { role: 'Counselor', active: false }, 0), null);
});

test('the role must be a real one', () => {
    assert.match(problem(owner, null, { role: 'Therapist', active: true }), /Role must be one of/);
    assert.match(problem(owner, account('Counselor'), { role: '', active: true }), /Role must be one of/);
});
