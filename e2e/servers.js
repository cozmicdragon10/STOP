// The tests run against their own copy of STOP: the backend from backend/ and the site from frontend/ (the Vite dev
// server, so the current source is tested), both on the DEV database (APP_ENV=dev, stop_dev), on ports nothing else
// uses. They never touch the live site on 5000/5173 or the developer's own dev servers on 5100/5174.
//
// The copy asks for an approved device like any browser. The first run approves one from the server console
// (scripts/bootstrap-device.js --recover, against stop_dev only) and keeps its cookie in e2e/.device-token; later runs
// reuse it.
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const FRONTEND = path.join(ROOT, 'frontend');
const API_PORT = 5120;
const SITE_PORT = 5122;
// The backend also serves the last built site on a second port; unused by the tests, but it must not clash
const BUILT_SITE_PORT = 5121;
const SITE = `https://localhost:${SITE_PORT}`;
const API = `https://localhost:${API_PORT}/api`;
const DEVICE_FILE = path.join(__dirname, '.device-token');
const DEVICE_NAME = 'E2E test runner (stop_dev)';
const DEV_DATABASE = 'stop_dev';

// The server uses the office's self-signed certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const portInUse = (port) => new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
});

const devEnv = (extra) => ({ ...process.env, APP_ENV: 'dev', ...extra });

// Starts one server and resolves once a line of its output matches `ready`; rejects if it exits first or takes too long
const startServer = (label, args, cwd, env, ready) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => fail(new Error(`${label} did not start within 60 seconds.`)), 60000);
    const fail = (err) => {
        clearTimeout(timer);
        child.kill();
        reject(new Error(`${err.message}\n--- ${label} output ---\n${output.slice(-2000)}`));
    };
    const onData = (chunk) => {
        // Without terminal colour codes, which split words like "Local:"
        output += String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
        if (ready.test(output)) { clearTimeout(timer); resolve({ child, output: () => output }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => fail(new Error(`${label} stopped (exit code ${code}).`)));
});

let running = [];

async function startServers() {
    for (const port of [API_PORT, BUILT_SITE_PORT, SITE_PORT]) {
        if (await portInUse(port)) {
            throw new Error(`Port ${port} is already in use. Is another test run going? Stop it and try again.`);
        }
    }
    console.log(`Starting a test copy of STOP on the ${DEV_DATABASE} database...`);
    const backend = await startServer('Test backend', ['server.js'], BACKEND,
        devEnv({ PORT: String(API_PORT), FRONTEND_PORT: String(BUILT_SITE_PORT), CORS_ORIGINS: SITE }),
        /Backend Server running/);
    running.push(backend.child);
    // Belt and braces: refuse to go on unless the server said it is on the DEV database
    const db = /Using database (\S+)/.exec(backend.output());
    if (!db || db[1] !== DEV_DATABASE) {
        stopServers();
        throw new Error(`The test backend is on database "${db ? db[1] : 'unknown'}", not ${DEV_DATABASE}. Stopped.`);
    }
    const site = await startServer('Test site', [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(SITE_PORT), '--strictPort'],
        FRONTEND, { ...process.env, VITE_API_PORT: String(API_PORT) }, /Local:/);
    running.push(site.child);
    console.log(`Test copy running: site ${SITE}, API ${API}\n`);
}

function stopServers() {
    for (const child of running) {
        if (child.exitCode === null) child.kill();
    }
    running = [];
}

// The device cookie the test copy accepts: the saved one while it is still approved, otherwise a new one
async function deviceToken() {
    const saved = fs.existsSync(DEVICE_FILE) ? fs.readFileSync(DEVICE_FILE, 'utf8').trim() : '';
    if (saved) {
        const r = await fetch(`${API}/devices/status`, { headers: { Cookie: `stop_device=${encodeURIComponent(saved)}` } });
        if ((await r.json()).state === 'approved') return saved;
    }
    const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join('scripts', 'bootstrap-device.js'), '--recover', DEVICE_NAME],
            { cwd: BACKEND, env: devEnv({}), stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', c => { output += c; });
        child.stderr.on('data', c => { output += c; });
        child.once('exit', () => {
            const db = /Database: (\S+)/.exec(output);
            const found = /Setup code[^:]*: ([A-Z0-9-]+)/.exec(output);
            if (!db || db[1] !== DEV_DATABASE) reject(new Error(`Device setup ran against "${db ? db[1] : 'unknown'}", not ${DEV_DATABASE}.`));
            else if (!found) reject(new Error(`Could not approve a test device:\n${output}`));
            else resolve(found[1]);
        });
    });
    const r = await fetch(`${API}/devices/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const cookie = /stop_device=([^;]+)/.exec(r.headers.get('set-cookie') || '');
    if (!r.ok || !cookie) throw new Error(`Could not redeem the test device's setup code (HTTP ${r.status}).`);
    const token = decodeURIComponent(cookie[1]);
    fs.writeFileSync(DEVICE_FILE, token);
    console.log(`Approved test device "${DEVICE_NAME}" on ${DEV_DATABASE}.`);
    return token;
}

module.exports = { startServers, stopServers, deviceToken, SITE, API };
