const express = require('express');
const { verifyPassword } = require('../passwords');
const { logAction, pool } = require('../db');

const router = express.Router();

router.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE',
            [email]
        );
        const row = result.rows[0];
        const passwordOk = row ? await verifyPassword(password || '', row.passwordhash) : false;
        if (!passwordOk) {
            await logAction(email, 'Login Failed', 'Incorrect password, unauthorized, or inactive user login attempt', 'Login');
            return res.status(403).json({ error: 'Email or password is incorrect, or the account is inactive.' });
        }
        await logAction(email, 'User Login', 'User logged in successfully', 'Login');
        // Never send the password hash to the browser
        const { passwordhash, ...user } = row;
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
