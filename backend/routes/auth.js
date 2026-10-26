const express = require('express');
const { verifyPassword } = require('../passwords');
const { logAction, pool } = require('../db');
const { LOGIN_LOCK_MINUTES, createSession, bearerToken, endSession, loginLocked, recordLoginFailure, clearLoginFailures } = require('../lib/auth');

const router = express.Router();

router.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        if (loginLocked(email)) {
            await logAction(email, 'Login Failed', 'Login refused: too many failed attempts', 'Login');
            return res.status(429).json({ error: `Too many failed attempts. Try again in ${LOGIN_LOCK_MINUTES} minutes.` });
        }
        const result = await pool.query(
            'SELECT * FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE',
            [email]
        );
        const row = result.rows[0];
        const passwordOk = row ? await verifyPassword(password || '', row.passwordhash) : false;
        if (!passwordOk) {
            recordLoginFailure(email);
            await logAction(email, 'Login Failed', 'Incorrect password, unauthorized, or inactive user login attempt', 'Login');
            return res.status(403).json({ error: 'Email or password is incorrect, or the account is inactive.' });
        }
        clearLoginFailures(email);
        const token = await createSession(row.employeeemail);
        await logAction(email, 'User Login', 'User logged in successfully', 'Login');
        // Never send the password hash to the browser
        const { passwordhash, ...user } = row;
        res.json({ success: true, user, token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/auth/logout', async (req, res) => {
    try {
        await endSession(bearerToken(req));
        await logAction(req.user.employeeemail, 'User Logout', 'User logged out', 'Login');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
