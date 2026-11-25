const express = require('express');
const { logAction, pool } = require('../db');
const { individualPrice, recordAttendance } = require('../lib/attendance');
const { requireRole } = require('../lib/auth');
const { coveringCounselorFor } = require('../lib/cashResponsibility');
const { logClientChange } = require('../lib/changeLog');
const { printedReceiptProblem } = require('../lib/printedReceipts');
const { addAttendanceNote, noteAuthor, splitEntryComments } = require('../lib/attendanceNotes');
const { paymentMethodProblem } = require('../lib/paymentMethods');
const { INDIVIDUAL_SESSION_TYPES } = require('../lib/sql');
const { undoAttendance } = require('../lib/undoAttendance');
const { UNIT_PROGRAMS, useSessionUnits } = require('../lib/federalUnits');
const { FEDERAL_PROGRAM_TYPES } = require('../lib/busPasses');

const router = express.Router();

// SO group program types, as stored on Groups
const SO_GROUP_TYPES = ['SO', 'FED SO'];

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
    // The check-in type comes from the kind of group (below), never from the request: a group sent as "Individual" or
    // "Assessment" would skip the first check-in limit and the group fee rules
    const { group, date, sessionNumber, createdBy, coveredBy, entries } = req.body;
    const sessionNum = Number(sessionNumber) > 0 ? Math.floor(Number(sessionNumber)) : 1;

    if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'No clients were provided for check-in.' });
    }

    // A group can be checked in for an earlier date it took place, never a later one
    if (date && String(date) > new Date().toLocaleDateString('en-CA')) {
        return res.status(400).json({ error: 'The group date can\'t be in the future.' });
    }

    const clientIds = entries.map(e => Number(e.client));
    if (new Set(clientIds).size !== clientIds.length) {
        return res.status(400).json({ error: 'The same client cannot be checked in twice in one session.' });
    }

    // Card payments are applied to the account when processed at check-in, so closing a group never records one
    if (entries.some(e => e.paymentMethod === 'Credit Card' && Number(e.accountPaid) > 0)) {
        return res.status(400).json({ error: 'A card payment on this sheet was not processed. Process it at check-in, or remove the client and check them in again.' });
    }

    // Other payments: the kind must be known, and Direct Deposit, Tribal and DHS are for Business Administrators only
    for (const e of entries) {
        if (!(Number(e.accountPaid) > 0)) continue;
        const problem = paymentMethodProblem({ method: e.paymentMethod, subtype: e.paymentSubtype, role: req.user?.role });
        if (problem) return res.status(problem.startsWith('Only') ? 403 : 400).json({ error: problem });
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
        const groupRes = await clientDb.query('SELECT ProgramType, Counselor, GroupName FROM Groups WHERE GroupId = $1', [group]);
        const groupType = String(groupRes.rows[0]?.programtype || '').trim().toUpperCase();
        // Polys groups don't take attendance: their clients are polygraphed, not checked in
        if (groupType === 'POLY') {
            throw Object.assign(new Error('Polys groups do not take attendance. Their clients are scheduled for polygraphs instead.'), { status: 400 });
        }
        const isSoGroup = SO_GROUP_TYPES.includes(groupType);
        // A counselor's INDIVIDUAL group records Individual sessions: charged the Admin Individual price (not the treatment
        // fee or its monthly rules), with the group's counselor as the provider. BIP clients don't have individual sessions.
        const individual = groupType === 'INDIVIDUAL' ? await individualPrice(clientDb) : null;
        if (groupType === 'INDIVIDUAL' && !individual) {
            throw Object.assign(new Error('There is no active Individual price in Admin. Add one to the price list before checking in an individual group.'), { status: 400 });
        }
        if (individual) {
            const bip = await clientDb.query(
                `SELECT LastName || ', ' || FirstName AS name FROM Clients WHERE ClientId = ANY($1::int[]) AND ProgramType = 'BIP'`, [clientIds]);
            if (bip.rows.length) {
                throw Object.assign(new Error(`${bip.rows.map(r => r.name).join('; ')}: BIP clients do not have individual sessions.`), { status: 400 });
            }
        }
        // Federal clients' individual sessions are charged their Individual Copay (nothing when blank), not the Individual price
        const copays = individual ? new Map((await clientDb.query(
            'SELECT ClientId, IndividualCopay FROM Clients WHERE ClientId = ANY($1::int[]) AND ProgramType = ANY($2::text[])',
            [clientIds, FEDERAL_PROGRAM_TYPES])).rows.map(r => [r.clientid, Number(r.individualcopay || 0)])) : new Map();
        // Federal SO clients use their 6022 (group) or 6012 (individual) units by how long they attended (lib/federalUnits.js)
        const unitClients = new Map((await clientDb.query(
            `SELECT ClientId, ProgramType, LastName || ', ' || FirstName AS name FROM Clients WHERE ClientId = ANY($1::int[]) AND ProgramType = ANY($2::text[])`,
            [clientIds, UNIT_PROGRAMS])).rows.map(r => [r.clientid, r]));
        // Drug tests are once a day: refuse a client already tested that date in any drug test group
        if (groupType === 'DRUG TEST') {
            const tested = await clientDb.query(
                `SELECT DISTINCT c.LastName || ', ' || c.FirstName AS name FROM Attendance a JOIN Groups g ON g.GroupId = a."Group"
                 JOIN Clients c ON c.ClientId = a.Client
                 WHERE a.Client = ANY($1::int[]) AND a.Date = $2::date AND UPPER(TRIM(g.ProgramType)) = 'DRUG TEST'`,
                [clientIds, date || new Date().toLocaleDateString('en-CA')]);
            if (tested.rows.length) {
                throw Object.assign(new Error(`${tested.rows.map(r => r.name).join('; ')} already had a drug test that day. Clients can be drug tested once a day.`), { status: 400 });
            }
        }
        const results = [];
        for (const entry of entries) {
            // The comment typed on the review screen becomes a Therapist case note (added below); only the approved
            // make-up flag is kept on the attendance
            const { attendanceComment, noteText } = splitEntryComments(entry);
            const { attendanceId, newBalance, polyVoucherAwarded, feeCharged, feeReason, bipWeek } = await recordAttendance(clientDb, {
                ...entry, comments: attendanceComment, group, date, sessionNumber: sessionNum, type: individual ? 'Individual' : 'Group', createdBy, paid: true, awardNdiVoucher: isSoGroup,
                ...(individual ? {
                    groupFee: copays.has(Number(entry.client)) ? copays.get(Number(entry.client)) : individual.fee,
                    feeType: copays.has(Number(entry.client)) ? 'Individual Copay' : 'Individual Fee', sessionTypeId: individual.sessionTypeId,
                    provider: groupRes.rows[0].counselor || null,
                } : {}),
            });
            const unitClient = unitClients.get(Number(entry.client));
            if (unitClient) {
                await useSessionUnits(clientDb, {
                    clientId: Number(entry.client), programType: unitClient.programtype, name: unitClient.name, attendanceId, groupType,
                    durationBand: entry.durationBand, changedBy: createdBy, what: `session on ${date || 'today'}`,
                });
            }
            // The fee is worked out from the account when saving; a sheet shown with a different fee is reported back
            const feeSent = Math.round(Number(entry.groupFee || 0) * 100) / 100;
            const feeChange = feeCharged !== feeSent ? { feeSent, feeCharged, feeReason } : null;
            results.push({ client: entry.client, attendanceId, newBalance, polyVoucherAwarded, feeChange, bipWeek, noteText });
        }
        // Closing the group clears its saved open sheet for this session. Who opened it is kept on the attendance rows
        // so the closed group stays visible to them; a group closed without being opened first was opened by the closer.
        // The covering counselor (lib/cashResponsibility.js) is kept too: the closer's pick if they are an
        // administrator, otherwise whatever was saved with the open sheet.
        const openedRes = await clientDb.query(
            'DELETE FROM OpenGroupSessions WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3 RETURNING CreatedBy, CoveredBy, Entries',
            [group, date, sessionNum]
        );
        // Everyone handed a printed attendance receipt must be saved with the fee and payment on that receipt
        const printedProblem = printedReceiptProblem(openedRes.rows[0]?.entries, entries, { closing: true });
        if (printedProblem) throw Object.assign(new Error(printedProblem), { status: 409 });
        const openedBy = openedRes.rows[0]?.createdby || createdBy;
        const covering = await coveringCounselorFor(createdBy, coveredBy, openedRes.rows[0]?.coveredby ?? null);
        await clientDb.query(
            'UPDATE Attendance SET OpenedBy = $1, CoveredBy = $2 WHERE AttendanceId = ANY($3::int[])',
            [openedBy, covering, results.map(r => r.attendanceId)]
        );
        // Each comment goes on the client's case notes as a Therapist note from the session's counselor (the covering
        // counselor, else the group's usual counselor), saying which attendance it is about (lib/attendanceNotes.js)
        const closedBy = req.user?.employeeemail || createdBy;
        if (results.some(r => r.noteText)) {
            const author = await noteAuthor(clientDb, { coveredBy: covering, groupCounselor: groupRes.rows[0]?.counselor, closedBy });
            for (const r of results) {
                await addAttendanceNote(clientDb, {
                    clientId: Number(r.client), attendanceId: r.attendanceId, date: date || new Date().toLocaleDateString('en-CA'),
                    sessionNumber: sessionNum, groupName: groupRes.rows[0]?.groupname || `Group ${group}`, bipWeek: r.bipWeek,
                    individual: Boolean(individual), text: r.noteText, author, closedBy,
                });
            }
        }
        const names = await clientDb.query('SELECT ClientId, LastName || \', \' || FirstName AS Name FROM Clients WHERE ClientId = ANY($1::int[])', [clientIds]);
        const nameOf = Object.fromEntries(names.rows.map(r => [r.clientid, r.name]));
        const feeChanges = results.filter(r => r.feeChange).map(r => ({ client: r.client, name: nameOf[Number(r.client)], ...r.feeChange }));
        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, count: results.length, results: results.map(({ noteText, bipWeek, ...r }) => r), notesAdded: results.filter(r => r.noteText).length, polyVouchersAwarded: results.filter(r => r.polyVoucherAwarded).length, feeChanges });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(error.status || 500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

// Deletes a check-in (Business Administrators only) and undoes everything it did (lib/undoAttendance.js)
router.delete('/api/attendance/:id', requireRole('Business Administrator'), async (req, res) => {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
        return res.status(400).json({ error: 'A reason is required to delete attendance.' });
    }
    const user = req.user.employeeemail;
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const undone = await undoAttendance(db, { attendanceId: req.params.id, user, reason });
        if (!undone) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'That attendance no longer exists.' });
        }
        const { att, client: row, voucher, feeMoved, ledgerIds, details } = undone;
        await db.query('COMMIT');
        await logAction(user, 'Attendance Deleted', `Client ID ${att.client}, attendance ${att.attendanceid}: ${details}`);

        res.json({
            success: true,
            newBalance: Number(row.accountbalance),
            phase: row.phase,
            polyFeeVoucher: row.polyfeevoucher,
            voucher,
            feeMoved,
            // Sent like the client list sends them (not 'YYYY-MM-DD' text, which the browser reads as UTC midnight: a day early)
            lastDateAttended: row.lastdateattended,
            lastAttended: row.lastattended,
            ledgerRowsRemoved: ledgerIds.length,
        });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

module.exports = router;
