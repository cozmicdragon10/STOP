const express = require('express');
const { logAction, pool } = require('../db');
const { activeRoleFor } = require('../lib/access');

const router = express.Router();

// Federal billing unit codes and their prices (Admin > Billing Federal Units). programs: the client programs that
// track the code's units on their account.
router.get('/api/federal-units', async (req, res) => {
    try {
        const result = await pool.query('SELECT Code, Label, Programs, Price, UpdatedBy, UpdatedOn FROM FederalUnitCodes ORDER BY SortOrder, Code');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Business Administrators only. A blank price clears it.
router.put('/api/federal-units/:code', async (req, res) => {
    try {
        const { price, user } = req.body;
        if (await activeRoleFor(user) !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can change prices.' });
        }
        const blank = price === '' || price === null || price === undefined;
        const value = blank ? null : Math.round(Number(price) * 100) / 100;
        if (!blank && !(Number.isFinite(value) && value >= 0)) {
            return res.status(400).json({ error: 'Enter a price of $0.00 or more, or leave it blank.' });
        }
        const before = (await pool.query('SELECT Code, Label, Price FROM FederalUnitCodes WHERE Code = $1', [req.params.code])).rows[0];
        if (!before) return res.status(404).json({ error: 'Billing code not found.' });
        const result = await pool.query(
            `UPDATE FederalUnitCodes SET Price = $1, UpdatedBy = $2, UpdatedOn = NOW() WHERE Code = $3
             RETURNING Code, Label, Programs, Price, UpdatedBy, UpdatedOn`,
            [value, user || null, req.params.code]
        );
        const show = (p) => (p === null || p === undefined ? 'blank' : `$${Number(p).toFixed(2)}`);
        await logAction(user, 'Federal Unit Price Changed', `${before.code} ${before.label}: ${show(before.price)} to ${show(value)}`);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
