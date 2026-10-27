const express = require('express');
const { hashPassword } = require('../passwords');
const { logAction, pool } = require('../db');
const { ADMIN_ROLES, endSessionsFor, requireRole } = require('../lib/auth');

const router = express.Router();
// Account changes and the system log are for the Admin tab's roles only. The employee list stays open to every
// logged-in role because the other tabs use it to name counselors and polygraphers.
const adminOnly = requireRole(...ADMIN_ROLES);

router.get('/api/admin/employees', async (req, res) => {
    try {
        // Password hashes are never sent to the browser
        const result = await pool.query('SELECT EmployeeEmail, DisplayName, Role, Location, Active FROM EmployeeRoles ORDER BY DisplayName ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Edit an existing account's name, role, and active status. The email is the account key and cannot change.
router.put('/api/admin/employees/:email', adminOnly, async (req, res) => {
    try {
        const email = req.params.email;
        const { displayName, role, active, updatedBy, password } = req.body;
        if (!String(displayName || '').trim() || !String(role || '').trim()) {
            return res.status(400).json({ error: 'Display name and role are required.' });
        }
        const before = await pool.query('SELECT DisplayName, Role, Active FROM EmployeeRoles WHERE EmployeeEmail = $1', [email]);
        if (before.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found.' });
        }
        // Blank password means "keep the current one"
        const newPassword = String(password || '');
        const passwordHash = newPassword ? await hashPassword(newPassword) : null;
        const result = await pool.query(
            `UPDATE EmployeeRoles SET DisplayName = $1, Role = $2, Active = $3,
                PasswordHash = COALESCE($4, PasswordHash)
             WHERE EmployeeEmail = $5 RETURNING EmployeeEmail`,
            [displayName.trim(), role.trim(), active !== false, passwordHash, email]
        );
        // A new password or a deactivated account signs that employee out everywhere
        if (passwordHash || active === false) await endSessionsFor(email);
        const old = before.rows[0];
        await logAction(
            updatedBy || 'unknown',
            'Account Updated',
            `Updated ${email}: name "${old.displayname}" → "${displayName.trim()}", role ${old.role} → ${role.trim()}, active ${old.active} → ${active !== false}.${passwordHash ? ' Password changed.' : ''}`,
            'Admin'
        );
        res.json({ success: true, employeeEmail: result.rows[0].employeeemail });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/admin/employees', adminOnly, async (req, res) => {
    try {
        const { employeeEmail, displayName, role, location, active, password } = req.body;
        if (!String(password || '').trim()) {
            return res.status(400).json({ error: 'A password is required for a new account.' });
        }
        // New User never overwrites an existing account (a mistyped email would reset someone's role and password);
        // existing accounts are changed with Edit, which also signs them out when the password changes
        const taken = await pool.query('SELECT 1 FROM EmployeeRoles WHERE LOWER(EmployeeEmail) = LOWER($1)', [employeeEmail || '']);
        if (taken.rows.length > 0) {
            return res.status(409).json({ error: 'An account with this email already exists. Use Edit on that account instead.' });
        }
        const passwordHash = await hashPassword(String(password));
        await pool.query(
            'INSERT INTO EmployeeRoles (EmployeeEmail, DisplayName, Role, Location, Active, PasswordHash) VALUES ($1, $2, $3, $4, $5, $6)',
            [employeeEmail, displayName, role, location, active, passwordHash]
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
