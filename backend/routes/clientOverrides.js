const express = require('express');
const { logAction, pool } = require('../db');
const { activeRoleFor } = require('../lib/access');
const { logClientChange } = require('../lib/changeLog');
const { activePolyFeeOverride, changePolyFeePaid, endPolyFeeOverride, polyOverrideText, voucherChangeText } = require('../lib/poly');

const router = express.Router();

router.get('/api/clients/:id/fee-override', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT * FROM TemporaryFeeOverrides
             WHERE ClientId = $1 AND ExpirationDate >= CURRENT_DATE
             ORDER BY CreatedOn DESC LIMIT 1`,
            [id]
        );
        res.json({ override: result.rows[0] || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/clients/:id/fee-override', async (req, res) => {
    try {
        const { id } = req.params;
        const { reducedFee, expirationDate, createdBy } = req.body;

        if (reducedFee === undefined || reducedFee === null || reducedFee === '' || Number(reducedFee) < 0 || !expirationDate) {
            return res.status(400).json({ error: 'A reduced fee (0 or more) and an expiration date are required.' });
        }

        // An override still in effect is being changed; otherwise this activates a new one
        const priorRes = await pool.query(
            `SELECT ReducedFee, to_char(ExpirationDate, 'MM/DD/YYYY') AS Expires FROM TemporaryFeeOverrides
             WHERE ClientId = $1 AND ExpirationDate >= CURRENT_DATE ORDER BY CreatedOn DESC LIMIT 1`,
            [id]
        );
        const prior = priorRes.rows[0];

        await pool.query('DELETE FROM TemporaryFeeOverrides WHERE ClientId = $1', [id]);
        const result = await pool.query(
            `INSERT INTO TemporaryFeeOverrides (ClientId, ReducedFee, ExpirationDate, CreatedBy)
             VALUES ($1, $2, $3, $4) RETURNING *, to_char(ExpirationDate, 'MM/DD/YYYY') AS ExpiresText`,
            [id, Number(reducedFee), expirationDate, createdBy]
        );

        await logAction(createdBy, 'Fee Override Set', `Set temporary fee override for Client ID ${id}: $${reducedFee} until ${expirationDate}`);
        await logClientChange(pool, {
            clientId: id, changedBy: createdBy, changeType: 'Fee Override',
            oldValue: prior ? `$${Number(prior.reducedfee).toFixed(2)} through ${prior.expires}` : null,
            newValue: `$${Number(reducedFee).toFixed(2)} through ${result.rows[0].expirestext}`,
            details: prior ? 'Temporary fee override changed.' : 'Temporary fee override activated.',
            expiresOn: expirationDate,
        });
        res.status(201).json({ override: result.rows[0] });
    } catch (err) {
        console.error('Error setting fee override:', err);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/api/clients/:id/fee-override', async (req, res) => {
    try {
        const { id } = req.params;
        const { removedBy } = req.body;

        const removed = await pool.query(
            `DELETE FROM TemporaryFeeOverrides WHERE ClientId = $1
             RETURNING ReducedFee, ExpirationDate >= CURRENT_DATE AS StillActive, to_char(ExpirationDate, 'MM/DD/YYYY') AS Expires`,
            [id]
        );
        const active = removed.rows.find(r => r.stillactive);
        if (active) {
            await logClientChange(pool, {
                clientId: id, changedBy: removedBy, changeType: 'Fee Override',
                oldValue: `$${Number(active.reducedfee).toFixed(2)} through ${active.expires}`, newValue: 'Removed',
                details: 'Temporary fee override removed before it expired.',
            });
        }

        if (removedBy) {
            await logAction(removedBy, 'Fee Override Removed', `Removed temporary fee override for Client ID ${id}`);
        }

        res.json({ success: true, message: 'Fee override removed successfully.' });
    } catch (err) {
        console.error('Error removing fee override:', err);
        res.status(500).json({ error: err.message });
    }
});

const POLY_OVERRIDE_MAX_FILLS = 20;

router.get('/api/clients/:id/poly-fee-override', async (req, res) => {
    try {
        res.json({ override: await activePolyFeeOverride(pool, req.params.id) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sets or changes the override (Business Administrators only). Changing one keeps its fills used and regular fee.
router.post('/api/clients/:id/poly-fee-override', async (req, res) => {
    const { id } = req.params;
    const { reducedFee, fills, user } = req.body || {};
    if (await activeRoleFor(user) !== 'Business Administrator') {
        return res.status(403).json({ error: 'Only Business Administrators can set a poly fee override.' });
    }
    const fee = Math.round(Number(reducedFee) * 100) / 100;
    const fillsAllowed = Number(fills);
    if (reducedFee === '' || reducedFee === null || reducedFee === undefined || !Number.isFinite(fee) || fee < 0) {
        return res.status(400).json({ error: 'Enter a reduced poly fee of $0.00 or more.' });
    }
    if (!Number.isInteger(fillsAllowed) || fillsAllowed < 1 || fillsAllowed > POLY_OVERRIDE_MAX_FILLS) {
        return res.status(400).json({ error: `Number of fills must be a whole number from 1 to ${POLY_OVERRIDE_MAX_FILLS}.` });
    }

    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const clientRes = await db.query('SELECT PolyFee FROM Clients WHERE ClientId = $1 FOR UPDATE', [id]);
        if (clientRes.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Client not found.' });
        }
        const prior = await activePolyFeeOverride(db, id);
        if (prior && fillsAllowed < Number(prior.fillsused)) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: `This override has already been filled ${prior.fillsused} time(s); allow at least that many.` });
        }
        let override;
        if (prior) {
            override = (await db.query(
                'UPDATE PolyFeeOverrides SET ReducedFee = $1, FillsAllowed = $2 WHERE OverrideId = $3 RETURNING *',
                [fee, fillsAllowed, prior.overrideid]
            )).rows[0];
        } else {
            override = (await db.query(
                `INSERT INTO PolyFeeOverrides (ClientId, ReducedFee, RegularFee, FillsAllowed, CreatedBy)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [id, fee, Number(clientRes.rows[0].polyfee || 0), fillsAllowed, user]
            )).rows[0];
        }
        // Lowering the fee can make what's already paid a full payment, which fills the vouchers and counts as a fill
        const poly = await changePolyFeePaid(db, id, 0, { fee });
        override = await activePolyFeeOverride(db, id);

        await logClientChange(db, {
            clientId: id, changedBy: user, changeType: 'Poly Fee Override',
            oldValue: prior ? polyOverrideText(prior) : `$${Number(clientRes.rows[0].polyfee || 0).toFixed(2)} (regular)`,
            newValue: polyOverrideText(override),
            details: (prior ? 'Temporary poly fee override changed.' : `Temporary poly fee override activated; regular poly fee $${Number(override.regularfee).toFixed(2)} returns after the last fill is used.`)
                + voucherChangeText(poly),
        });
        await db.query('COMMIT');
        await logAction(user, 'Poly Fee Override Set', `Client ID ${id}: poly fee ${polyOverrideText(override)} (regular $${Number(override.regularfee).toFixed(2)}).${voucherChangeText(poly)}`);
        res.status(201).json({ override, ...poly });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Removes the override early and puts the regular poly fee back (Business Administrators only)
router.delete('/api/clients/:id/poly-fee-override', async (req, res) => {
    const { id } = req.params;
    const { user } = req.body || {};
    if (await activeRoleFor(user) !== 'Business Administrator') {
        return res.status(403).json({ error: 'Only Business Administrators can remove a poly fee override.' });
    }
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        await db.query('SELECT 1 FROM Clients WHERE ClientId = $1 FOR UPDATE', [id]);
        const result = await endPolyFeeOverride(db, id);
        if (!result) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'No poly fee override is active.' });
        }
        const { override, poly } = result;
        await logClientChange(db, {
            clientId: id, changedBy: user, changeType: 'Poly Fee Override',
            oldValue: polyOverrideText(override), newValue: 'Removed',
            details: `Removed after ${override.fillsused} of ${override.fillsallowed} fill(s); poly fee back to $${Number(override.regularfee).toFixed(2)}.${voucherChangeText(poly)}`,
        });
        await db.query('COMMIT');
        await logAction(user, 'Poly Fee Override Removed', `Client ID ${id}: removed poly fee override ${polyOverrideText(override)}.${voucherChangeText(poly)}`);
        res.json({ success: true, ...poly });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

module.exports = router;
