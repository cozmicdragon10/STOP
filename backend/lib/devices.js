// Approved devices: a browser must be approved before it can reach the API at all (see docs/device-approval-plan.md).
// A new browser asks for access with its name, the employee email on its account and a note. The owner approves or
// denies the request in the DEV tab. The browser keeps a random token in an HTTP-only cookie; only its SHA-256 hash is
// stored, so the Devices table alone can't be used to get in.
const crypto = require('crypto');
const { pool } = require('../db');

const COOKIE = 'stop_device';
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // browsers cap cookie lifetimes; approval itself never expires
const PENDING_HOURS = 24;          // a request nobody acts on is marked expired after this
const NAME_MAX = 80;
const NOTE_MAX = 300;
const MEMO_MAX = 500;
const CAP_PER_EMAIL = 2;           // pending requests for one employee email
const CAP_TOTAL = 20;              // pending requests overall, a backstop
const LOCK_MAX_FAILURES = 5;       // wrong emails or setup codes from one address
const LOCK_MINUTES = 15;
const SETUP_CODE_MINUTES = 30;
const LAST_SEEN_EVERY_MS = 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SETUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0, O, 1 or I

// Routes that work before a device is approved (they are the only way to get approved)
const DEVICE_PUBLIC_PATHS = ['/api/devices/status', '/api/devices/request', '/api/devices/redeem'];
const isPublicDevicePath = (path) => DEVICE_PUBLIC_PATHS.includes(path);

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

// The address the request came from, without the IPv4-in-IPv6 prefix. Used only in memory, to key the wrong-attempt
// lockouts; addresses are never stored or shown.
const clientAddress = (req) => String(req.ip || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');

// The device token from the Cookie header, or null
const deviceToken = (req) => {
    const header = req.get('Cookie') || '';
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        if (part.slice(0, i).trim() === COOKIE) {
            try {
                return decodeURIComponent(part.slice(i + 1).trim()) || null;
            } catch {
                return null;
            }
        }
    }
    return null;
};

const setDeviceCookie = (res, token) => res.cookie(COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: COOKIE_MAX_AGE_MS,
});

// Wrong-attempt lockouts, kept in memory like the login lockout in lib/auth.js. A key is an address plus the kind of
// attempt, e.g. "email:10.0.0.5".
const failures = new Map();
const lockKey = (kind, ip) => `${kind}:${ip}`;
const locked = (key) => {
    const entry = failures.get(key);
    if (!entry) return false;
    if (Date.now() - entry.first > LOCK_MINUTES * 60 * 1000) {
        failures.delete(key);
        return false;
    }
    return entry.count >= LOCK_MAX_FAILURES;
};
const recordFailure = (key) => {
    const entry = failures.get(key);
    if (entry) entry.count++;
    else failures.set(key, { count: 1, first: Date.now() });
};
const clearFailures = (key) => failures.delete(key);
const lockMessage = `Too many wrong attempts from this connection. Try again in ${LOCK_MINUTES} minutes.`;

// Checks a request for access. Returns { value } or { error }. The name and email are required; the note is optional.
const validateRequest = (body) => {
    const email = String(body?.email ?? '').trim().toLowerCase();
    const name = String(body?.name ?? '').trim();
    const note = String(body?.note ?? '').trim();
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
        return { error: 'Enter the email address on your STOP account.' };
    }
    if (!name) return { error: 'Enter your name so the office knows who is asking.' };
    if (name.length > NAME_MAX) return { error: `Your name must be ${NAME_MAX} characters or fewer.` };
    if (note.length > NOTE_MAX) return { error: `The note must be ${NOTE_MAX} characters or fewer.` };
    return { value: { email, name, note } };
};

// Checks an owner's text (a name or an approval memo). Empty is allowed unless required.
const cleanText = (value, max, { required = false } = {}) => {
    const text = String(value ?? '').trim();
    if (required && !text) return { error: 'This cannot be empty.' };
    if (text.length > max) return { error: `Keep it to ${max} characters or fewer.` };
    return { value: text || null };
};

// Which cap, if any, stops a new request: 'email', 'total', or null when it may go ahead
const capReason = ({ pendingForEmail, pendingTotal }) => {
    if (pendingForEmail >= CAP_PER_EMAIL) return 'email';
    if (pendingTotal >= CAP_TOTAL) return 'total';
    return null;
};

