// Session and access checks that run before any database work, so they need no database
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app');
const { requireRole, stampIdentity } = require('../lib/auth');

let server, base;
before(() => {
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('API calls without a session are refused', async () => {
    for (const [method, path] of [['GET', '/api/clients'], ['GET', '/api/admin/logs'], ['POST', '/api/admin/employees'],
        ['DELETE', '/api/groups/1'], ['POST', '/api/auth/logout'], ['GET', '/api/does-not-exist']]) {
        const res = await fetch(base + path, { method });
        assert.equal(res.status, 401, `${method} ${path}`);
    }
});

test('a malformed Authorization header is refused', async () => {
    const res = await fetch(`${base}/api/clients`, { headers: { Authorization: 'Basic abc' } });
    assert.equal(res.status, 401);
});

test('only the frontend origin may call the API from a browser', async () => {
    const allowed = await fetch(`${base}/api/clients`, { method: 'OPTIONS', headers: { Origin: 'https://192.168.1.133:5173', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://192.168.1.133:5173');
    const other = await fetch(`${base}/api/clients`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('identity fields are replaced with the session email', () => {
    const req = {
        body: { user: 'admin@example.com', createdBy: 'admin@example.com', updatedBy: 'x', comments: 'kept' },
        query: { user: 'admin@example.com', from: '2026-01-01' },
        headers: { 'x-user': 'admin@example.com' },
    };
    stampIdentity(req, 'counselor@example.com');
    assert.deepEqual(req.body, { user: 'counselor@example.com', createdBy: 'counselor@example.com', updatedBy: 'counselor@example.com', comments: 'kept' });
    assert.deepEqual(req.query, { user: 'counselor@example.com', from: '2026-01-01' });
    assert.equal(req.headers['x-user'], 'counselor@example.com');
    assert.equal(req.headers['x-user-email'], 'counselor@example.com');
});

test('identity fields are not added where the request had none', () => {
    const req = { body: { comments: 'only' }, query: {}, headers: {} };
    stampIdentity(req, 'counselor@example.com');
    assert.deepEqual(req.body, { comments: 'only' });
    assert.deepEqual(req.query, {});
});

test('requireRole checks the session role', () => {
    const run = (role) => {
        let status = null, passed = false;
        const res = { status: (s) => { status = s; return { json: () => {} }; } };
        requireRole('Office Admin', 'Business Administrator')({ user: { role } }, res, () => { passed = true; });
        return passed ? 'next' : status;
    };
    assert.equal(run('Business Administrator'), 'next');
    assert.equal(run('Office Admin'), 'next');
    assert.equal(run('Counselor'), 403);
    assert.equal(run(undefined), 403);
});
