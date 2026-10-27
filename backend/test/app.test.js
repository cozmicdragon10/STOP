const { test } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app');

const routes = () => app.router.stack
    .flatMap(layer => layer.handle?.stack ?? [])
    .filter(layer => layer.route)
    .flatMap(layer => Object.keys(layer.route.methods).map(m => `${m.toUpperCase()} ${layer.route.path}`));

test('every API route is mounted once', () => {
    const list = routes();
    assert.equal(list.length, 86);
    assert.equal(new Set(list).size, list.length, 'a route is registered twice');
    for (const r of list) assert.match(r, /^(GET|POST|PUT|PATCH|DELETE) \/api\//);
});

test('each API area has its routes', () => {
    const list = routes();
    for (const prefix of ['/api/auth/', '/api/clients', '/api/groups', '/api/attendance', '/api/open-groups', '/api/session-types',
        '/api/individual-sessions/', '/api/financials/', '/api/callin/', '/api/polygraphs/', '/api/testing', '/api/reports/',
        '/api/admin/', '/api/agents']) {
        assert.ok(list.some(r => r.split(' ')[1].startsWith(prefix)), `no routes under ${prefix}`);
    }
});

