const express = require('express');
const { logAction, pool } = require('../db');
const { activeRoleFor } = require('../lib/access');

const router = express.Router();

// Standard treatment fees (ProgramFees): State SO / Voluntary SO per phase, and BIP. A client's TreatmentFee is set from
// these when they're added or change phase or program. Mirrors programFeeFor in frontend/src/utils/soPhases.ts.
const STATE_FEE_PROGRAMS = ['State SO', 'Voluntary SO'];
// Current clients only: discharged clients keep the fee they left with
const CURRENT_STATUSES = ['Active', 'Inactive'];

router.get('/api/program-fees', async (req, res) => {
    try {
        const result = await pool.query('SELECT FeeKey, Label, Fee, UpdatedBy, UpdatedOn FROM ProgramFees ORDER BY SortOrder, FeeKey');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Business Administrators only. applyToClients: current clients of that phase (or BIP) still on the old price move to
// the new one; clients with a different (custom) fee are left alone. Each moved client gets a change log entry.
router.put('/api/program-fees/:key', async (req, res) => {
    const { fee, applyToClients, user } = req.body;
    const newFee = Math.round(Number(fee) * 100) / 100;
    if (fee === '' || fee === null || fee === undefined || !Number.isFinite(newFee) || newFee < 0) {
        return res.status(400).json({ error: 'Enter a price of $0.00 or more.' });
    }
    const db = await pool.connect();
    try {
        if (await activeRoleFor(user) !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can change prices.' });
        }
        await db.query('BEGIN');
        const beforeRes = await db.query('SELECT * FROM ProgramFees WHERE FeeKey = $1 FOR UPDATE', [req.params.key]);
        const before = beforeRes.rows[0];
        if (!before) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Price not found.' });
        }
        const oldFee = Number(before.fee);
        const result = await db.query(
            'UPDATE ProgramFees SET Fee = $1, UpdatedBy = $2, UpdatedOn = NOW() WHERE FeeKey = $3 RETURNING FeeKey, Label, Fee, UpdatedBy, UpdatedOn',
            [newFee, user || null, req.params.key]
        );
        let clientsUpdated = 0;
        if (applyToClients && oldFee !== newFee) {
            const isBip = before.feekey === 'BIP';
            const where = isBip
                ? `ProgramType = 'BIP'`
                : `ProgramType = ANY($4::text[]) AND Phase = $5`;
            const params = [oldFee, newFee, CURRENT_STATUSES, ...(isBip ? [] : [STATE_FEE_PROGRAMS, before.feekey])];
            const moved = await db.query(
                `UPDATE Clients SET TreatmentFee = $2
                 WHERE ${where} AND TreatmentFee = $1 AND ProgramStatus = ANY($3::text[]) RETURNING ClientId`,
                params
            );
            clientsUpdated = moved.rows.length;
            if (clientsUpdated > 0) {
                await db.query(
                    `INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details)
                     SELECT UNNEST($1::int[]), $2, 'Treatment Fee', $3, $4, $5`,
                    [moved.rows.map(r => r.clientid), user || null, `$${oldFee.toFixed(2)}`, `$${newFee.toFixed(2)}`,
                        `${before.label} price changed in Admin.`]
                );
            }
        }
        await db.query('COMMIT');
        await logAction(user, 'Price Changed', `${before.label}: $${oldFee.toFixed(2)} to $${newFee.toFixed(2)}`
            + (applyToClients ? `; ${clientsUpdated} client(s) on the old price moved to the new one` : ''));
        res.json({ fee: result.rows[0], clientsUpdated });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

module.exports = router;
