const express = require('express');
const { pool } = require('../db');
const { recordAttendance } = require('../lib/attendance');
const { coveringCounselorFor } = require('../lib/cashResponsibility');

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

// Sessions of a group on a date (YYYY-MM-DD), or from `from` through `date` when given, oldest first. Closed sessions list
// the ids of the clients who attended; open ones (saved with Finish Check-In, not yet closed) have no attendance yet and
// are listed so their numbers aren't reused. A client cannot be checked in to the same session twice, but can attend a
// later session that day.
router.get('/api/groups/:groupId/sessions', async (req, res) => {
    try {
        const { groupId } = req.params;
        const { date } = req.query;
        const from = req.query.from || date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(from))) {
            return res.status(400).json({ error: 'A session date (YYYY-MM-DD) is required.' });
        }
        const result = await pool.query(
            `SELECT to_char(Date, 'YYYY-MM-DD') AS Date, SessionNumber, TRUE AS Closed, array_agg(DISTINCT Client) AS Clients
             FROM Attendance WHERE "Group" = $1 AND Date BETWEEN $2 AND $3
             GROUP BY Date, SessionNumber
             UNION ALL
             SELECT to_char(o.SessionDate, 'YYYY-MM-DD'), o.SessionNumber, FALSE, ARRAY[]::int[]
             FROM OpenGroupSessions o
             WHERE o.GroupId = $1 AND o.SessionDate BETWEEN $2 AND $3
               AND NOT EXISTS (SELECT 1 FROM Attendance a WHERE a."Group" = $1 AND a.Date = o.SessionDate AND a.SessionNumber = o.SessionNumber)
             ORDER BY 1, 2`,
            [groupId, from, date]
        );
        res.json(result.rows.map(r => ({ date: r.date, sessionNumber: r.sessionnumber, closed: r.closed, clients: r.clients })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Group check-in: every client on the session sheet is saved in one transaction
router.post('/api/attendance/batch', async (req, res) => {
    const { group, date, sessionNumber, type, createdBy, coveredBy, entries } = req.body;
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
        // Adding clients to a session that was closed before this week (Sunday on) is for Business Administrators only:
        // missed check-ins from the Closed Groups panel. Within the week anyone checking the group in can add to it.
        const closedEarlierRes = await clientDb.query(
            `SELECT 1 FROM Attendance WHERE "Group" = $1 AND Date = $2 AND SessionNumber = $3
               AND $2::date < date_trunc('week', CURRENT_DATE + 1)::date - 1 LIMIT 1`,
            [group, date, sessionNum]
        );
        if (closedEarlierRes.rows.length > 0 && req.user?.role !== 'Business Administrator') {
            throw Object.assign(new Error('This group session was closed before this week. Only a Business Administrator can add missed check-ins to it.'), { status: 403 });
        }
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
        // The covering counselor (lib/cashResponsibility.js) is kept too: the closer's pick if they are an
        // administrator, otherwise whatever was saved with the open sheet.
        const openedRes = await clientDb.query(
            'DELETE FROM OpenGroupSessions WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3 RETURNING CreatedBy, CoveredBy',
            [group, date, sessionNum]
        );
        const openedBy = openedRes.rows[0]?.createdby || createdBy;
        const covering = await coveringCounselorFor(createdBy, coveredBy, openedRes.rows[0]?.coveredby ?? null);
        await clientDb.query(
            'UPDATE Attendance SET OpenedBy = $1, CoveredBy = $2 WHERE AttendanceId = ANY($3::int[])',
            [openedBy, covering, results.map(r => r.attendanceId)]
        );
        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, count: results.length, results, polyVouchersAwarded: results.filter(r => r.polyVoucherAwarded).length });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(error.status || 500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

module.exports = router;
