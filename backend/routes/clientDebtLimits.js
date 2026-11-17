// Max Debt Override: through an expiration date the client may owe up to an amount and still attend groups and
// individual sessions and begin assessments (lib/attendance.js, lib/assessmentWork.js). Business Administrators (and DEV,
// who signs in as one) set and remove it; everyone else can see it.
const express = require('express');
const { logAction, pool } = require('../db');
const { requireRole } = require('../lib/auth');
const { logClientChange } = require('../lib/changeLog');
const { debtLimitProblem } = require('../lib/debtLimits');
const { YMD } = require('../lib/sql');

const router = express.Router();

const ACTIVE = `SELECT DebtLimitId, MaxOwed, to_char(ExpirationDate, 'YYYY-MM-DD') AS ExpirationDate,
                       to_char(ExpirationDate, 'MM/DD/YYYY') AS ExpiresText, CreatedBy, CreatedOn
                FROM ClientDebtLimits WHERE ClientId = $1 AND ExpirationDate >= CURRENT_DATE
                ORDER BY CreatedOn DESC, DebtLimitId DESC LIMIT 1`;
const describe = (row) => `owe up to $${Number(row.maxowed).toFixed(2)} through ${row.expirestext}`;

router.get('/api/clients/:id/debt-limit', async (req, res) => {
    try {
        res.json({ limit: (await pool.query(ACTIVE, [req.params.id])).rows[0] || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sets (or replaces) the override
router.post('/api/clients/:id/debt-limit', requireRole('Business Administrator'), async (req, res) => {
    const db = await pool.connect();
    try {
        const { id } = req.params;
        const { maxOwed, expirationDate } = req.body;
        const today = (await db.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
        const problem = debtLimitProblem({ maxOwed, expirationDate, today, validDate: YMD.test(String(expirationDate || '')) });
        if (problem) return res.status(400).json({ error: problem });
        await db.query('BEGIN');
        const client = (await db.query('SELECT ClientId FROM Clients WHERE ClientId = $1 FOR UPDATE', [id])).rows[0];
        if (!client) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Client not found.' });
        }
        const prior = (await db.query(ACTIVE, [id])).rows[0];
        await db.query('DELETE FROM ClientDebtLimits WHERE ClientId = $1', [id]);
        await db.query('INSERT INTO ClientDebtLimits (ClientId, MaxOwed, ExpirationDate, CreatedBy) VALUES ($1, $2, $3, $4)',
            [id, Math.round(Number(maxOwed) * 100) / 100, expirationDate, req.user.employeeemail]);
        const limit = (await db.query(ACTIVE, [id])).rows[0];
        await logClientChange(db, {
            clientId: id, changedBy: req.user.employeeemail, changeType: 'Max Debt Override',
            oldValue: prior ? describe(prior) : null, newValue: describe(limit),
            details: prior ? 'Max debt override changed.' : 'Max debt override activated.', expiresOn: expirationDate,
        });
        await db.query('COMMIT');
        await logAction(req.user.employeeemail, 'Max Debt Override Set', `Client ID ${id}: ${describe(limit)}`);
        res.status(201).json({ limit });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

router.delete('/api/clients/:id/debt-limit', requireRole('Business Administrator'), async (req, res) => {
    try {
        const { id } = req.params;
        const active = (await pool.query(ACTIVE, [id])).rows[0];
        await pool.query('DELETE FROM ClientDebtLimits WHERE ClientId = $1', [id]);
        if (active) {
            await logClientChange(pool, {
                clientId: id, changedBy: req.user.employeeemail, changeType: 'Max Debt Override',
                oldValue: describe(active), newValue: 'Removed', details: 'Max debt override removed before it expired.',
            });
            await logAction(req.user.employeeemail, 'Max Debt Override Removed', `Client ID ${id}: was ${describe(active)}`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
