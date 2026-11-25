const express = require('express');
const { pool, logAction } = require('../db');
const { todayLocal } = require('../lib/dates');
const { logClientChange } = require('../lib/changeLog');
const { canChangeGroup, changeNoteText, changeProblem, offDayCheck, parseSchedule, scheduledDayInWeek, weekStartOf } = require('../lib/groupSchedule');
const { YMD } = require('../lib/sql');

const router = express.Router();
const MONTH = /^\d{4}-\d{2}$/;

// Cancelled or rescheduled group meetings, from My Day. A counselor changes the groups they lead; Office and Business
// Administrators change any. Each change adds a Group Cancel or Group Reschedule case note to every active client in the
// group, and undoing it removes those notes. Who did it (createdBy, removedBy) is stamped by requireSession.

const CHANGE_COLUMNS = `s.ChangeId AS changeid, s.GroupId AS groupid, g.GroupName AS groupname, to_char(s.OriginalDate, 'YYYY-MM-DD') AS originaldate,
    s.Action AS action, to_char(s.NewDate, 'YYYY-MM-DD') AS newdate, to_char(s.NewTime, 'HH24:MI') AS newtime, s.Reason AS reason,
    s.CreatedBy AS createdby, (SELECT COUNT(*)::int FROM Notes n WHERE n.ScheduleChangeId = s.ChangeId) AS notes`;

