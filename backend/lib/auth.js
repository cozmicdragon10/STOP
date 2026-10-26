// Login sessions. Logging in issues a random token; the browser sends it as "Authorization: Bearer <token>" on every
// other request. Only a SHA-256 hash of the token is stored, so the Sessions table alone can't be used to log in.
const crypto = require('crypto');
const { pool } = require('../db');

const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;
const ADMIN_ROLES = ['Office Admin', 'Business Administrator'];

// Request fields the frontend fills with the logged-in employee's email. requireSession overwrites them with the
// session's email, so a request can't act as someone else by changing them.
const IDENTITY_BODY_FIELDS = ['user', 'createdBy', 'updatedBy'];

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const createSession = async (email) => {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(
        `INSERT INTO Sessions (TokenHash, EmployeeEmail, ExpiresOn) VALUES ($1, $2, NOW() + make_interval(hours => $3))`,
        [hashToken(token), email, SESSION_HOURS]
    );
    // Expired sessions are only ever read to be refused; clear them out as new ones are made
    await pool.query('DELETE FROM Sessions WHERE ExpiresOn < NOW()');
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

// Every API route except login needs a valid session. Sets req.user to the employee (email, display name, role).
const requireSession = async (req, res, next) => {
    if (req.path === '/api/auth/login') return next();
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'Please log in.' });
    try {
        const result = await pool.query(
            `SELECT e.EmployeeEmail, e.DisplayName, e.Role
             FROM Sessions s JOIN EmployeeRoles e ON e.EmployeeEmail = s.EmployeeEmail
             WHERE s.TokenHash = $1 AND s.ExpiresOn > NOW() AND e.Active = TRUE`,
            [hashToken(token)]
        );
        if (result.rows.length === 0) return res.status(401).json({ error: 'Your session has ended. Please log in again.' });
        req.user = result.rows[0];
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
    ADMIN_ROLES, LOGIN_LOCK_MINUTES, createSession, bearerToken, endSession, endSessionsFor, stampIdentity,
    requireSession, requireRole, loginLocked, recordLoginFailure, clearLoginFailures,
};
