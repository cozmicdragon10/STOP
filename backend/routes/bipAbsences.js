const express = require('express');
const { pool, logAction } = require('../db');
const { requireRole } = require('../lib/auth');
const { todayLocal } = require('../lib/dates');
const { logClientChange } = require('../lib/changeLog');
const { bipAbsenceStatusFor, excuseAbsence } = require('../lib/bipAbsences');
const { weekOf } = require('../lib/missedGroups');

const router = express.Router();

// A BIP client's absences and locks (lib/bipAbsences.js), for the client's account
router.get('/api/clients/:id/bip-absences', async (req, res) => {
    try {
        res.json(await bipAbsenceStatusFor(pool, Number(req.params.id), todayLocal()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Business Administrators (and DEV, which acts as one) excuse a missed meeting on the client's account
router.post('/api/clients/:id/bip-absences/excuse', requireRole('Business Administrator'), async (req, res) => {
    const db = await pool.connect();
    try {
        const clientId = Number(req.params.id);
        const { date, reason } = req.body || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return res.status(400).json({ error: 'Give the date of the absence.' });
        const excusedBy = req.user.employeeemail;
        await db.query('BEGIN');
        const result = await excuseAbsence(db, { clientId, date, reason, excusedBy, today: todayLocal() });
        await db.query('COMMIT');
        await logAction(excusedBy, 'BIP Absence Excused', `Client ID ${clientId}: absence on ${result.absenceDate} excused. ${String(reason).trim()}`);
        res.status(201).json({ success: true, ...result });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Undoes an excuse (by the date of the absence it covers)
router.delete('/api/clients/:id/bip-absences/excuse/:date', requireRole('Business Administrator'), async (req, res) => {
    try {
        const clientId = Number(req.params.id);
        const week = weekOf(req.params.date);
        const removed = await pool.query('DELETE FROM BipAbsenceExcuses WHERE ClientId = $1 AND WeekOf = $2 RETURNING ExcuseId', [clientId, week]);
        if (!removed.rowCount) return res.status(404).json({ error: 'No excuse for that absence.' });
        await logClientChange(pool, { clientId, changedBy: req.user.employeeemail, changeType: 'Absence Excuse Removed', oldValue: req.params.date });
        await logAction(req.user.employeeemail, 'BIP Absence Excuse Removed', `Client ID ${clientId}: excuse for the week of ${req.params.date} removed`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// The home page alert: BIP clients locked from their primary group by an absence threshold. Business Administrators (and
// DEV) see every counselor's; a counselor sees the clients of the groups they counsel.
router.get('/api/bip-absence-alerts', requireRole('Business Administrator', 'Counselor'), async (req, res) => {
    try {
        const isCounselor = req.user.role === 'Counselor';
        const me = String(req.user.displayname || '').trim();
        const { rows } = await pool.query(
            `SELECT c.ClientId, c.FirstName, c.LastName, g.GroupName, g.Counselor
             FROM Clients c JOIN Groups g ON g.GroupId = c.GroupId
             WHERE c.ProgramType = 'BIP' AND c.ProgramStatus = 'Active' AND c.GroupId IS NOT NULL
               AND ($1::boolean = FALSE OR LOWER(TRIM(g.Counselor)) = LOWER($2))`,
            [isCounselor, me]
        );
        const today = todayLocal();
        const states = await Promise.all(rows.map(r => bipAbsenceStatusFor(pool, r.clientid, today)));
        const alerts = rows.map((r, i) => ({ r, s: states[i] }))
            .filter(({ s }) => s.locked)
            .map(({ r, s }) => ({
                clientid: r.clientid,
                name: `${r.lastname}, ${r.firstname}`,
                groupname: r.groupname,
                counselor: r.counselor,
                reason: s.lockReason,
                deadline: s.nextDeadline,
                failEligible: s.failEligible,
                fullLock: s.fullLock,
                openCount: s.openCount,
            }))
            .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || '') || a.name.localeCompare(b.name));
        res.json(alerts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
