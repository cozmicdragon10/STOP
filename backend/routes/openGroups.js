const express = require('express');
const { logAction, pool } = require('../db');
const { OPEN_GROUP_ADMIN_ROLES, openGroupViewer } = require('../lib/access');
const { coveringCounselorFor } = require('../lib/cashResponsibility');
const { cashDiscardProblem, keepPrintedMarks, printedEntries, printedReceiptProblem } = require('../lib/printedReceipts');
const { clientsWithoutUnits, drugTestedOn, noUnitsMessage } = require('../lib/federalUnits');
const { addAttendanceNote, bipWeekAt, noteAuthor, noteBody, replaceNoteBody } = require('../lib/attendanceNotes');
const { logClientChange } = require('../lib/changeLog');
const { paymentMethodProblem } = require('../lib/paymentMethods');

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
// they counsel, the ones they opened, and the ones they covered. from / to (YYYY-MM-DD, optional) limit the session dates;
// at most CLOSED_GROUPS_MAX come back.
const CLOSED_GROUPS_MAX = 500;
const ymdOrNull = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null);
router.get('/api/closed-groups', async (req, res) => {
    try {
        const viewer = await openGroupViewer(req.query.user);
        if (!viewer) return res.json([]);
        const isAdmin = viewer.role === 'Business Administrator';
        const from = ymdOrNull(req.query.from);
        const to = ymdOrNull(req.query.to);
        const result = await pool.query(
            `SELECT a."Group" AS GroupId, g.GroupName, g.Counselor, to_char(a.Date, 'YYYY-MM-DD') AS SessionDate, a.SessionNumber,
                    MIN(COALESCE(a.OpenedBy, a.CreatedBy)) AS OpenedBy, MIN(a.CreatedBy) AS ClosedBy, MAX(a.CreatedOn) AS ClosedOn,
                    json_agg(json_build_object(
                        'client', a.Client, 'name', c.LastName || ', ' || c.FirstName,
                        'groupFee', a.GroupFee, 'accountPaid', a.AccountPaid, 'paymentMethod', a.PaymentMethod,
                        'paymentSubtype', a.PaymentSubtype, 'paymentReference', a.PaymentReference,
                        'attendanceId', a.AttendanceId, 'programType', c.ProgramType, 'note', n.Comments
                    ) ORDER BY c.LastName, c.FirstName) AS Entries
             FROM Attendance a
             JOIN Groups g ON g.GroupId = a."Group"
             JOIN Clients c ON c.ClientId = a.Client
             -- The Therapist note made from this attendance's comment (lib/attendanceNotes.js), if any
             LEFT JOIN LATERAL (
                 SELECT Comments FROM Notes WHERE AttendanceId = a.AttendanceId ORDER BY NoteId DESC LIMIT 1
             ) n ON TRUE
             WHERE a.Type = 'Group'
               AND ($4::date IS NULL OR a.Date >= $4::date) AND ($5::date IS NULL OR a.Date <= $5::date)
             GROUP BY a."Group", g.GroupName, g.Counselor, a.Date, a.SessionNumber
             HAVING $1::boolean
                 OR ($3 <> '' AND LOWER(TRIM(g.Counselor)) = LOWER(TRIM($3)))
                 OR bool_or(LOWER(COALESCE(a.OpenedBy, a.CreatedBy)) = LOWER($2))
                 OR bool_or(LOWER(a.CoveredBy) = LOWER($2))
             ORDER BY a.Date DESC, MAX(a.CreatedOn) DESC NULLS LAST
             LIMIT ${CLOSED_GROUPS_MAX}`,
            [isAdmin, viewer.employeeemail, viewer.displayname || '', from, to]
        );
        // Each client's note is shown without its heading (the BIP week or attendance number, group, and date)
        res.json(result.rows.map(row => ({
            ...row,
            entries: row.entries.map(e => ({ ...e, note: e.note === null ? null : noteBody(e.note) })),
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Attendance Notes on a closed group: adds, changes, or removes the Therapist note made from each client's
// attendance comment (lib/attendanceNotes.js). Allowed to anyone who can see the closed group (as above). Each change
// sends the note's text as it was shown (original); if someone changed it since, nothing is saved (409).
// notes: [{ attendanceId, text, original }] where original is null when the client had no note.
router.put('/api/closed-groups/notes', async (req, res) => {
    const { group, date, sessionNumber, notes } = req.body || {};
    const sessionNum = Number(sessionNumber) > 0 ? Math.floor(Number(sessionNumber)) : 1;
    if (!Array.isArray(notes) || notes.length === 0) return res.status(400).json({ error: 'No notes were changed.' });
    const user = req.user?.employeeemail;
    const db = await pool.connect();
    try {
        const viewer = await openGroupViewer(user);
        if (!viewer) return res.status(403).json({ error: 'Only an active employee can update attendance notes.' });
        await db.query('BEGIN');
        const rowsRes = await db.query(
            `SELECT a.AttendanceId, a.Client, COALESCE(a.OpenedBy, a.CreatedBy) AS OpenedBy, a.CoveredBy,
                    g.GroupName, g.Counselor, c.LastName || ', ' || c.FirstName AS Name
             FROM Attendance a JOIN Groups g ON g.GroupId = a."Group" JOIN Clients c ON c.ClientId = a.Client
             WHERE a."Group" = $1 AND a.Date = $2::date AND a.SessionNumber = $3 AND a.Type = 'Group'`,
            [group, date, sessionNum]
        );
        const rows = rowsRes.rows;
        if (rows.length === 0) throw Object.assign(new Error('That closed group session was not found.'), { status: 404 });
        const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
        const canSee = viewer.role === 'Business Administrator'
            || (!!viewer.displayname && same(rows[0].counselor, viewer.displayname))
            || rows.some(r => same(r.openedby, viewer.employeeemail) || same(r.coveredby, viewer.employeeemail));
        if (!canSee) throw Object.assign(new Error('You can only update notes for closed groups you can see.'), { status: 403 });

        const byId = new Map(rows.map(r => [r.attendanceid, r]));
        const coveredBy = rows.find(r => r.coveredby)?.coveredby || null;
        let author = null;
        const done = { added: 0, updated: 0, removed: 0 };
        for (const item of notes) {
            const row = byId.get(Number(item.attendanceId));
            if (!row) throw Object.assign(new Error('A client on this update is not in that group session.'), { status: 400 });
            const text = String(item.text ?? '').trim();
            const original = item.original === null || item.original === undefined ? null : String(item.original).trim();
            const existing = (await db.query(
                'SELECT * FROM Notes WHERE AttendanceId = $1 ORDER BY NoteId DESC LIMIT 1 FOR UPDATE', [row.attendanceid]
            )).rows[0];
            const current = existing ? noteBody(existing.comments).trim() : null;
            if (current !== original) {
                throw Object.assign(new Error(`Not saved: ${row.name}'s note was changed on another screen while you were editing. `
                    + 'Close this window and open it again to see the latest notes.'), { status: 409 });
            }
            if (text === (current ?? '')) continue;
            if (existing && !text) {
                await db.query('DELETE FROM Notes WHERE NoteId = $1', [existing.noteid]);
                await logClientChange(db, {
                    clientId: row.client, changedBy: user, changeType: 'Case Note', newValue: 'Deleted',
                    details: `Therapist note from group attendance removed: ${existing.comments}`,
                });
                done.removed++;
            } else if (existing) {
                const comments = replaceNoteBody(existing.comments, text);
                await db.query('UPDATE Notes SET Comments = $1, EditedBy = $2, EditedOn = NOW() WHERE NoteId = $3', [comments, user, existing.noteid]);
                await logClientChange(db, {
                    clientId: row.client, changedBy: user, changeType: 'Case Note', newValue: 'Edited',
                    details: `Therapist note from group attendance. Was: ${existing.comments} Now: ${comments}`,
                });
                done.updated++;
            } else {
                author = author || await noteAuthor(db, { coveredBy, groupCounselor: row.counselor, closedBy: user });
                await addAttendanceNote(db, {
                    clientId: row.client, attendanceId: row.attendanceid, date, sessionNumber: sessionNum, groupName: row.groupname,
                    bipWeek: await bipWeekAt(db, { clientId: row.client, attendanceId: row.attendanceid, date }),
                    individual: false, text, author, closedBy: user,
                });
                done.added++;
            }
        }
        await db.query('COMMIT');
        await logAction(user, 'Update Attendance Notes', `${rows[0].groupname} ${date} session ${sessionNum}: ${done.added} added, ${done.updated} updated, ${done.removed} removed`);
        res.json(done);
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        db.release();
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
        if (String(date) > new Date().toLocaleDateString('en-CA')) {
            return res.status(400).json({ error: 'The group date can\'t be in the future.' });
        }
        const sessionNum = Number(sessionNumber) > 0 ? Math.floor(Number(sessionNumber)) : 1;
        const existing = await pool.query(
            `SELECT o.CreatedBy, o.CoveredBy, o.Entries, g.Counselor FROM OpenGroupSessions o JOIN Groups g ON g.GroupId = o.GroupId
             WHERE o.GroupId = $1 AND o.SessionDate = $2 AND o.SessionNumber = $3`,
            [group, date, sessionNum]
        );
        if (existing.rows[0] && !canSeeOpenGroup(await openGroupViewer(createdBy), existing.rows[0])) {
            return res.status(403).json({ error: 'This group already has an open check-in for this session, started by another counselor. Only that counselor, the group\'s counselor, or an administrator can change it.' });
        }
        const covering = await coveringCounselorFor(createdBy, coveredBy, existing.rows[0]?.coveredby ?? null);
        // Clients given a printed attendance receipt stay on the sheet with the fee and payment that were printed. The
        // check runs in the upsert itself (WHERE on the update) so a save from another screen in between can't slip past it.
        const savedEntries = existing.rows[0]?.entries ?? [];
        const problem = printedReceiptProblem(savedEntries, entries);
        if (problem) return res.status(409).json({ error: problem });
        // Other payments on the sheet: the kind must be known, and only a Business Administrator adds Direct Deposit, Tribal
        // or DHS (one already on the saved sheet unchanged is kept when someone else saves it)
        for (const e of entries) {
            if (!(Number(e.payment) > 0)) continue;
            const methodProblem = paymentMethodProblem({ method: e.paymentMethod, subtype: e.paymentSubtype, role: req.user?.role });
            if (!methodProblem) continue;
            const saved = savedEntries.find(s => Number(s.client?.clientid) === Number(e.client?.clientid));
            const unchanged = saved && saved.paymentMethod === e.paymentMethod && saved.paymentSubtype === e.paymentSubtype
                && !paymentMethodProblem({ method: e.paymentMethod, subtype: e.paymentSubtype, role: 'Business Administrator' });
            if (!unchanged) return res.status(methodProblem.startsWith('Only') ? 403 : 400).json({ error: `${e.client?.lastname}, ${e.client?.firstname}: ${methodProblem}` });
        }
        // A Federal SO client newly put on the sheet needs units left for this group (6022 group, 6012 individual)
        const savedIds = new Set(savedEntries.map(e => Number(e.client?.clientid)));
        const added = entries.map(e => Number(e.client?.clientid)).filter(id => id && !savedIds.has(id));
        const groupType = (await pool.query('SELECT ProgramType FROM Groups WHERE GroupId = $1', [group])).rows[0]?.programtype;
        const noUnits = await clientsWithoutUnits(pool, added, groupType);
        if (noUnits.length) return res.status(400).json({ error: noUnitsMessage(noUnits) });
        // Drug tests are once a day
        if (String(groupType || '').trim().toUpperCase() === 'DRUG TEST') {
            const tested = await drugTestedOn(pool, added, date, { group: Number(group), sessionNumber: sessionNum });
            if (tested.length) return res.status(400).json({ error: `${tested.join('; ')} already had a drug test that day. Clients can be drug tested once a day.` });
        }
        const toSave = keepPrintedMarks(savedEntries, entries);
        const saved = await pool.query(
            `INSERT INTO OpenGroupSessions (GroupId, SessionDate, SessionNumber, Entries, CreatedBy, CoveredBy, UpdatedOn)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (GroupId, SessionDate, SessionNumber)
             DO UPDATE SET Entries = EXCLUDED.Entries, CoveredBy = EXCLUDED.CoveredBy, UpdatedOn = NOW()
             WHERE OpenGroupSessions.Entries IS NOT DISTINCT FROM $7::jsonb
             RETURNING OpenSessionId`,
            [group, date, sessionNum, JSON.stringify(toSave), createdBy, covering, existing.rows[0] ? JSON.stringify(savedEntries) : null]
        );
        if (saved.rows.length === 0) {
            return res.status(409).json({ error: 'This check-in was just changed on another screen. Reopen it from Open Groups and try again.' });
        }
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
            'SELECT o.CreatedBy, o.Entries, g.Counselor FROM OpenGroupSessions o JOIN Groups g ON g.GroupId = o.GroupId WHERE o.OpenSessionId = $1',
            [id]
        );
        if (existing.rows[0] && !canSeeOpenGroup(await openGroupViewer(removedBy), existing.rows[0])) {
            return res.status(403).json({ error: 'Only the counselor who opened this check-in, the group\'s counselor, or an administrator can discard it.' });
        }
        // A session with a printed attendance receipt can only be closed. The check is repeated in the DELETE so a receipt
        // printed on another screen just now still blocks it.
        const printedReceiptError = 'An attendance receipt was printed for a client in this session, so it can\'t be discarded. Close the group to save the attendance.';
        if (existing.rows[0] && printedEntries(existing.rows[0].entries).length > 0) {
            return res.status(409).json({ error: printedReceiptError });
        }
        // Cash entered on the sheet is only recorded on close; discarding would lose the record of it
        const cashProblem = existing.rows[0] ? cashDiscardProblem(existing.rows[0].entries) : null;
        if (cashProblem) return res.status(409).json({ error: cashProblem });
        const deleted = await pool.query(
            `DELETE FROM OpenGroupSessions WHERE OpenSessionId = $1
               AND NOT jsonb_path_exists(Entries, '$[*] ? (@.receiptPrinted == true)')
               AND NOT jsonb_path_exists(Entries, '$[*] ? (@.payment.double() > 0)')
             RETURNING OpenSessionId`,
            [id]
        );
        if (existing.rows[0] && deleted.rows.length === 0) {
            // A receipt was printed, or cash entered, on another screen just now
            const now = (await pool.query('SELECT Entries FROM OpenGroupSessions WHERE OpenSessionId = $1', [id])).rows[0];
            return res.status(409).json({ error: (now && cashDiscardProblem(now.entries)) || printedReceiptError });
        }
        if (removedBy) {
            await logAction(removedBy, 'Group Check-In Discarded', `Discarded open check-in ID ${id}`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
