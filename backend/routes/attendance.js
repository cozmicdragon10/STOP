const express = require('express');
const { pool } = require('../db');
const { recordAttendance } = require('../lib/attendance');

const router = express.Router();

// SO group program types, as stored on Groups
const SO_GROUP_TYPES = ['SO', 'FED SO'];

router.post('/api/attendance', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const { attendanceId, newBalance } = await recordAttendance(clientDb, req.body);
        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, attendanceId, newBalance });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

// Sessions of a group on a date (YYYY-MM-DD), oldest first. Closed sessions list the ids of the clients who attended;
// open ones (saved with Finish Check-In, not yet closed) have no attendance yet and are listed so their numbers aren't reused.
// A client cannot be checked in to the same session twice, but can attend a later session that day.
router.get('/api/groups/:groupId/sessions', async (req, res) => {
    try {
        const { groupId } = req.params;
        const { date } = req.query;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
            return res.status(400).json({ error: 'A session date (YYYY-MM-DD) is required.' });
        }
        const result = await pool.query(
            `SELECT SessionNumber, TRUE AS Closed, array_agg(DISTINCT Client) AS Clients
             FROM Attendance WHERE "Group" = $1 AND Date = $2
             GROUP BY SessionNumber
             UNION ALL
             SELECT o.SessionNumber, FALSE, ARRAY[]::int[]
             FROM OpenGroupSessions o
             WHERE o.GroupId = $1 AND o.SessionDate = $2
               AND NOT EXISTS (SELECT 1 FROM Attendance a WHERE a."Group" = $1 AND a.Date = $2 AND a.SessionNumber = o.SessionNumber)
             ORDER BY SessionNumber`,
            [groupId, date]
        );
        res.json(result.rows.map(r => ({ sessionNumber: r.sessionnumber, closed: r.closed, clients: r.clients })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Group check-in: every client on the session sheet is saved in one transaction
router.post('/api/attendance/batch', async (req, res) => {
    const { group, date, sessionNumber, type, createdBy, entries } = req.body;
    const sessionNum = Number(sessionNumber) > 0 ? Math.floor(Number(sessionNumber)) : 1;

    if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'No clients were provided for check-in.' });
    }

    const clientIds = entries.map(e => Number(e.client));
    if (new Set(clientIds).size !== clientIds.length) {
        return res.status(400).json({ error: 'The same client cannot be checked in twice in one session.' });
    }

    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const groupRes = await clientDb.query('SELECT ProgramType FROM Groups WHERE GroupId = $1', [group]);
        const isSoGroup = SO_GROUP_TYPES.includes(String(groupRes.rows[0]?.programtype || '').trim().toUpperCase());
        const results = [];
        for (const entry of entries) {
            const { attendanceId, newBalance, polyVoucherAwarded } = await recordAttendance(clientDb, {
                ...entry, group, date, sessionNumber: sessionNum, type: type || 'Group', createdBy, paid: true, awardNdiVoucher: isSoGroup
            });
            results.push({ client: entry.client, attendanceId, newBalance, polyVoucherAwarded });
        }
        // Closing the group clears its saved open sheet for this session. Who opened it is kept on the attendance rows
        // so the closed group stays visible to them; a group closed without being opened first was opened by the closer.
        const openedRes = await clientDb.query(
            'DELETE FROM OpenGroupSessions WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3 RETURNING CreatedBy',
            [group, date, sessionNum]
        );
        const openedBy = openedRes.rows[0]?.createdby || createdBy;
        await clientDb.query(
            'UPDATE Attendance SET OpenedBy = $1 WHERE AttendanceId = ANY($2::int[])',
            [openedBy, results.map(r => r.attendanceId)]
        );
        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, count: results.length, results, polyVouchersAwarded: results.filter(r => r.polyVoucherAwarded).length });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

module.exports = router;
