const express = require('express');
const { pool, logAction } = require('../db');
const { todayLocal } = require('../lib/dates');
const { logClientChange } = require('../lib/changeLog');
const { YMD } = require('../lib/sql');
const { requireRole } = require('../lib/auth');
const {
    slotProblem, appointmentProblem, locationProblem, moveProblem, ownsSlot, repeatDates, unassignReasonProblem, unassignNoteText,
    openSessionComment,
} = require('../lib/assessmentAppointments');

const router = express.Router();

// The Assessments calendar. A counselor opens availability (Open, no client); a client is assigned to an open time
// (Scheduled); either can be rescheduled or cancelled. Anyone who can open the Assessments tab can do these, but a
// counselor only changes times assigned to themselves. Identity (createdBy, updatedBy, ...) is stamped by requireSession.
const APPOINTMENT_COLUMNS = `a.AppointmentId, a.ClientId, c.FirstName, c.LastName, c.ProgramType, c.DOCNumber, c.DocType,
    a.Assessor, to_char(a.ApptDate, 'YYYY-MM-DD') AS ApptDate, to_char(a.ApptTime, 'HH24:MI') AS ApptTime, a.Location, a.Notes, a.Status, a.CreatedBy`;
const APPOINTMENT_FROM = 'AssessmentAppointments a LEFT JOIN Clients c ON c.ClientId = a.ClientId';

const counselorActive = async (db, name) => !!(await db.query(
    "SELECT 1 FROM EmployeeRoles WHERE DisplayName = $1 AND Role = 'Counselor' AND Active = TRUE", [name])).rows[0];
const clientActive = async (db, clientId) => !!(await db.query(
    "SELECT 1 FROM Clients WHERE ClientId = $1 AND ProgramStatus = 'Active'", [clientId])).rows[0];

// The appointment as stored (for ownership, status and the change log), or null
const loadAppointment = async (db, id) => (await db.query(
    `SELECT AppointmentId, ClientId, Assessor, to_char(ApptDate, 'YYYY-MM-DD') AS ApptDate, to_char(ApptTime, 'HH24:MI') AS ApptTime, Location, Status
     FROM AssessmentAppointments WHERE AppointmentId = $1`, [id])).rows[0] ?? null;

const note = (value) => String(value || '').trim() || null;

// A client on a time gets an open Assessment session for that date with the assessor as its counselor, shown under Open
// Sessions on the Assessments tab. Its type (and fee) is chosen when it's reviewed and closed.
const openSessionForTime = (db, { appointmentId, clientId, date, time, location, assessor, createdBy }) => db.query(
    `INSERT INTO OpenIndividualSessions (ClientId, Category, SessionTypeId, SessionDate, Fee, Payment, Provider, Comments, CreatedBy, AssessmentAppointmentId)
     VALUES ($1, 'Assessment', NULL, $2, 0, 0, $3, $4, $5, $6)`,
    [clientId, date, assessor, openSessionComment({ time, location }), createdBy || null, appointmentId]);
// The client is off the time: its open session goes too, unless money was already applied on it (then it stays, unlinked)
const releaseOpenSession = async (db, appointmentId) => {
    await db.query('DELETE FROM OpenIndividualSessions WHERE AssessmentAppointmentId = $1 AND PaidOnOpen = 0', [appointmentId]);
    await db.query('UPDATE OpenIndividualSessions SET AssessmentAppointmentId = NULL WHERE AssessmentAppointmentId = $1', [appointmentId]);
};

