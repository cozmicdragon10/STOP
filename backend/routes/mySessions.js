const express = require('express');
const { pool } = require('../db');

const router = express.Router();
const MONTH = /^\d{4}-\d{2}$/;

// Office roles (and DEV, read as Business Administrator) can see any counselor's calendar on the Calendars tab
const CALENDAR_VIEWER_ROLES = ['Business Administrator', 'Office Admin'];

// The signed-in employee's group sessions for one month (YYYY-MM): closed sessions they opened, closed, or were covered
// for (the office can close a session on a counselor's behalf) or of a group they lead that no other counselor ran
// (sessions imported from the old system have no one recorded), and open sheets they opened or are covering. Only flags
// are sent back, not other employees' names. Upcoming scheduled groups are worked out on the client from each schedule.
// ?counselor=<display name> gives that counselor's instead (Calendars tab; office roles only).
router.get('/api/my-sessions', async (req, res) => {
    try {
        const month = String(req.query.month || '');
        if (!MONTH.test(month)) return res.status(400).json({ error: 'A month (YYYY-MM) is required.' });
        let me = req.user?.employeeemail || '';
        let myName = req.user?.displayname || '';
        const counselor = String(req.query.counselor || '').trim();
        if (counselor) {
            if (!CALENDAR_VIEWER_ROLES.includes(req.user?.role)) {
                return res.status(403).json({ error: 'Only Business Administrators and Office Admins can view other counselors\' calendars.' });
            }
            const employee = (await pool.query(
                "SELECT EmployeeEmail, DisplayName FROM EmployeeRoles WHERE LOWER(TRIM(DisplayName)) = LOWER($1) AND Role = 'Counselor' ORDER BY Active DESC LIMIT 1",
                [counselor])).rows[0];
            if (!employee) return res.status(404).json({ error: `No counselor named ${counselor}.` });
            me = employee.employeeemail;
            myName = employee.displayname;
        }
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
             GROUP BY a."Group", g.GroupName, g.Counselor, a.Date, a.SessionNumber
             HAVING bool_or(LOWER(COALESCE(a.OpenedBy, a.CreatedBy)) = LOWER($1))
                 OR bool_or(LOWER(a.CreatedBy) = LOWER($1))
                 OR bool_or(LOWER(a.CoveredBy) = LOWER($1))
                 -- Their own group held without another counselor: sessions imported from the old system (no one
                 -- recorded) and ones the office ran or closed for them. A session another counselor ran shows on theirs.
                 OR (LOWER(TRIM(g.Counselor)) = LOWER(TRIM($3)) AND NOT bool_or(EXISTS (
                        SELECT 1 FROM EmployeeRoles e WHERE e.Role = 'Counselor' AND LOWER(e.EmployeeEmail) <> LOWER($1)
                          AND LOWER(e.EmployeeEmail) IN (LOWER(COALESCE(a.OpenedBy, a.CreatedBy, '')), LOWER(COALESCE(a.CoveredBy, ''))))))
             ORDER BY a.Date, g.GroupName`,
            [me, firstDay, myName]
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
                    a.Location AS location, a.Status AS status, a.Assessor AS assessor, a.Notes AS notes,
                    c.FirstName AS firstname, c.LastName AS lastname
             FROM AssessmentAppointments a LEFT JOIN Clients c ON c.ClientId = a.ClientId
             WHERE LOWER(TRIM(a.Assessor)) = LOWER(TRIM($1)) AND a.Status IN ('Open', 'Scheduled')
               AND date_trunc('month', a.ApptDate) = date_trunc('month', $2::date)
             ORDER BY a.ApptDate, a.ApptTime`,
            [myName, firstDay]
        );
        res.json({ closed: closed.rows, open: open.rows, assessments: assessments.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
