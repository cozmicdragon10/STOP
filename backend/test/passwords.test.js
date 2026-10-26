const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../passwords');

test('a hashed password verifies, and a wrong one does not', async () => {
    const stored = await hashPassword('correct horse');
    assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.equal(await verifyPassword('correct horse', stored), true);
    assert.equal(await verifyPassword('wrong horse', stored), false);
});

test('the same password hashes differently each time (random salt)', async () => {
    assert.notEqual(await hashPassword('same'), await hashPassword('same'));
});

test('accounts without a usable hash cannot log in', async () => {
    assert.equal(await verifyPassword('anything', null), false);
    assert.equal(await verifyPassword('anything', ''), false);
    assert.equal(await verifyPassword('anything', 'plaintext'), false);
    assert.equal(await verifyPassword('anything', 'bcrypt$aa$bb'), false);
});