// Appointments and open times from one date through another (YYYY-MM-DD), oldest first, cancelled ones included. An open
// time on a day that has passed with nobody booked into it is left out: it can't be used any more.
router.get('/api/assessment-appointments', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!YMD.test(String(from || '')) || !YMD.test(String(to || ''))) {
            return res.status(400).json({ error: 'Give a from and to date (YYYY-MM-DD).' });
        }
        const result = await pool.query(
            `SELECT ${APPOINTMENT_COLUMNS} FROM ${APPOINTMENT_FROM}
             WHERE a.ApptDate BETWEEN $1 AND $2 AND NOT (a.Status = 'Open' AND a.ApptDate < $3::date)
             ORDER BY a.ApptDate, a.ApptTime, c.LastName, c.FirstName`,
            [from, to, todayLocal()]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Inserts one time per date (Open, or Scheduled when clientId is given) in one transaction, leaving out dates when the
// counselor already has an open or scheduled time at that hour. Returns { created, skipped }, each a list of dates.
const createTimes = async ({ clientId, assessor, dates, time, location, notes, createdBy }) => {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const taken = new Set((await db.query(
            `SELECT to_char(ApptDate, 'YYYY-MM-DD') AS day FROM AssessmentAppointments
             WHERE Assessor = $1 AND ApptTime = $2 AND ApptDate = ANY($3::date[]) AND Status <> 'Cancelled'`,
            [assessor, time, dates])).rows.map(r => r.day));
        const created = dates.filter(d => !taken.has(d));
        for (const day of created) {
            const appointmentId = (await db.query(
                `INSERT INTO AssessmentAppointments (ClientId, Assessor, ApptDate, ApptTime, Location, Notes, Status, CreatedBy)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING AppointmentId`,
                [clientId ?? null, assessor, day, time, location, note(notes), clientId ? 'Scheduled' : 'Open', createdBy || null])).rows[0].appointmentid;
            if (clientId) await openSessionForTime(db, { appointmentId, clientId, date: day, time, location, assessor, createdBy });
        }
        await db.query('COMMIT');
        return { created, skipped: dates.filter(d => taken.has(d)) };
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        db.release();
    }
};
const spanText = (dates) => (dates.length === 1 ? dates[0] : `${dates.length} dates, ${dates[0]} to ${dates[dates.length - 1]}`);
const allTakenMessage = (who, time, count) =>
    `${who} already has a time at ${time} ${count === 1 ? 'on that date' : 'on each of those dates'}.`;

