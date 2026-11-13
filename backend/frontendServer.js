// Serves the built frontend over HTTPS on FRONTEND_PORT (5173 by default, the address staff already use). This is how
// the app runs in production: the screens only change when a new build is made and the server restarted, never while
// someone is editing the source code. The Vite dev server (npm run dev) uses port 5174, so the two can run side by side.
//
// Which build: site/current.txt names a folder in site/builds/ (deploy/update.ps1 builds a new folder there and points
// current.txt at it; deploy/rollback.ps1 points it back). Without one, frontend/dist (from `npm run build`) is served.
// Builds are never renamed or overwritten while being served.
const express = require('express');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const FALLBACK = path.join(ROOT, 'frontend', 'dist');

const hasIndex = (dir) => fs.existsSync(path.join(dir, 'index.html'));

// The folder to serve, or null when there is no build
const currentBuild = (site = SITE, fallback = FALLBACK) => {
    try {
        const name = fs.readFileSync(path.join(site, 'current.txt'), 'utf8').trim();
        const dir = path.join(site, 'builds', name);
        // Only a plain folder name inside site/builds counts
        if (name && path.basename(name) === name && hasIndex(dir)) return dir;
    } catch { /* no current.txt: fall back */ }
    return hasIndex(fallback) ? fallback : null;
};

// The app for a built frontend folder. With `api` (the app from app.js), requests to /api/... on this port go to the API
// too, so the screens call it on their own address: one port is all that has to reach the outside, with no CORS needed.
const frontendApp = (dist, api) => {
    const app = express();
    app.disable('x-powered-by');
    if (api) app.use((req, res, next) => (req.path.startsWith('/api/') ? api(req, res, next) : next()));
    // Built files have a content hash in their names, so they can be cached for good
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '365d', fallthrough: false }));
    // Everything else, index.html above all, is checked on every load so an update reaches everyone on their next reload
    app.use(express.static(dist, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
    // The app is one page: any other path gets index.html
    app.use((req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(dist, 'index.html'));
    });
    return app;
};

module.exports = { currentBuild, frontendApp, SITE, FALLBACK };