// Changes whose original or new date falls in the month (YYYY-MM)
router.get('/api/group-schedule-changes', async (req, res) => {
    try {
        const month = String(req.query.month || '');
        if (!MONTH.test(month)) return res.status(400).json({ error: 'A month (YYYY-MM) is required.' });
        const result = await pool.query(
            `SELECT ${CHANGE_COLUMNS} FROM GroupScheduleChanges s JOIN Groups g ON g.GroupId = s.GroupId
             WHERE date_trunc('month', s.OriginalDate) = date_trunc('month', $1::date)
                OR date_trunc('month', s.NewDate) = date_trunc('month', $1::date)
             ORDER BY s.OriginalDate, g.GroupName`,
            [`${month}-01`]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cancel or reschedule one meeting (upcoming, or a past one never opened): { originalDate, action: 'Cancelled' | 'Rescheduled', newDate, newTime, reason }
router.post('/api/groups/:id/schedule-changes', async (req, res) => {
    const db = await pool.connect();
    try {
        const { id } = req.params;
        const { originalDate, action, newDate, newTime, reason, createdBy } = req.body;
        await db.query('BEGIN');
        const group = (await db.query('SELECT GroupId, GroupName, Counselor, Schedule, Active FROM Groups WHERE GroupId = $1 FOR UPDATE', [id])).rows[0];
        if (!group) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Group not found.' }); }
        if (!canChangeGroup(req.user, group.counselor)) {
            await db.query('ROLLBACK');
            return res.status(403).json({ error: 'Counselors can only cancel or reschedule the groups they lead.' });
        }
        if (group.active === false) { await db.query('ROLLBACK'); return res.status(400).json({ error: 'This group is inactive.' }); }
        const problem = changeProblem({ action, originalDate, newDate, newTime, schedule: group.schedule, today: todayLocal() });
        if (problem) { await db.query('ROLLBACK'); return res.status(400).json({ error: problem }); }
        const existing = (await db.query('SELECT Action FROM GroupScheduleChanges WHERE GroupId = $1 AND OriginalDate = $2', [id, originalDate])).rows[0];
        if (existing) {
            await db.query('ROLLBACK');
            return res.status(409).json({ error: `This meeting was already ${existing.action.toLowerCase()}. Undo that first to change it again.` });
        }
        // A meeting that was already checked in (saved or still open) has happened
        const held = (await db.query(
            `SELECT 1 FROM Attendance WHERE "Group" = $1 AND Date = $2 AND Type = 'Group'
             UNION ALL SELECT 1 FROM OpenGroupSessions WHERE GroupId = $1 AND SessionDate = $2 LIMIT 1`, [id, originalDate])).rows.length;
        if (held) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: 'This meeting already has a check-in, so it can no longer be cancelled or rescheduled.' });
        }

        const change = (await db.query(
            `INSERT INTO GroupScheduleChanges (GroupId, OriginalDate, Action, NewDate, NewTime, Reason, CreatedBy)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ChangeId`,
            [id, originalDate, action, action === 'Rescheduled' ? newDate : null, action === 'Rescheduled' ? newTime : null,
                String(reason || '').trim() || null, createdBy || null])).rows[0];
        const category = action === 'Cancelled' ? 'Group Cancel' : 'Group Reschedule';
        const comments = changeNoteText({
            action, groupName: group.groupname, originalDate, scheduleTime: parseSchedule(group.schedule).time, newDate, newTime, reason,
        });
        // Every active client assigned to the group gets the note (system notes need no approval)
        const clients = (await db.query("SELECT ClientId FROM Clients WHERE GroupId = $1 AND ProgramStatus = 'Active'", [id])).rows;
        for (const c of clients) {
            await db.query(
                `INSERT INTO Notes (Client, Date, "User", Comments, Category, ApprovalStatus, ScheduleChangeId) VALUES ($1, NOW(), $2, $3, $4, NULL, $5)`,
                [c.clientid, createdBy, comments, category, change.changeid]);
            await logClientChange(db, { clientId: c.clientid, changedBy: createdBy, changeType: 'Case Note', newValue: 'Added', details: `${category} note: ${comments}` });
        }
        await db.query('COMMIT');
        await logAction(createdBy, action === 'Cancelled' ? 'Group Meeting Cancelled' : 'Group Meeting Rescheduled', `${comments} (${clients.length} client note${clients.length === 1 ? '' : 's'})`);
        res.status(201).json({ success: true, changeId: change.changeid, notes: clients.length });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') return res.status(409).json({ error: 'This meeting was just changed by someone else. Refresh to see it.' });
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Undo a cancel or reschedule (past or upcoming); its case notes are removed with it
router.delete('/api/group-schedule-changes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const removedBy = req.user?.employeeemail || null;
        const row = (await pool.query(
            `SELECT s.ChangeId, s.Action, to_char(s.OriginalDate, 'YYYY-MM-DD') AS originaldate, g.GroupName, g.Counselor
             FROM GroupScheduleChanges s JOIN Groups g ON g.GroupId = s.GroupId WHERE s.ChangeId = $1`, [id])).rows[0];
        if (!row) return res.status(404).json({ error: 'That change was not found. It may already have been undone.' });
        if (!canChangeGroup(req.user, row.counselor)) return res.status(403).json({ error: 'Counselors can only change the groups they lead.' });
        const notes = (await pool.query('SELECT Client FROM Notes WHERE ScheduleChangeId = $1', [id])).rows;
        // Deleting the change removes its notes (ON DELETE CASCADE)
        await pool.query('DELETE FROM GroupScheduleChanges WHERE ChangeId = $1', [id]);
        for (const n of notes) {
            await logClientChange(pool, { clientId: n.client, changedBy: removedBy, changeType: 'Case Note', newValue: 'Removed', details: `${row.groupname} ${row.originaldate}: the ${row.action === 'Cancelled' ? 'cancel' : 'reschedule'} was undone.` });
        }
        await logAction(removedBy, 'Group Meeting Change Undone', `${row.groupname} ${row.originaldate} (${row.action}); ${notes.length} note(s) removed`);
        res.json({ success: true, notesRemoved: notes.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Finishing a group check-in on a day that isn't its regular day (?date=YYYY-MM-DD): whether to offer moving that week's
// meeting there, so each client gets a Group Reschedule note. The check-in screen asks the user in a dialog at Finish
// Check-In; saying yes posts the reschedule above. { offDay: false } on its regular day or for a group with no weekly day.
router.get('/api/groups/:id/off-day', async (req, res) => {
    try {
        const { id } = req.params;
        const date = String(req.query.date || '');
        if (!YMD.test(date)) return res.status(400).json({ error: 'A date (YYYY-MM-DD) is required.' });
        const group = (await pool.query('SELECT GroupName, Counselor, Schedule, Active FROM Groups WHERE GroupId = $1', [id])).rows[0];
        if (!group) return res.status(404).json({ error: 'Group not found.' });
        const scheduledDate = scheduledDayInWeek(group.schedule, date);
        if (!scheduledDate || scheduledDate === date || group.active === false) return res.json({ offDay: false });
        const weekStart = weekStartOf(date);
        const [changed, held, clients] = await Promise.all([
            pool.query('SELECT 1 FROM GroupScheduleChanges WHERE GroupId = $1 AND OriginalDate = $2', [id, scheduledDate]),
            // Any check-in that week, saved or still open. An open check-in on date itself is the sheet being finished
            // (Finish Check-In asks this question), so it doesn't count.
            pool.query(
                `SELECT 1 FROM Attendance WHERE "Group" = $1 AND Type = 'Group' AND Date BETWEEN $2::date AND $2::date + 6
                 UNION ALL SELECT 1 FROM OpenGroupSessions WHERE GroupId = $1 AND SessionDate BETWEEN $2::date AND $2::date + 6
                   AND SessionDate <> $3::date LIMIT 1`,
                [id, weekStart, date]),
            pool.query("SELECT COUNT(*)::int AS n FROM Clients WHERE GroupId = $1 AND ProgramStatus = 'Active'", [id]),
        ]);
        const check = offDayCheck({
            schedule: group.schedule, date, today: todayLocal(), canChange: canChangeGroup(req.user, group.counselor),
            alreadyChanged: changed.rows.length > 0, sessionThisWeek: held.rows.length > 0,
        });
        res.json({ ...check, groupName: group.groupname, scheduleDay: parseSchedule(group.schedule).day, clients: clients.rows[0].n });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
