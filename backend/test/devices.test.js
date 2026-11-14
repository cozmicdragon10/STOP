// Device approval rules that need no database: request checks, caps, lockouts, setup codes, cookies and the gate
const { test } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app');
const devices = require('../lib/devices');

test('a request needs an email, a name, and a note of 300 characters or fewer', () => {
    assert.match(devices.validateRequest({ email: 'nope', name: 'A' }).error, /email/);
    assert.match(devices.validateRequest({ email: 'a@b.co', name: '   ' }).error, /name/);
    assert.match(devices.validateRequest({ email: 'a@b.co', name: 'A', note: 'x'.repeat(301) }).error, /300/);
    const ok = devices.validateRequest({ email: '  Jane@Office.GOV ', name: ' Jane ', note: ' Laptop for field visits ' });
    assert.deepEqual(ok.value, { email: 'jane@office.gov', name: 'Jane', note: 'Laptop for field visits' });
    assert.deepEqual(devices.validateRequest({ email: 'a@b.co', name: 'A' }).value.note, '');
});

test('the note may be exactly 300 characters', () => {
    assert.ok(devices.validateRequest({ email: 'a@b.co', name: 'A', note: 'x'.repeat(300) }).value);
});

test('owner text is trimmed and limited; names are required where asked', () => {
    assert.equal(devices.cleanText('  Memo  ', 500).value, 'Memo');
    assert.equal(devices.cleanText('   ', 500).value, null);
    assert.match(devices.cleanText('', 80, { required: true }).error, /empty/);
    assert.match(devices.cleanText('x'.repeat(501), 500).error, /500/);
});

test('the caps: 2 pending per email, 20 overall', () => {
    assert.equal(devices.capReason({ pendingForEmail: 0, pendingTotal: 0 }), null);
    assert.equal(devices.capReason({ pendingForEmail: 1, pendingTotal: 19 }), null);
    assert.equal(devices.capReason({ pendingForEmail: 2, pendingTotal: 2 }), 'email');
    assert.equal(devices.capReason({ pendingForEmail: 1, pendingTotal: 20 }), 'total');
});

test('wrong attempts lock an address for the lockout window, then the lock clears', () => {
    const key = devices.lockKey('email', '10.9.9.9');
    devices.clearFailures(key);
    for (let i = 0; i < devices.LOCK_MAX_FAILURES - 1; i++) devices.recordFailure(key);
    assert.equal(devices.locked(key), false);
    devices.recordFailure(key);
    assert.equal(devices.locked(key), true);
    assert.equal(devices.locked(devices.lockKey('email', '10.9.9.8')), false, 'other addresses are not locked');
    devices.clearFailures(key);
    assert.equal(devices.locked(key), false);
});

test('a lockout expires after its window', () => {
    const key = devices.lockKey('setup', '10.1.1.1');
    devices.clearFailures(key);
    for (let i = 0; i < devices.LOCK_MAX_FAILURES; i++) devices.recordFailure(key);
    assert.equal(devices.locked(key), true);
    const realNow = Date.now;
    Date.now = () => realNow() + (devices.LOCK_MINUTES + 1) * 60 * 1000;
    try {
        assert.equal(devices.locked(key), false);
    } finally {
        Date.now = realNow;
    }
});

test('setup codes are 10 characters from an unambiguous alphabet, shown as XXXXX-XXXXX', () => {
    for (let i = 0; i < 50; i++) {
        const code = devices.newSetupCode();
        assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
        assert.equal(devices.normalizeSetupCode(code.toLowerCase()), code.replace('-', ''));
    }
});

test('a typed setup code is normalised: spaces, dashes and case do not matter', () => {
    assert.equal(devices.normalizeSetupCode(' abcde-fghjk '), 'ABCDEFGHJK');
    assert.equal(devices.normalizeSetupCode(undefined), '');
});

test('tokens are random and only their hashes are compared', () => {
    const a = devices.newToken();
    const b = devices.newToken();
    assert.notEqual(a, b);
    assert.match(devices.hashToken(a), /^[0-9a-f]{64}$/);
    assert.notEqual(devices.hashToken(a), a);
});

test('the device cookie is read from the Cookie header, ignoring other cookies', () => {
    const req = (cookie) => ({ get: (h) => (h === 'Cookie' ? cookie : undefined) });
    assert.equal(devices.deviceToken(req('theme=dark; stop_device=abc123; other=1')), 'abc123');
    assert.equal(devices.deviceToken(req('stop_device_x=nope')), null);
    assert.equal(devices.deviceToken(req(undefined)), null);
    assert.equal(devices.deviceToken(req('stop_device=%E0%A4%A')), null, 'a malformed value is not a token');
});

test('the public device routes are the only ones open before approval', () => {
    assert.equal(devices.isPublicDevicePath('/api/devices/status'), true);
    assert.equal(devices.isPublicDevicePath('/api/devices/request'), true);
    assert.equal(devices.isPublicDevicePath('/api/devices/redeem'), true);
    assert.equal(devices.isPublicDevicePath('/api/devices'), false, 'the DEV list is not public');
    assert.equal(devices.isPublicDevicePath('/api/devices/1/approve'), false);
    assert.equal(devices.isPublicDevicePath('/api/clients'), false);
});

test('the owner-only device routes are refused to a browser that is not an approved device', async () => {
    // Without a cookie the gate refuses first, so these never reach the database
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        for (const [method, path] of [['GET', '/api/devices'], ['POST', '/api/devices/1/approve'],
            ['POST', '/api/devices/1/deny'], ['POST', '/api/devices/1/revoke'], ['POST', '/api/devices/1/rename']]) {
            const init = method === 'GET' ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: '{}' };
            const res = await fetch(base + path, init);
            assert.equal(res.status, 403, `${method} ${path}`);
            assert.equal((await res.json()).code, 'device', `${method} ${path}`);
        }
    } finally {
        server.close();
    }
});

test('a browser with no device cookie is told it has no device, without the database', async () => {
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const res = await fetch(`${base}/api/devices/status`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { state: 'none' });
    } finally {
        server.close();
    }
});
