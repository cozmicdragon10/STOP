const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// Optional call-in reasons. Keep in sync with CALL_IN_REASONS in frontend/src/utils/notes.ts (test/sharedRules.test.js checks).
const CALL_IN_REASONS = ['Routine check-in', 'Missed appointment', 'Reschedule request', 'Transportation issue', 'Work conflict', 'Other'];

router.post('/api/callin/client', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const { client, date, comment, createdBy, reason } = req.body;
        if (reason && !CALL_IN_REASONS.includes(reason)) {
            await clientDb.query('ROLLBACK');
            return res.status(400).json({ error: 'Unknown call-in reason.' });
        }
        const reasonText = reason ? ` (Reason: ${reason})` : '';

        const eventRes = await clientDb.query(
            `INSERT INTO EventLog (Client, Type, Comment, CreatedBy, CallInReason) VALUES ($1, 'Call-In', $2, $3, $4) RETURNING EventId`,
            [client, comment, createdBy, reason || null]
        );

        await clientDb.query(
            `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, $2, $3, $4, 'Call-In')`,
            [client, date || new Date(), createdBy, `[Call-In Log]${reasonText}: ${comment}`]
        );

        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, eventId: eventRes.rows[0].eventid });
    } catch (err) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        clientDb.release();
    }
});

router.post('/api/callin/group', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const { group, date, comment, createdBy, reason, callInDate } = req.body;
        if (reason && !CALL_IN_REASONS.includes(reason)) {
            await clientDb.query('ROLLBACK');
            return res.status(400).json({ error: 'Unknown call-in reason.' });
        }
        // Optional date the call-in is for. The entry is still logged today; this only applies when it differs from today.
        const today = new Date().toLocaleDateString('en-CA');
        if (callInDate && !/^\d{4}-\d{2}-\d{2}$/.test(callInDate)) {
            await clientDb.query('ROLLBACK');
            return res.status(400).json({ error: 'Call-in date must be a valid date.' });
        }
        const forDate = callInDate && callInDate !== today ? callInDate : null;
        const reasonText = reason ? ` (Reason: ${reason})` : '';
        const forText = forDate ? ` (For: ${forDate})` : '';

        const clientsRes = await clientDb.query(`SELECT ClientId FROM Clients WHERE GroupId = $1 AND ProgramStatus = 'Active'`, [group]);
        for (let c of clientsRes.rows) {
            await clientDb.query(
                `INSERT INTO EventLog (Client, "Group", Type, Comment, CreatedBy, CallInReason, CallInDate) VALUES ($1, $2, 'Group Call-In', $3, $4, $5, $6)`,
                [c.clientid, group, comment, createdBy, reason || null, forDate]
            );
            await clientDb.query(
                `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, $2, $3, $4, 'Call-In')`,
                [c.clientid, date || new Date(), createdBy, `[Group Call-In Log]${forText}${reasonText}: ${comment}`]
            );
        }

        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, count: clientsRes.rows.length, forDate });
    } catch (err) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        clientDb.release();
    }
});

module.exports = router;
