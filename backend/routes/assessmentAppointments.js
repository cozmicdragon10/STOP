const express = require('express');
const { pool, logAction } = require('../db');
const { todayLocal } = require('../lib/dates');
const { logClientChange } = require('../lib/changeLog');
const { YMD } = require('../lib/sql');
const { slotProblem, appointmentProblem, ownsSlot } = require('../lib/assessmentAppointments');

const router = express.Router();

// The Assessments calendar. A counselor opens availability (Open, no client); a client is assigned to an open time
// (Scheduled); either can be rescheduled or cancelled. Anyone who can open the Assessments tab can do these, but a
// counselor only changes times assigned to themselves. Identity (createdBy, updatedBy, ...) is stamped by requireSession.
const APPOINTMENT_COLUMNS = `a.AppointmentId, a.ClientId, c.FirstName, c.LastName, c.ProgramType, c.DOCNumber, c.DocType,
    a.Assessor, to_char(a.ApptDate, 'YYYY-MM-DD') AS ApptDate, to_char(a.ApptTime, 'HH24:MI') AS ApptTime, a.Notes, a.Status, a.CreatedBy`;
const APPOINTMENT_FROM = 'AssessmentAppointments a LEFT JOIN Clients c ON c.ClientId = a.ClientId';

const counselorActive = async (db, name) => !!(await db.query(
    "SELECT 1 FROM EmployeeRoles WHERE DisplayName = $1 AND Role = 'Counselor' AND Active = TRUE", [name])).rows[0];
const clientActive = async (db, clientId) => !!(await db.query(
    "SELECT 1 FROM Clients WHERE ClientId = $1 AND ProgramStatus = 'Active'", [clientId])).rows[0];

// The appointment as stored (for ownership, status and the change log), or null
const loadAppointment = async (db, id) => (await db.query(
    `SELECT AppointmentId, ClientId, Assessor, to_char(ApptDate, 'YYYY-MM-DD') AS ApptDate, to_char(ApptTime, 'HH24:MI') AS ApptTime, Status
     FROM AssessmentAppointments WHERE AppointmentId = $1`, [id])).rows[0] ?? null;

const note = (value) => String(value || '').trim() || null;

