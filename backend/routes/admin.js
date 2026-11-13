const express = require('express');
const { hashPassword } = require('../passwords');
const { logAction, pool } = require('../db');
const { ADMIN_ROLES, endSessionsFor, requireRole } = require('../lib/auth');
const { staleFields, staleMessage } = require('../lib/editConflicts');
const { accountChangeProblem } = require('../lib/accounts');

const router = express.Router();

// A counselor's credentials (e.g. "LPC, LADC-MH"); other roles have none
const credentialsFor = (role, credentials) => (String(role || '').trim() === 'Counselor' ? String(credentials || '').trim().slice(0, 100) || null : null);
// Account changes and the system log are for the Admin tab's roles only. The employee list stays open to every
// logged-in role because the other tabs use it to name counselors and polygraphers.
const adminOnly = requireRole(...ADMIN_ROLES);
// Creating and changing accounts is for Business Administrators, as on the Admin tab (Office Admins see the list only)
const accountsOnly = requireRole('Business Administrator');
// What the account form saves, checked against the account as the form loaded it
const EMPLOYEE_FIELDS = [['displayname', 'Display Name'], ['role', 'Role'], ['active', 'Active', 'yesno'], ['credentials', 'Credentials']];

router.get('/api/admin/employees', async (req, res) => {
    try {
        // Password hashes are never sent to the browser
        const result = await pool.query('SELECT EmployeeEmail, DisplayName, Role, Location, Active, Credentials FROM EmployeeRoles ORDER BY DisplayName ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Edit an existing account's name, role, and active status. The email is the account key and cannot change.
// expected: the account as the form loaded it; if it has changed since (say, deactivated by another admin), nothing is
// saved (409) so the form can't quietly undo that (see lib/editConflicts.js)
router.put('/api/admin/employees/:email', accountsOnly, async (req, res) => {
    const db = await pool.connect();
    try {
        const email = req.params.email;
        const { displayName, role, active, updatedBy, password, expected } = req.body;
        if (!String(displayName || '').trim() || !String(role || '').trim()) {
            return res.status(400).json({ error: 'Display name and role are required.' });
        }
        await db.query('BEGIN');
        const before = await db.query('SELECT DisplayName, Role, Active, Credentials FROM EmployeeRoles WHERE EmployeeEmail = $1 FOR UPDATE', [email]);
        if (before.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Account not found.' });
        }
        const stale = staleFields(expected, before.rows[0], EMPLOYEE_FIELDS);
        if (stale.length) {
            await db.query('ROLLBACK');
            return res.status(409).json({ error: staleMessage('this account', stale, before.rows[0]), conflict: true });
        }
        // Who may change which account (lib/accounts.js), judged by the session, not by anything the browser sent
        const others = await db.query(
            "SELECT COUNT(*) AS n FROM EmployeeRoles WHERE Role IN ('Business Administrator', 'DEV') AND Active = TRUE AND LOWER(EmployeeEmail) <> LOWER($1)", [email]);
        const problem = accountChangeProblem({
            actor: req.user, target: { employeeemail: email, role: before.rows[0].role, active: before.rows[0].active },
            next: { role, active: active !== false }, otherActiveTopRole: Number(others.rows[0].n),
        });
        if (problem) {
            await db.query('ROLLBACK');
            return res.status(403).json({ error: problem });
        }
        // Blank password means "keep the current one"
        const newPassword = String(password || '');
        const passwordHash = newPassword ? await hashPassword(newPassword) : null;
        // Credentials are kept as they are when the request doesn't send them
        const credentials = req.body.credentials === undefined ? (role.trim() === 'Counselor' ? before.rows[0].credentials : null) : credentialsFor(role, req.body.credentials);
        const result = await db.query(
            `UPDATE EmployeeRoles SET DisplayName = $1, Role = $2, Active = $3,
                PasswordHash = COALESCE($4, PasswordHash), Credentials = $6
             WHERE EmployeeEmail = $5 RETURNING EmployeeEmail`,
            [displayName.trim(), role.trim(), active !== false, passwordHash, email, credentials]
        );
        await db.query('COMMIT');
        // A new password or a deactivated account signs that employee out everywhere
        if (passwordHash || active === false) await endSessionsFor(email);
        const old = before.rows[0];
        await logAction(
            updatedBy || 'unknown',
            'Account Updated',
            `Updated ${email}: name "${old.displayname}" → "${displayName.trim()}", role ${old.role} → ${role.trim()}, active ${old.active} → ${active !== false}.${(old.credentials || null) !== credentials ? ` Credentials "${old.credentials || ''}" → "${credentials || ''}".` : ''}${passwordHash ? ' Password changed.' : ''}`,
            'Admin'
        );
        res.json({ success: true, employeeEmail: result.rows[0].employeeemail });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

router.post('/api/admin/employees', accountsOnly, async (req, res) => {
    try {
        const { employeeEmail, displayName, role, location, active, password, credentials } = req.body;
        if (!String(password || '').trim()) {
            return res.status(400).json({ error: 'A password is required for a new account.' });
        }
        if (!String(employeeEmail || '').trim() || !String(displayName || '').trim()) {
            return res.status(400).json({ error: 'An email and a display name are required.' });
        }
        // Only a Business Administrator creates a Business Administrator (lib/accounts.js)
        const problem = accountChangeProblem({ actor: req.user, target: null, next: { role, active }, otherActiveTopRole: 0 });
        if (problem) return res.status(403).json({ error: problem });
        // New User never overwrites an existing account (a mistyped email would reset someone's role and password);
        // existing accounts are changed with Edit, which also signs them out when the password changes
        const taken = await pool.query('SELECT 1 FROM EmployeeRoles WHERE LOWER(EmployeeEmail) = LOWER($1)', [employeeEmail || '']);
        if (taken.rows.length > 0) {
            return res.status(409).json({ error: 'An account with this email already exists. Use Edit on that account instead.' });
        }
        const passwordHash = await hashPassword(String(password));
        await pool.query(
            'INSERT INTO EmployeeRoles (EmployeeEmail, DisplayName, Role, Location, Active, PasswordHash, Credentials) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [employeeEmail, displayName, role, location, active, passwordHash, credentialsFor(role, credentials)]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/admin/logs', adminOnly, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM SystemLogs ORDER BY Timestamp DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
