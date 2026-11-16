const express = require('express');
const { pool } = require('../db');

const router = express.Router();
const MONTH = /^\d{4}-\d{2}$/;

// The signed-in employee's group sessions for one month (YYYY-MM): closed sessions they opened, closed, or were covered
// for (the office can close a session on a counselor's behalf), and open sheets they opened or are covering. Only flags
// are sent back, not other employees' names. Upcoming scheduled groups are worked out on the client from each schedule.
router.get('/api/my-sessions', async (req, res) => {
    try {
        const month = String(req.query.month || '');
        if (!MONTH.test(month)) return res.status(400).json({ error: 'A month (YYYY-MM) is required.' });
        const me = req.user?.employeeemail || '';
        const firstDay = `${month}-01`;
        const closed = await pool.query(
            `SELECT a."Group" AS groupid, g.GroupName AS groupname, to_char(a.Date, 'YYYY-MM-DD') AS sessiondate,
                    a.SessionNumber AS sessionnumber, COUNT(*)::int AS clients,
                    bool_or(LOWER(COALESCE(a.OpenedBy, a.CreatedBy)) = LOWER($1)) AS openedbyme,
                    bool_or(LOWER(a.CreatedBy) = LOWER($1)) AS closedbyme,
                    bool_or(LOWER(a.CoveredBy) = LOWER($1)) AS coveredforme
             FROM Attendance a
             JOIN Groups g ON g.GroupId = a."Group"
             WHERE a.Type = 'Group' AND date_trunc('month', a.Date) = date_trunc('month', $2::date)
             GROUP BY a."Group", g.GroupName, a.Date, a.SessionNumber
             HAVING bool_or(LOWER(COALESCE(a.OpenedBy, a.CreatedBy)) = LOWER($1))
                 OR bool_or(LOWER(a.CreatedBy) = LOWER($1))
                 OR bool_or(LOWER(a.CoveredBy) = LOWER($1))
             ORDER BY a.Date, g.GroupName`,
            [me, firstDay]
        );
        const open = await pool.query(
            `SELECT o.GroupId AS groupid, g.GroupName AS groupname, to_char(o.SessionDate, 'YYYY-MM-DD') AS sessiondate,
                    o.SessionNumber AS sessionnumber,
                    (LOWER(o.CreatedBy) = LOWER($1)) AS openedbyme, (LOWER(o.CoveredBy) = LOWER($1)) AS coveredforme
             FROM OpenGroupSessions o
             JOIN Groups g ON g.GroupId = o.GroupId
             WHERE date_trunc('month', o.SessionDate) = date_trunc('month', $2::date)
               AND (LOWER(o.CreatedBy) = LOWER($1) OR LOWER(o.CoveredBy) = LOWER($1))
             ORDER BY o.SessionDate, g.GroupName`,
            [me, firstDay]
        );
        // Their own assessment times this month from the Assessments calendar: open availability and scheduled clients
        const assessments = await pool.query(
            `SELECT a.AppointmentId AS appointmentid, to_char(a.ApptDate, 'YYYY-MM-DD') AS apptdate, to_char(a.ApptTime, 'HH24:MI') AS appttime,
                    a.Location AS location, a.Status AS status, c.FirstName AS firstname, c.LastName AS lastname
             FROM AssessmentAppointments a LEFT JOIN Clients c ON c.ClientId = a.ClientId
             WHERE LOWER(TRIM(a.Assessor)) = LOWER(TRIM($1)) AND a.Status IN ('Open', 'Scheduled')
               AND date_trunc('month', a.ApptDate) = date_trunc('month', $2::date)
             ORDER BY a.ApptDate, a.ApptTime`,
            [req.user?.displayname || '', firstDay]
        );
        res.json({ closed: closed.rows, open: open.rows, assessments: assessments.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
