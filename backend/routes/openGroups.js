const express = require('express');
const { logAction, pool } = require('../db');
const { OPEN_GROUP_ADMIN_ROLES, openGroupViewer } = require('../lib/access');
const { coveringCounselorFor } = require('../lib/cashResponsibility');

const router = express.Router();

const OPEN_GROUP_COLUMNS = `o.OpenSessionId, o.GroupId, g.GroupName, to_char(o.SessionDate, 'YYYY-MM-DD') AS SessionDate,
    o.SessionNumber, o.Entries, o.CreatedBy, o.CoveredBy, o.UpdatedOn`;

// The covering counselor (picked by the office) can see the check-in too
const canSeeOpenGroup = (viewer, row) => {
    if (!viewer) return false;
    if (OPEN_GROUP_ADMIN_ROLES.includes(viewer.role)) return true;
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    return same(row.createdby, viewer.employeeemail) || same(row.coveredby, viewer.employeeemail)
        || (!!viewer.displayname && same(row.counselor, viewer.displayname));
};

router.get('/api/open-groups', async (req, res) => {
    try {
        const viewer = await openGroupViewer(req.query.user);
        const result = await pool.query(
            `SELECT ${OPEN_GROUP_COLUMNS}, g.Counselor FROM OpenGroupSessions o
             JOIN Groups g ON g.GroupId = o.GroupId
             ORDER BY o.SessionDate DESC, g.GroupName ASC`
        );
        res.json(result.rows.filter(row => canSeeOpenGroup(viewer, row)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Closed group sessions, newest first. Only Business Administrators see all of them; others see the sessions of groups
// they counsel, the ones they opened, and the ones they covered.
router.get('/api/closed-groups', async (req, res) => {
    try {
        const viewer = await openGroupViewer(req.query.user);
        if (!viewer) return res.json([]);
        const isAdmin = viewer.role === 'Business Administrator';
        const result = await pool.query(
            `SELECT a."Group" AS GroupId, g.GroupName, g.Counselor, to_char(a.Date, 'YYYY-MM-DD') AS SessionDate, a.SessionNumber,
                    MIN(COALESCE(a.OpenedBy, a.CreatedBy)) AS OpenedBy, MIN(a.CreatedBy) AS ClosedBy, MAX(a.CreatedOn) AS ClosedOn,
                    json_agg(json_build_object(
                        'client', a.Client, 'name', c.LastName || ', ' || c.FirstName,
                        'groupFee', a.GroupFee, 'accountPaid', a.AccountPaid, 'paymentMethod', a.PaymentMethod
                    ) ORDER BY c.LastName, c.FirstName) AS Entries
             FROM Attendance a
             JOIN Groups g ON g.GroupId = a."Group"
             JOIN Clients c ON c.ClientId = a.Client
             WHERE a.Type = 'Group'
             GROUP BY a."Group", g.GroupName, g.Counselor, a.Date, a.SessionNumber
             HAVING $1::boolean
                 OR ($3 <> '' AND LOWER(TRIM(g.Counselor)) = LOWER(TRIM($3)))
                 OR bool_or(LOWER(COALESCE(a.OpenedBy, a.CreatedBy)) = LOWER($2))
                 OR bool_or(LOWER(a.CoveredBy) = LOWER($2))
             ORDER BY a.Date DESC, MAX(a.CreatedOn) DESC NULLS LAST
             LIMIT 100`,
            [isAdmin, viewer.employeeemail, viewer.displayname || '']
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Saves the sheet for a group and session date, replacing any earlier save of the same session.
// The employee who first opened it stays as CreatedBy. Someone who can't see an existing open check-in can't overwrite it.
// coveredBy (Office Admins and Business Administrators only) names the counselor covering the session.
router.put('/api/open-groups', async (req, res) => {
    try {
        const { group, date, sessionNumber, entries, createdBy, coveredBy } = req.body;
        if (!group || !date || !Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'A group, session date, and at least one checked-in client are required.' });
        }
        const sessionNum = Number(sessionNumber) > 0 ? Math.floor(Number(sessionNumber)) : 1;
        const existing = await pool.query(
            `SELECT o.CreatedBy, o.CoveredBy, g.Counselor FROM OpenGroupSessions o JOIN Groups g ON g.GroupId = o.GroupId
             WHERE o.GroupId = $1 AND o.SessionDate = $2 AND o.SessionNumber = $3`,
            [group, date, sessionNum]
        );
        if (existing.rows[0] && !canSeeOpenGroup(await openGroupViewer(createdBy), existing.rows[0])) {
            return res.status(403).json({ error: 'This group already has an open check-in for this session, started by another counselor. Only that counselor, the group\'s counselor, or an administrator can change it.' });
        }
        const covering = await coveringCounselorFor(createdBy, coveredBy, existing.rows[0]?.coveredby ?? null);
        const saved = await pool.query(
            `INSERT INTO OpenGroupSessions (GroupId, SessionDate, SessionNumber, Entries, CreatedBy, CoveredBy, UpdatedOn)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (GroupId, SessionDate, SessionNumber)
             DO UPDATE SET Entries = EXCLUDED.Entries, CoveredBy = EXCLUDED.CoveredBy, UpdatedOn = NOW()
             RETURNING OpenSessionId`,
            [group, date, sessionNum, JSON.stringify(entries), createdBy, covering]
        );
        const result = await pool.query(
            `SELECT ${OPEN_GROUP_COLUMNS} FROM OpenGroupSessions o
             JOIN Groups g ON g.GroupId = o.GroupId WHERE o.OpenSessionId = $1`,
            [saved.rows[0].opensessionid]
        );
        await logAction(createdBy, 'Group Check-In Saved', `Saved open check-in for Group ID ${group} on ${date} (${entries.length} client(s))`);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

router.delete('/api/open-groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { removedBy } = req.body || {};
        const existing = await pool.query(
            'SELECT o.CreatedBy, g.Counselor FROM OpenGroupSessions o JOIN Groups g ON g.GroupId = o.GroupId WHERE o.OpenSessionId = $1',
            [id]
        );
        if (existing.rows[0] && !canSeeOpenGroup(await openGroupViewer(removedBy), existing.rows[0])) {
            return res.status(403).json({ error: 'Only the counselor who opened this check-in, the group\'s counselor, or an administrator can discard it.' });
        }
        await pool.query('DELETE FROM OpenGroupSessions WHERE OpenSessionId = $1', [id]);
        if (removedBy) {
            await logAction(removedBy, 'Group Check-In Discarded', `Discarded open check-in ID ${id}`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
