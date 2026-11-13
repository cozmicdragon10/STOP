const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { currentBuild } = require('../frontendServer');

// A temporary site/ folder with the given builds, current.txt, and fallback dist
const layout = ({ builds = [], current, fallback = false }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-site-'));
    const site = path.join(dir, 'site');
    for (const name of builds) {
        fs.mkdirSync(path.join(site, 'builds', name), { recursive: true });
        fs.writeFileSync(path.join(site, 'builds', name, 'index.html'), '<html></html>');
    }
    if (current !== undefined) { fs.mkdirSync(site, { recursive: true }); fs.writeFileSync(path.join(site, 'current.txt'), current); }
    const dist = path.join(dir, 'dist');
    if (fallback) { fs.mkdirSync(dist); fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>'); }
    return { site, dist };
};

test('serves the build named in current.txt', () => {
    const { site, dist } = layout({ builds: ['20261112-1600', '20261112-1700'], current: '20261112-1600\r\n', fallback: true });
    assert.equal(currentBuild(site, dist), path.join(site, 'builds', '20261112-1600'));
});

test('falls back to frontend/dist without current.txt, or when it names a missing or broken build', () => {
    let l = layout({ fallback: true });
    assert.equal(currentBuild(l.site, l.dist), l.dist);
    l = layout({ builds: ['a'], current: 'gone', fallback: true });
    assert.equal(currentBuild(l.site, l.dist), l.dist);
});

test('current.txt cannot point outside site/builds', () => {
    const l = layout({ builds: ['a'], current: '..\\..\\dist', fallback: false });
    assert.equal(currentBuild(l.site, l.dist), null);
    const l2 = layout({ builds: ['a'], current: '../builds/a', fallback: false });
    assert.equal(currentBuild(l2.site, l2.dist), null);
});

test('the site port passes /api requests to the API and serves the screens for everything else', async () => {
    const express = require('express');
    const http = require('http');
    const { frontendApp } = require('../frontendServer');
    const l = layout({ fallback: true });
    const api = express();
    api.get('/api/ping', (req, res) => res.json({ path: req.path }));
    const server = http.createServer(frontendApp(l.dist, api)).listen(0);
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        assert.deepEqual(await (await fetch(`${base}/api/ping`)).json(), { path: '/api/ping' });
        assert.equal(await (await fetch(`${base}/clients`)).text(), '<html></html>');
    } finally {
        server.close();
    }
});

test('nothing to serve gives null', () => {
    const l = layout({});
    assert.equal(currentBuild(l.site, l.dist), null);
});