// Open availability: a time with no client, for a counselor to assign later. repeat (weekdays, weekly, biweekly) and
// until open the same time on each date through until.
router.post('/api/assessment-appointments/slots', async (req, res) => {
    try {
        const { assessor, date, time, location, notes, repeat, until, createdBy } = req.body;
        const who = String(assessor || '').trim();
        const problem = slotProblem({ date, time, today: todayLocal(), assessorActive: await counselorActive(pool, who) }) || locationProblem(location);
        if (problem) return res.status(400).json({ error: problem });
        const { dates, error } = repeatDates(date, repeat, until);
        if (error) return res.status(400).json({ error });
        if (!ownsSlot(req.user, who)) return res.status(403).json({ error: 'Counselors can only open availability for themselves.' });
        const { created, skipped } = await createTimes({ assessor: who, dates, time, location: location.trim(), notes, createdBy });
        if (!created.length) return res.status(400).json({ error: allTakenMessage(who, time, dates.length) });
        await logAction(createdBy, 'Assessment Availability Opened', `${who} at ${time}, ${location.trim()}: ${spanText(created)}`);
        res.status(201).json({ success: true, created: created.length, skipped });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Schedule a client at a new time in one step (the counselor's own, or any counselor's for an Office or Business
// Administrator). Repeats like open availability.
router.post('/api/assessment-appointments', async (req, res) => {
    try {
        const { clientId, assessor, date, time, location, notes, repeat, until, createdBy } = req.body;
        const who = String(assessor || '').trim();
        const problem = appointmentProblem({
            date, time, today: todayLocal(),
            clientActive: await clientActive(pool, clientId),
            assessorActive: await counselorActive(pool, who),
        }) || locationProblem(location);
        if (problem) return res.status(400).json({ error: problem });
        const { dates, error } = repeatDates(date, repeat, until);
        if (error) return res.status(400).json({ error });
        if (!ownsSlot(req.user, who)) return res.status(403).json({ error: 'Counselors can only schedule their own assessments.' });
        const { created, skipped } = await createTimes({ clientId, assessor: who, dates, time, location: location.trim(), notes, createdBy });
        if (!created.length) return res.status(400).json({ error: allTakenMessage(who, time, dates.length) });
        await logClientChange(pool, { clientId, changedBy: createdBy, changeType: 'Assessment Scheduled', newValue: `${spanText(created)} at ${time}`, details: `Assessor: ${who}, ${location.trim()}` });
        await logAction(createdBy, 'Assessment Scheduled', `Client ID ${clientId} with ${who} at ${time}, ${location.trim()}: ${spanText(created)}`);
        res.status(201).json({ success: true, created: created.length, skipped });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cancel every open (unassigned) time a counselor has from today on. Times with a client are left alone. Business
// Administrators only (DEV acts as one).
router.post('/api/assessment-appointments/cancel-open', requireRole('Business Administrator'), async (req, res) => {
    try {
        const { assessor, cancelledBy } = req.body;
        const who = String(assessor || '').trim();
        if (!who) return res.status(400).json({ error: 'Choose the counselor.' });
        const result = await pool.query(
            `UPDATE AssessmentAppointments SET Status = 'Cancelled'
             WHERE Assessor = $1 AND Status = 'Open' AND ApptDate >= $2 RETURNING AppointmentId`,
            [who, todayLocal()]);
        if (result.rowCount) await logAction(cancelledBy, 'Assessment Open Times Cancelled', `${who}: ${result.rowCount} open time(s) from ${todayLocal()} on`);
        res.json({ success: true, cancelled: result.rowCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Assign a client to an open time. The client also gets an open Assessment session for that date.
router.post('/api/assessment-appointments/:id/assign', async (req, res) => {
    const db = await pool.connect();
    try {
        const { id } = req.params;
        const { clientId, notes, assignedBy } = req.body;
        await db.query('BEGIN');
        const row = (await db.query(
            `SELECT AppointmentId, ClientId, Assessor, to_char(ApptDate, 'YYYY-MM-DD') AS ApptDate, to_char(ApptTime, 'HH24:MI') AS ApptTime, Location, Status
             FROM AssessmentAppointments WHERE AppointmentId = $1 FOR UPDATE`, [id])).rows[0];
        const refuse = async (status, error) => { await db.query('ROLLBACK'); return res.status(status).json({ error }); };
        if (!row) return refuse(404, 'Assessment not found.');
        if (row.status !== 'Open') return refuse(400, 'That time already has a client or was cancelled.');
        if (!ownsSlot(req.user, row.assessor)) return refuse(403, 'Counselors can only assign their own times.');
        const problem = appointmentProblem({
            date: row.apptdate, time: row.appttime, today: todayLocal(),
            clientActive: await clientActive(db, clientId), assessorActive: true,
        });
        if (problem) return refuse(400, problem);
        await db.query(
            `UPDATE AssessmentAppointments SET ClientId = $1, Status = 'Scheduled', Notes = COALESCE($2, Notes) WHERE AppointmentId = $3`,
            [clientId, note(notes), id]);
        await openSessionForTime(db, { appointmentId: row.appointmentid, clientId, date: row.apptdate, time: row.appttime, location: row.location, assessor: row.assessor, createdBy: assignedBy });
        await logClientChange(db, { clientId, changedBy: assignedBy, changeType: 'Assessment Scheduled', newValue: `${row.apptdate} ${row.appttime}`, details: `Assessor: ${row.assessor}` });
        await db.query('COMMIT');
        await logAction(assignedBy, 'Assessment Scheduled', `Client ID ${clientId}: ${row.apptdate} ${row.appttime} with ${row.assessor}`);
        res.json({ success: true });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Take the client off a scheduled time (it opens up again). The reason goes in an Assessment case note on their account.
router.post('/api/assessment-appointments/:id/unassign', async (req, res) => {
    const db = await pool.connect();
    try {
        const { id } = req.params;
        const { removedBy: unassignedBy, reason } = req.body;
        const reasonProblem = unassignReasonProblem(reason);
        if (reasonProblem) return res.status(400).json({ error: reasonProblem });
        await db.query('BEGIN');
        const row = (await db.query(
            `SELECT AppointmentId, ClientId, Assessor, to_char(ApptDate, 'YYYY-MM-DD') AS ApptDate, to_char(ApptTime, 'HH24:MI') AS ApptTime, Location, Status
             FROM AssessmentAppointments WHERE AppointmentId = $1 FOR UPDATE`, [id])).rows[0];
        if (!row || row.status !== 'Scheduled') { await db.query('ROLLBACK'); return res.status(400).json({ error: 'No client is assigned to that time.' }); }
        if (!ownsSlot(req.user, row.assessor)) { await db.query('ROLLBACK'); return res.status(403).json({ error: 'Counselors can only change their own times.' }); }
        await db.query(`UPDATE AssessmentAppointments SET ClientId = NULL, Status = 'Open' WHERE AppointmentId = $1`, [id]);
        await releaseOpenSession(db, id);
        const comments = unassignNoteText({ date: row.apptdate, time: row.appttime, assessor: row.assessor, location: row.location, reason });
        // A system note: no approval needed
        await db.query(
            `INSERT INTO Notes (Client, Date, "User", Comments, Category, ApprovalStatus) VALUES ($1, NOW(), $2, $3, 'Assessment', NULL)`,
            [row.clientid, unassignedBy, comments]);
        await logClientChange(db, { clientId: row.clientid, changedBy: unassignedBy, changeType: 'Assessment Unassigned', oldValue: `${row.apptdate} ${row.appttime}`, details: comments });
        await db.query('COMMIT');
        await logAction(unassignedBy, 'Assessment Unassigned', `Appointment ${id}: ${row.apptdate} ${row.appttime}. ${String(reason).trim()}`);
        res.json({ success: true });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Reschedule or edit: a new date, time, assessor or note. Cancelled times can't change.
router.put('/api/assessment-appointments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { assessor, date, time, location, notes, updatedBy } = req.body;
        const who = String(assessor || '').trim();
        const place = String(location ?? '').trim();
        const before = await loadAppointment(pool, id);
        if (!before) return res.status(404).json({ error: 'Assessment not found.' });
        if (before.status === 'Cancelled') return res.status(400).json({ error: 'This assessment was cancelled. Open a new time instead.' });
        if (!ownsSlot(req.user, before.assessor) || !ownsSlot(req.user, who)) {
            return res.status(403).json({ error: 'Counselors can only change their own times.' });
        }
        // A client's assessment is rescheduled only into one of the counselor's open times (POST .../move); here its
        // location and note can still change
        if (before.status === 'Scheduled'
            && (date !== before.apptdate || time !== before.appttime || who.toLowerCase() !== String(before.assessor).trim().toLowerCase())) {
            return res.status(400).json({ error: `To reschedule, move the client to one of ${before.assessor}'s open times.` });
        }
        const problem = before.status === 'Open'
            ? slotProblem({ date, time, today: todayLocal(), assessorActive: await counselorActive(pool, who) })
            : appointmentProblem({ date, time, today: todayLocal(), clientActive: await clientActive(pool, before.clientid), assessorActive: await counselorActive(pool, who) });
        const problemOrPlace = problem || locationProblem(place);
        if (problemOrPlace) return res.status(400).json({ error: problemOrPlace });
        await pool.query(
            'UPDATE AssessmentAppointments SET Assessor = $1, ApptDate = $2, ApptTime = $3, Location = $4, Notes = $5 WHERE AppointmentId = $6',
            [who, date, time, place, note(notes), id]);
        const oldWhen = `${before.apptdate} ${before.appttime}`;
        const newWhen = `${date} ${time}`;
        if (oldWhen !== newWhen || before.assessor !== who || (before.location || '') !== place) {
            if (before.clientid) {
                await logClientChange(pool, { clientId: before.clientid, changedBy: updatedBy, changeType: 'Assessment Rescheduled', oldValue: `${oldWhen}${before.location ? `, ${before.location}` : ''}`, newValue: `${newWhen}, ${place}`, details: `Assessor: ${who}` });
            }
            await logAction(updatedBy, 'Assessment Rescheduled', `Appointment ${id}: ${oldWhen} to ${newWhen}, ${place}, with ${who}`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reschedule a client's assessment: move the client into one of the same counselor's open times ({ toId }). The client's
// old time opens up again. Both rows are locked so two people can't take the same open time.
router.post('/api/assessment-appointments/:id/move', async (req, res) => {
    const db = await pool.connect();
    try {
        const { id } = req.params;
        const { toId, updatedBy } = req.body;
        await db.query('BEGIN');
        const rows = (await db.query(
            `SELECT AppointmentId, ClientId, Assessor, to_char(ApptDate, 'YYYY-MM-DD') AS ApptDate, to_char(ApptTime, 'HH24:MI') AS ApptTime,
                    Location, Notes, Status
             FROM AssessmentAppointments WHERE AppointmentId = ANY($1::int[]) ORDER BY AppointmentId FOR UPDATE`,
            [[Number(id), Number(toId)].filter(Number.isInteger)])).rows;
        const from = rows.find(r => String(r.appointmentid) === String(id));
        const to = rows.find(r => String(r.appointmentid) === String(toId));
        if (!from) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Assessment not found.' }); }
        if (!ownsSlot(req.user, from.assessor)) { await db.query('ROLLBACK'); return res.status(403).json({ error: 'Counselors can only change their own times.' }); }
        const problem = moveProblem({ from, to, today: todayLocal() });
        if (problem) { await db.query('ROLLBACK'); return res.status(400).json({ error: problem }); }
        // The client (and the assessment's note, unless the open time has its own) go to the open time; the old time reopens
        await db.query(
            `UPDATE AssessmentAppointments SET ClientId = $1, Status = 'Scheduled', Notes = COALESCE(Notes, $2) WHERE AppointmentId = $3`,
            [from.clientid, from.notes, to.appointmentid]);
        await db.query(`UPDATE AssessmentAppointments SET ClientId = NULL, Status = 'Open' WHERE AppointmentId = $1`, [from.appointmentid]);
        // The open session follows the client to the new date (or is made, for a time scheduled before sessions were linked)
        const followed = await db.query(
            'UPDATE OpenIndividualSessions SET SessionDate = $1, Comments = $2, AssessmentAppointmentId = $3 WHERE AssessmentAppointmentId = $4',
            [to.apptdate, openSessionComment({ time: to.appttime, location: to.location }), to.appointmentid, from.appointmentid]);
        if (!followed.rowCount) {
            await openSessionForTime(db, { appointmentId: to.appointmentid, clientId: from.clientid, date: to.apptdate, time: to.appttime, location: to.location, assessor: to.assessor, createdBy: updatedBy });
        }
        const oldWhen = `${from.apptdate} ${from.appttime}${from.location ? `, ${from.location}` : ''}`;
        const newWhen = `${to.apptdate} ${to.appttime}${to.location ? `, ${to.location}` : ''}`;
        await logClientChange(db, { clientId: from.clientid, changedBy: updatedBy, changeType: 'Assessment Rescheduled', oldValue: oldWhen, newValue: newWhen, details: `Assessor: ${from.assessor}` });
        await db.query('COMMIT');
        await logAction(updatedBy, 'Assessment Rescheduled', `Client ID ${from.clientid}: ${oldWhen} to ${newWhen} with ${from.assessor}`);
        res.json({ success: true, appointmentId: to.appointmentid });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Cancelling keeps the record; the time stops showing on the calendar
router.post('/api/assessment-appointments/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        const { cancelledBy } = req.body;
        const row = await loadAppointment(pool, id);
        if (!row || row.status === 'Cancelled') return res.status(404).json({ error: 'No open or scheduled assessment with that id.' });
        if (!ownsSlot(req.user, row.assessor)) return res.status(403).json({ error: 'Counselors can only cancel their own times.' });
        await pool.query(`UPDATE AssessmentAppointments SET Status = 'Cancelled' WHERE AppointmentId = $1`, [id]);
        if (row.clientid) await releaseOpenSession(pool, id);
        if (row.clientid) {
            await logClientChange(pool, { clientId: row.clientid, changedBy: cancelledBy, changeType: 'Assessment Cancelled', oldValue: `${row.apptdate} ${row.appttime}` });
        }
        await logAction(cancelledBy, 'Assessment Cancelled', `Appointment ${id}: ${row.apptdate} ${row.appttime} with ${row.assessor}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
