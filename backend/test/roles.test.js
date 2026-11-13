const test = require('node:test');
const assert = require('node:assert');
const { effectiveRole, isDevRole } = require('../lib/roles');
const { requireDev, sessionUser } = require('../lib/auth');

test('a DEV account acts as a Business Administrator and is marked isdev', () => {
    assert.equal(effectiveRole('DEV'), 'Business Administrator');
    assert.equal(effectiveRole('Counselor'), 'Counselor');
    assert.equal(effectiveRole(undefined), null);
    assert.equal(isDevRole('Business Administrator'), false);
    assert.deepEqual(sessionUser({ employeeemail: 'a@b', role: 'DEV' }),
        { employeeemail: 'a@b', role: 'Business Administrator', accountrole: 'DEV', isdev: true });
    assert.equal(sessionUser({ role: 'Business Administrator' }).isdev, false);
});

test('requireDev lets only DEV sessions through', () => {
    const run = (user) => {
        let passed = false, status = null;
        const res = { status: (s) => { status = s; return { json: () => {} }; } };
        requireDev({ user }, res, () => { passed = true; });
        return passed ? 'next' : status;
    };
    assert.equal(run(sessionUser({ role: 'DEV' })), 'next');
    assert.equal(run(sessionUser({ role: 'Business Administrator' })), 403);
    assert.equal(run({ role: 'Business Administrator', isdev: 'true' }), 403);
    assert.equal(run(undefined), 403);
});
