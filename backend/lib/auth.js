// Login sessions. Logging in issues a random token; the browser sends it as "Authorization: Bearer <token>" on every
// other request. Only a SHA-256 hash of the token is stored, so the Sessions table alone can't be used to log in.
const crypto = require('crypto');
const { pool } = require('../db');
const { effectiveRole, isDevRole } = require('./roles');
const { isPublicDevicePath } = require('./devices');

// A session ends SESSION_HOURS after login, or after SESSION_IDLE_MINUTES without activity, whichever comes first
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;
const SESSION_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES) || 120;
// SQL for "this session (alias s) has not ended", with the idle limit as the given parameter number
const sessionLiveSql = (param) => `s.ExpiresOn > NOW() AND s.LastActiveOn > NOW() - make_interval(mins => $${param})`;

// Requests the screens make on their own (a timed refresh) send X-Background: 1, so an open, unattended window doesn't
// keep a session alive. Everything else counts as activity.
const countsAsActivity = (req) => req.get('X-Background') !== '1';
const ADMIN_ROLES = ['Office Admin', 'Business Administrator'];

// Request fields the frontend fills with the logged-in employee's email. requireSession overwrites them with the
// session's email, so a request can't act as someone else by changing them. (coveredBy is not one: it names another
// counselor on purpose, and lib/cashResponsibility.js checks who may set it.)
const IDENTITY_BODY_FIELDS = ['user', 'createdBy', 'updatedBy', 'assignedBy', 'removedBy'];

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// deviceId: the approved device the login came from (req.device, set by the device gate), shown in the DEV tab
const createSession = async (email, deviceId = null) => {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(
        `INSERT INTO Sessions (TokenHash, EmployeeEmail, ExpiresOn, DeviceId) VALUES ($1, $2, NOW() + make_interval(hours => $3), $4)`,
        [hashToken(token), email, SESSION_HOURS, deviceId]
    );
    // Ended sessions are only ever read to be refused; clear them out as new ones are made
    await pool.query(
        'DELETE FROM Sessions WHERE ExpiresOn < NOW() OR LastActiveOn < NOW() - make_interval(mins => $1)',
        [SESSION_IDLE_MINUTES]
    );
    return token;
};

const bearerToken = (req) => /^Bearer\s+(\S+)$/i.exec(req.get('Authorization') || '')?.[1] || null;

const endSession = (token) => pool.query('DELETE FROM Sessions WHERE TokenHash = $1', [hashToken(token)]);

// Signs an employee out everywhere (password changed or account deactivated)
const endSessionsFor = (email) => pool.query('DELETE FROM Sessions WHERE LOWER(EmployeeEmail) = LOWER($1)', [email]);

const stampIdentity = (req, email) => {
    const body = req.body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
        for (const field of IDENTITY_BODY_FIELDS) if (field in body) body[field] = email;
    }
    // req.query is a getter in Express 5, so it is replaced rather than assigned to
    if ('user' in req.query) Object.defineProperty(req, 'query', { value: { ...req.query, user: email }, configurable: true });
    req.headers['x-user'] = email;
    req.headers['x-user-email'] = email;
};

// The employee as the rest of the app sees them: a DEV account acts as a Business Administrator (role) and is marked
// isdev, which opens the DEV menu. accountrole keeps the role stored on the account.
const sessionUser = (row) => ({ ...row, accountrole: row.role, role: effectiveRole(row.role), isdev: isDevRole(row.role) });

// Every API route except login needs a valid session. Sets req.user to the employee (email, display name, role).
const requireSession = async (req, res, next) => {
    if (req.path === '/api/auth/login' || isPublicDevicePath(req.path)) return next();
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'Please log in.' });
    try {
        const result = await pool.query(
            `SELECT e.EmployeeEmail, e.DisplayName, e.Role, s.LastActiveOn < NOW() - INTERVAL '1 minute' AS stale
             FROM Sessions s JOIN EmployeeRoles e ON e.EmployeeEmail = s.EmployeeEmail
             WHERE s.TokenHash = $1 AND ${sessionLiveSql(2)} AND e.Active = TRUE`,
            [hashToken(token), SESSION_IDLE_MINUTES]
        );
        if (result.rows.length === 0) return res.status(401).json({ error: 'Your session has ended. Please log in again.' });
        // Recorded at most once a minute, so most requests don't write
        if (result.rows[0].stale && countsAsActivity(req)) {
            await pool.query('UPDATE Sessions SET LastActiveOn = NOW() WHERE TokenHash = $1', [hashToken(token)]);
        }
        const { stale, ...employee } = result.rows[0];
        req.user = sessionUser(employee);
        stampIdentity(req, req.user.employeeemail);
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Limits a route to the given roles (checked against the session, not anything the browser sends)
const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ error: 'You do not have permission to do that.' }));

// Limits a route to DEV accounts (the DEV menu)
const requireDev = (req, res, next) => (req.user?.isdev === true
    ? next()
    : res.status(403).json({ error: 'You do not have permission to do that.' }));

// Failed logins per email; after LOGIN_MAX_FAILURES within LOGIN_LOCK_MINUTES, that email is refused until the window passes
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;
const loginFailures = new Map();
const loginKey = (email) => String(email || '').trim().toLowerCase();
const loginLocked = (email) => {
    const entry = loginFailures.get(loginKey(email));
    if (!entry) return false;
    if (Date.now() - entry.first > LOGIN_LOCK_MINUTES * 60 * 1000) {
        loginFailures.delete(loginKey(email));
        return false;
    }
    return entry.count >= LOGIN_MAX_FAILURES;
};
const recordLoginFailure = (email) => {
    const key = loginKey(email);
    const entry = loginFailures.get(key);
    if (entry) entry.count++;
    else loginFailures.set(key, { count: 1, first: Date.now() });
};
const clearLoginFailures = (email) => loginFailures.delete(loginKey(email));

module.exports = {
    ADMIN_ROLES, LOGIN_LOCK_MINUTES, SESSION_HOURS, SESSION_IDLE_MINUTES, sessionLiveSql, countsAsActivity,
    createSession, bearerToken, hashToken, endSession, endSessionsFor, stampIdentity,
    requireSession, requireRole, requireDev, sessionUser, loginLocked, recordLoginFailure, clearLoginFailures,
};