// Appointments and open times from one date through another (YYYY-MM-DD), oldest first, cancelled ones included
router.get('/api/assessment-appointments', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!YMD.test(String(from || '')) || !YMD.test(String(to || ''))) {
            return res.status(400).json({ error: 'Give a from and to date (YYYY-MM-DD).' });
        }
        const result = await pool.query(
            `SELECT ${APPOINTMENT_COLUMNS} FROM ${APPOINTMENT_FROM}
             WHERE a.ApptDate BETWEEN $1 AND $2 ORDER BY a.ApptDate, a.ApptTime, c.LastName, c.FirstName`,
            [from, to]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Open availability: a time with no client, for a counselor to assign later
router.post('/api/assessment-appointments/slots', async (req, res) => {
    try {
        const { assessor, date, time, notes, createdBy } = req.body;
        const who = String(assessor || '').trim();
        const problem = slotProblem({ date, time, today: todayLocal(), assessorActive: await counselorActive(pool, who) });
        if (problem) return res.status(400).json({ error: problem });
        if (!ownsSlot(req.user, who)) return res.status(403).json({ error: 'Counselors can only open availability for themselves.' });
        const inserted = await pool.query(
            `INSERT INTO AssessmentAppointments (ClientId, Assessor, ApptDate, ApptTime, Notes, Status, CreatedBy)
             VALUES (NULL, $1, $2, $3, $4, 'Open', $5) RETURNING AppointmentId`,
            [who, date, time, note(notes), createdBy || null]);
        await logAction(createdBy, 'Assessment Availability Opened', `${who}: ${date} ${time}`);
        res.status(201).json({ success: true, appointmentId: inserted.rows[0].appointmentid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Schedule a client for a new time in one step (the counselor's own, or any counselor's for an Office or Business Administrator)
router.post('/api/assessment-appointments', async (req, res) => {
    try {
        const { clientId, assessor, date, time, notes, createdBy } = req.body;
        const who = String(assessor || '').trim();
        const problem = appointmentProblem({
            date, time, today: todayLocal(),
            clientActive: await clientActive(pool, clientId),
            assessorActive: await counselorActive(pool, who),
        });
        if (problem) return res.status(400).json({ error: problem });
        if (!ownsSlot(req.user, who)) return res.status(403).json({ error: 'Counselors can only schedule their own assessments.' });
        const inserted = await pool.query(
            `INSERT INTO AssessmentAppointments (ClientId, Assessor, ApptDate, ApptTime, Notes, Status, CreatedBy)
             VALUES ($1, $2, $3, $4, $5, 'Scheduled', $6) RETURNING AppointmentId`,
            [clientId, who, date, time, note(notes), createdBy || null]);
        await logClientChange(pool, { clientId, changedBy: createdBy, changeType: 'Assessment Scheduled', newValue: `${date} ${time}`, details: `Assessor: ${who}` });
        await logAction(createdBy, 'Assessment Scheduled', `Client ID ${clientId}: ${date} ${time} with ${who}`);
        res.status(201).json({ success: true, appointmentId: inserted.rows[0].appointmentid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Assign a client to an open time
router.post('/api/assessment-appointments/:id/assign', async (req, res) => {
    try {
        const { id } = req.params;
        const { clientId, notes, assignedBy } = req.body;
        const row = await loadAppointment(pool, id);
        if (!row) return res.status(404).json({ error: 'Assessment not found.' });
        if (row.status !== 'Open') return res.status(400).json({ error: 'That time already has a client or was cancelled.' });
        if (!ownsSlot(req.user, row.assessor)) return res.status(403).json({ error: 'Counselors can only assign their own times.' });
        const problem = appointmentProblem({
            date: row.apptdate, time: row.appttime, today: todayLocal(),
            clientActive: await clientActive(pool, clientId), assessorActive: true,
        });
        if (problem) return res.status(400).json({ error: problem });
        await pool.query(
            `UPDATE AssessmentAppointments SET ClientId = $1, Status = 'Scheduled', Notes = COALESCE($2, Notes) WHERE AppointmentId = $3`,
            [clientId, note(notes), id]);
        await logClientChange(pool, { clientId, changedBy: assignedBy, changeType: 'Assessment Scheduled', newValue: `${row.apptdate} ${row.appttime}`, details: `Assessor: ${row.assessor}` });
        await logAction(assignedBy, 'Assessment Scheduled', `Client ID ${clientId}: ${row.apptdate} ${row.appttime} with ${row.assessor}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Take a client off a time, which goes back to open availability
router.post('/api/assessment-appointments/:id/unassign', async (req, res) => {
    try {
        const { id } = req.params;
        const { removedBy: unassignedBy } = req.body;
        const row = await loadAppointment(pool, id);
        if (!row || row.status !== 'Scheduled') return res.status(400).json({ error: 'No client is assigned to that time.' });
        if (!ownsSlot(req.user, row.assessor)) return res.status(403).json({ error: 'Counselors can only change their own times.' });
        await pool.query(`UPDATE AssessmentAppointments SET ClientId = NULL, Status = 'Open' WHERE AppointmentId = $1`, [id]);
        await logClientChange(pool, { clientId: row.clientid, changedBy: unassignedBy, changeType: 'Assessment Unassigned', oldValue: `${row.apptdate} ${row.appttime}` });
        await logAction(unassignedBy, 'Assessment Unassigned', `Appointment ${id}: ${row.apptdate} ${row.appttime}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reschedule or edit: a new date, time, assessor or note. Cancelled times can't change.
router.put('/api/assessment-appointments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { assessor, date, time, notes, updatedBy } = req.body;
        const who = String(assessor || '').trim();
        const before = await loadAppointment(pool, id);
        if (!before) return res.status(404).json({ error: 'Assessment not found.' });
        if (before.status === 'Cancelled') return res.status(400).json({ error: 'This assessment was cancelled. Open a new time instead.' });
        if (!ownsSlot(req.user, before.assessor) || !ownsSlot(req.user, who)) {
            return res.status(403).json({ error: 'Counselors can only change their own times.' });
        }
        const problem = before.status === 'Open'
            ? slotProblem({ date, time, today: todayLocal(), assessorActive: await counselorActive(pool, who) })
            : appointmentProblem({ date, time, today: todayLocal(), clientActive: await clientActive(pool, before.clientid), assessorActive: await counselorActive(pool, who) });
        if (problem) return res.status(400).json({ error: problem });
        await pool.query(
            'UPDATE AssessmentAppointments SET Assessor = $1, ApptDate = $2, ApptTime = $3, Notes = $4 WHERE AppointmentId = $5',
            [who, date, time, note(notes), id]);
        const oldWhen = `${before.apptdate} ${before.appttime}`;
        const newWhen = `${date} ${time}`;
        if (oldWhen !== newWhen || before.assessor !== who) {
            if (before.clientid) {
                await logClientChange(pool, { clientId: before.clientid, changedBy: updatedBy, changeType: 'Assessment Rescheduled', oldValue: oldWhen, newValue: newWhen, details: `Assessor: ${who}` });
            }
            await logAction(updatedBy, 'Assessment Rescheduled', `Appointment ${id}: ${oldWhen} to ${newWhen} with ${who}`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
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