// Setup codes are typed in by the owner from the server console (see scripts/bootstrap-device.js)
const newSetupCode = () => {
    let code = '';
    for (let i = 0; i < 10; i++) code += SETUP_ALPHABET[crypto.randomInt(SETUP_ALPHABET.length)];
    return `${code.slice(0, 5)}-${code.slice(5)}`;
};
const normalizeSetupCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// The device row for a token, or null
const deviceByToken = async (token) => {
    if (!token) return null;
    const result = await pool.query(
        'SELECT DeviceId, Status, Name, LastSeenOn, TokenHash FROM Devices WHERE TokenHash = $1',
        [hashToken(token)]
    );
    return result.rows[0] ?? null;
};

// Pending requests past their 24 hours become expired (kept for the record, but they no longer count against the caps)
const expirePending = () => pool.query(
    "UPDATE Devices SET Status = 'expired' WHERE Status = 'pending' AND ExpiresOn < NOW()"
);

// Express middleware, before requireSession. Lets a request through only from an approved device. Refuses everything
// else with code 'device', including requests that have no token at all.
const deviceGate = async (req, res, next) => {
    if (isPublicDevicePath(req.path)) return next();
    const refuse = () => res.status(403).json({
        error: 'This device is not approved to use STOP. Request access first.',
        code: 'device',
    });
    try {
        const token = deviceToken(req);
        const device = await deviceByToken(token);
        if (!device || device.status !== 'approved') return refuse();
        const stale = !device.lastseenon || Date.now() - new Date(device.lastseenon).getTime() > LAST_SEEN_EVERY_MS;
        if (stale) {
            await pool.query('UPDATE Devices SET LastSeenOn = NOW() WHERE DeviceId = $1', [device.deviceid]);
            // Approval never expires, but browsers drop a cookie after at most 400 days; renewing it on use (at most
            // hourly) keeps a device that is in use approved for good
            setDeviceCookie(res, token);
        }
        req.device = { id: device.deviceid, name: device.name };
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Creates an approved device with a one-time setup code to enter in its browser. Without `recover` it is refused once
// any approved device is in use (has a token), so later devices go through the request flow. With `recover` it works
// anyway: the way back in when every approved device has lost its cookie. Only someone at the server can run it.
// A device whose code was never used (say it expired) is replaced, so running this again gives a fresh code.
const createFirstDevice = async (name, { recover = false } = {}) => {
    if (!recover) {
        const inUse = await pool.query("SELECT COUNT(*)::int AS n FROM Devices WHERE Status = 'approved' AND TokenHash IS NOT NULL");
        if (inUse.rows[0].n > 0) {
            throw new Error('A device is already approved. Other devices must request access in the app. '
                + 'If no approved device can get in any more, run this again with --recover.');
        }
    }
    await pool.query("DELETE FROM Devices WHERE Status = 'approved' AND TokenHash IS NULL");
    const code = newSetupCode();
    const memo = recover ? 'Recovery device, set up from the server console' : 'First device, set up from the server console';
    await pool.query(
        `INSERT INTO Devices (Status, Name, RequestName, DecidedOn, DecidedBy, ApprovalMemo, RequestedOn, SetupCodeHash, SetupCodeExpiresOn)
         VALUES ('approved', $1, $1, NOW(), 'server console', $2, NOW(), $3, NOW() + make_interval(mins => $4))`,
        [name, memo, hashToken(normalizeSetupCode(code)), SETUP_CODE_MINUTES]
    );
    return { code };
};

module.exports = {
    COOKIE, PENDING_HOURS, NAME_MAX, NOTE_MAX, MEMO_MAX, CAP_PER_EMAIL, CAP_TOTAL, LOCK_MAX_FAILURES,
    LOCK_MINUTES, DEVICE_PUBLIC_PATHS, isPublicDevicePath, hashToken, newToken, clientAddress, deviceToken,
    setDeviceCookie, lockKey, locked, recordFailure, clearFailures, lockMessage, validateRequest, cleanText, capReason,
    newSetupCode, normalizeSetupCode, deviceByToken, expirePending, deviceGate, createFirstDevice,
};
