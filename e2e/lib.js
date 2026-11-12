// Shared pieces for the end-to-end tests. Person A uses the real site in Edge (headless); person B is a second login
// talking to the API directly, the way another workstation would.
const fs = require('fs');
const path = require('path');

const SITE = process.env.STOP_E2E_SITE || 'https://localhost:5173';
const API = process.env.STOP_E2E_API || 'https://localhost:5000/api';
const LOGIN_FILE = process.env.STOP_E2E_LOGIN || path.join(__dirname, 'login.json');
const SHOTS = path.join(__dirname, 'screenshots');

// The server uses the office's self-signed certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.removeAllListeners('warning');

const login = () => {
    if (!fs.existsSync(LOGIN_FILE)) throw new Error(`No login file at ${LOGIN_FILE}. See README.md.`);
    return JSON.parse(fs.readFileSync(LOGIN_FILE, 'utf8'));
};

// Person B
let token = null;
async function api(method, url, body) {
    if (!token) {
        const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(login()) });
        token = (await r.json()).token;
        if (!token) throw new Error(`Person B could not log in (HTTP ${r.status}).`);
    }
    const r = await fetch(`${API}${url}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text.slice(0, 200); }
    return { status: r.status, body: json };
}

// Person A: a logged-in browser page
async function browser() {
    const { chromium } = require('playwright-core');
    const b = await chromium.launch({ channel: 'msedge', headless: true });
    const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    const { email, password } = login();
    await page.goto(SITE);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', password);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    return { b, page };
}

// Main tabs (bottom bar) and the test client's account
const tab = (page, name) => page.getByRole('button', { name }).first().click().then(() => page.waitForTimeout(1200));
async function openClient(page) {
    await tab(page, /^(Client Roster|Clients)$/);
    await page.locator('input[placeholder*="Search name" i] >> visible=true').first().fill('Concurrency');
    await page.waitForTimeout(800);
    await page.locator('text="Test, Concurrency" >> visible=true').first().click();
    await page.waitForTimeout(1500);
}
// The input under a label on the client's Information tab
const fieldInput = (page, label) => page.locator(`p:text-is("${label}") >> visible=true`).first()
    .locator('xpath=..').locator('input, select, textarea').first();
// Every refusal message on screen
const shownMessages = async (page) => (await page.locator('text=/Not (saved|deleted)/ >> visible=true').allInnerTexts()).join(' | ');
const shot = async (page, name) => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

module.exports = { api, browser, tab, openClient, fieldInput, shownMessages, shot, login, SITE, API };
