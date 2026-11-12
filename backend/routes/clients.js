const express = require('express');
const { ID_TYPES, idText } = require('../lib/clientId');
const { buildDischargeSummaryPdf } = require('../dischargeSummary');
const { logAction, pool } = require('../db');
const { activeRoleFor } = require('../lib/access');
const { requireRole } = require('../lib/auth');
const { groupNameFor, logClientChange } = require('../lib/changeLog');
const { POLY_VOUCHER_MAX_SQL, polyVoucherMax, activePolyFeeOverride, countPolyFeeFill } = require('../lib/poly');
const { ACTIVE_FEE_OVERRIDE, ATTENDED_THIS_MONTH, BIP_CHECKIN_BLOCK, FEE_ALREADY_CHARGED } = require('../lib/sql');
const { BUS_PASS_MAX, FEDERAL_PROGRAM_TYPES } = require('../lib/busPasses');
const { FEDERAL_UNITS_SQL, FEDERAL_UNIT_REFILLS_SQL, LAST_DRUG_TEST_SQL, saveClientFederalUnits, saveClientUnitRefills, unitsProblem } = require('../lib/federalUnits');

const router = express.Router();

// Discharge types a Business Administrator can pick; each becomes the client's program status
const DISCHARGE_STATUSES = ['Completed', 'Deceased', 'Discharged Supervision', 'Program Failed', 'Revoked', 'Transferred', 'Terminated'];

// SO clients can have a counselor's individual group as well as their regular group (Clients.IndividualGroupId)
const SO_PROGRAM_TYPES = ['State SO', 'Federal SO', 'Voluntary SO'];
// The individual group id from a request: { id } (null for none/blank), or { error } when it isn't an INDIVIDUAL group
const individualGroupFrom = async (value) => {
    if (value === undefined || value === null || value === '') return { id: null };
    const r = await pool.query('SELECT GroupId, ProgramType FROM Groups WHERE GroupId = $1', [Number(value)]);
    if (!r.rows.length || String(r.rows[0].programtype || '').trim().toUpperCase() !== 'INDIVIDUAL') {
        return { error: 'The individual group must be an Individual group.' };
    }
    return { id: r.rows[0].groupid };
};

// A client row as the roster and every client picker use it
const clientRowsSql = (where) => `
    SELECT
        c.*,
        g.GroupName,
        ig.GroupName AS IndividualGroupName,
        ${FEDERAL_UNITS_SQL('c.ClientId')} AS FederalUnits, ${FEDERAL_UNIT_REFILLS_SQL('c.ClientId')} AS FederalUnitRefills,
        CASE WHEN c.ProgramType = 'Fed Drug Test' THEN ${LAST_DRUG_TEST_SQL('c.ClientId')} END AS LastDrugTest,
        COALESCE(c.ProgramType, g.ProgramType, 'State SO') AS ProgramType,
        (SELECT Date FROM Attendance WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastAttended,
        (SELECT Date FROM PolygraphResults WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastPoly,
        ${ATTENDED_THIS_MONTH} AS AttendedThisMonth,
        ${FEE_ALREADY_CHARGED} AS FeeAlreadyCharged,
        ${ACTIVE_FEE_OVERRIDE} AS ActiveFeeOverride,
        ${BIP_CHECKIN_BLOCK} AS BipCheckInBlock
    FROM Clients c
    LEFT JOIN Groups g ON c.GroupId = g.GroupId
    LEFT JOIN Groups ig ON c.IndividualGroupId = ig.GroupId
    ${where}
    ORDER BY c.LastName ASC`;

// Without a status, current clients only (not discharged): discharged clients pile up over the years, so they are only
// sent when asked for. status: 'all', 'discharged' (any discharge status), or one program status.
// agent: only that supervising agent's clients, ignoring case and surrounding spaces like the agent directory.
router.get('/api/clients', async (req, res) => {
    try {
        const status = req.query.status ? String(req.query.status) : '';
        const conditions = [];
        const params = [];
        if (!status) {
            params.push(DISCHARGE_STATUSES);
            conditions.push(`c.ProgramStatus <> ALL($${params.length})`);
        } else if (status === 'discharged') {
            params.push(DISCHARGE_STATUSES);
            conditions.push(`c.ProgramStatus = ANY($${params.length})`);
        } else if (status !== 'all') {
            params.push(status);
            conditions.push(`c.ProgramStatus = $${params.length}`);
        }
        if (req.query.agent) {
            params.push(String(req.query.agent));
            conditions.push(`LOWER(TRIM(c.SupervisingAgent)) = LOWER(TRIM($${params.length}))`);
        }
        const result = await pool.query(clientRowsSql(conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''), params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// One client, for opening the account of a client who isn't in the current list (e.g. discharged)
router.get('/api/clients/:id', async (req, res) => {
    try {
        const result = await pool.query(clientRowsSql('WHERE c.ClientId = $1'), [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// No Poly Required: off by default; only a Business Administrator can change it. The change is noted on the client's case notes.
router.put('/api/clients/:id/no-poly-required', async (req, res) => {
    try {
        const { id } = req.params;
        const { noPolyRequired, user } = req.body;
        if (typeof noPolyRequired !== 'boolean') {
            return res.status(400).json({ error: 'noPolyRequired must be true or false.' });
        }
        const roleRes = await pool.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
        if (roleRes.rows[0]?.role !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can change No Poly Required.' });
        }
        const beforeRes = await pool.query('SELECT NoPolyRequired FROM Clients WHERE ClientId = $1', [id]);
        const result = await pool.query('UPDATE Clients SET NoPolyRequired = $1 WHERE ClientId = $2 RETURNING NoPolyRequired', [noPolyRequired, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found.' });
        }
        if (beforeRes.rows[0]?.nopolyrequired !== noPolyRequired) {
            await logClientChange(pool, {
                clientId: id, changedBy: user, changeType: 'No Poly Required',
                oldValue: beforeRes.rows[0]?.nopolyrequired ? 'Checked' : 'Unchecked', newValue: noPolyRequired ? 'Checked' : 'Unchecked',
                details: 'Business Administrator override.',
            });
        }
        await pool.query(
            `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, 'Polygraph')`,
            [id, user, `No Poly Required ${noPolyRequired ? 'checked' : 'unchecked'} by Business Administrator override.`]
        );
        await logAction(user, 'No Poly Required Changed', `Client ID ${id}: No Poly Required set to ${noPolyRequired}`);
        res.json({ success: true, noPolyRequired: result.rows[0].nopolyrequired });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Card payments blocked (Business Administrators only): stops the client paying by credit card, e.g. after a disputed
// card payment. Blocking needs a reason. Each change goes on the change log and the client's case notes.
router.put('/api/clients/:id/card-payments', requireRole('Business Administrator'), async (req, res) => {
    const db = await pool.connect();
    try {
        const { id } = req.params;
        const { blocked, user } = req.body;
        const reason = String(req.body.reason || '').trim();
        if (typeof blocked !== 'boolean') return res.status(400).json({ error: 'blocked must be true or false.' });
        if (blocked && !reason) return res.status(400).json({ error: 'Enter why card payments are being blocked.' });
        await db.query('BEGIN');
        const before = await db.query('SELECT CardPaymentsBlocked, CardBlockReason FROM Clients WHERE ClientId = $1 FOR UPDATE', [id]);
        if (before.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Client not found.' });
        }
        const result = await db.query(
            `UPDATE Clients SET CardPaymentsBlocked = $1,
                 CardBlockReason = CASE WHEN $1 THEN $2 ELSE NULL END,
                 CardBlockedBy = CASE WHEN $1 THEN $3 ELSE NULL END,
                 CardBlockedOn = CASE WHEN $1 THEN NOW() ELSE NULL END
             WHERE ClientId = $4
             RETURNING CardPaymentsBlocked, CardBlockReason, CardBlockedBy, CardBlockedOn`,
            [blocked, reason || null, user, id]
        );
        const was = before.rows[0];
        if (was.cardpaymentsblocked !== blocked || (blocked && was.cardblockreason !== reason)) {
            await logClientChange(db, {
                clientId: id, changedBy: user, changeType: 'Card Payments',
                oldValue: was.cardpaymentsblocked ? 'Blocked' : 'Allowed', newValue: blocked ? 'Blocked' : 'Allowed',
                details: reason || null,
            });
            await db.query(
                `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, 'Admin')`,
                [id, user, blocked
                    ? `Credit card payments blocked by a Business Administrator. Reason: ${reason}`
                    : `Credit card payments allowed again by a Business Administrator.${reason ? ` ${reason}` : ''}`]
            );
        }
        await db.query('COMMIT');
        await logAction(user, blocked ? 'Card Payments Blocked' : 'Card Payments Allowed', `Client ID ${id}${reason ? `: ${reason}` : ''}`);
        const row = result.rows[0];
        res.json({ cardpaymentsblocked: row.cardpaymentsblocked, cardblockreason: row.cardblockreason, cardblockedby: row.cardblockedby, cardblockedon: row.cardblockedon });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Grants one of a federal client's bus passes: takes it off their count and adds a Bus Pass case note with its number
router.post('/api/clients/:id/bus-pass', async (req, res) => {
    const { id } = req.params;
    const { busPassNumber, user } = req.body;
    const number = String(busPassNumber ?? '').trim();
    if (!number) return res.status(400).json({ error: 'Enter the bus pass number.' });
    if (number.length > 50) return res.status(400).json({ error: 'The bus pass number is too long.' });
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const c = (await db.query('SELECT FirstName, LastName, ProgramType, BusPasses FROM Clients WHERE ClientId = $1 FOR UPDATE', [id])).rows[0];
        const refuse = async (status, error) => { await db.query('ROLLBACK'); return res.status(status).json({ error }); };
        if (!c) return refuse(404, 'Client not found.');
        const name = `${c.lastname}, ${c.firstname}`;
        if (!FEDERAL_PROGRAM_TYPES.includes(c.programtype)) return refuse(400, `${name} is not a federal client. Only ${FEDERAL_PROGRAM_TYPES.slice(0, -1).join(', ')} and ${FEDERAL_PROGRAM_TYPES.at(-1)} clients get bus passes.`);
        if (Number(c.buspasses) <= 0) return refuse(400, `${name} has no bus passes left to grant.`);
        const left = Number(c.buspasses) - 1;
        await db.query('UPDATE Clients SET BusPasses = $1 WHERE ClientId = $2', [left, id]);
        const note = (await db.query(
            `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, 'Bus Pass') RETURNING *`,
            [id, user, `Bus pass #${number} granted. ${left} bus pass${left === 1 ? '' : 'es'} left.`])).rows[0];
        await logClientChange(db, {
            clientId: id, changedBy: user, changeType: 'Bus Passes', oldValue: String(c.buspasses), newValue: String(left),
            details: `Bus pass #${number} granted.`,
        });
        await db.query('COMMIT');
        await logAction(user, 'Bus Pass Granted', `Bus pass #${number} for ${name} (Client ID ${id}); ${left} left.`);
        res.status(201).json({ busPasses: left, note });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Statuses that can be set when adding or editing a client; the discharge statuses below are only set through discharge
const EDITABLE_PROGRAM_STATUSES = ['Active', 'Inactive'];
// Programs whose clients can be marked Pretrial; other programs' clients never are.
// Mirrors PRETRIAL_PROGRAM_TYPES in frontend/src/utils/clients.ts.
const PRETRIAL_PROGRAM_TYPES = ['Federal SO', 'Fed Drug Test'];

// Discharge types that require a subcategory; each discharge is kept in ClientDischarges for recidivism reporting
const DISCHARGE_SUBCATEGORIES = {
    'Program Failed': ['Attendance', 'Polys', 'Not Amenable'],
    'Revoked': ['Non Compliance', 'New SO Charge', 'New Criminal Charge'],
    'Terminated': ['Violence', 'New Criminal Charge'],
};

// Discharge (Business Administrators, from a non-discharged status) and Activate (any active employee, from a discharged status).
// Each sets the program status, adds a case note, and records the change log entry together.
const STATUS_ACTIONS = {
    discharge: {
        statuses: DISCHARGE_STATUSES, fromDischarged: false, adminOnly: true, recordsDischarge: true,
        category: 'Discharge', label: 'Discharge', details: 'Client discharged.', logAction: 'Client Discharged',
    },
    activate: {
        statuses: EDITABLE_PROGRAM_STATUSES, fromDischarged: true, adminOnly: false,
        category: 'Activation', label: 'Activation', details: 'Client activated.', logAction: 'Client Activated',
    },
};

const changeProgramStatus = (action) => async (req, res) => {
    const { id } = req.params;
    const { status, subcategory, note, user } = req.body;
    if (!action.statuses.includes(status)) {
        return res.status(400).json({ error: `Choose one of: ${action.statuses.join(', ')}.` });
    }
    const subcategories = action.recordsDischarge ? DISCHARGE_SUBCATEGORIES[status] : undefined;
    if (subcategories ? !subcategories.includes(subcategory) : subcategory) {
        return res.status(400).json({ error: subcategories ? `Choose a ${status} subcategory: ${subcategories.join(', ')}.` : `${status} has no subcategories.` });
    }
    if (typeof note !== 'string' || !note.trim()) {
        return res.status(400).json({ error: `A ${action.label.toLowerCase()} note is required.` });
    }
    const db = await pool.connect();
    try {
        const roleRes = await db.query('SELECT Role, DisplayName FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
        if (!roleRes.rows[0] || (action.adminOnly && roleRes.rows[0].role !== 'Business Administrator')) {
            return res.status(403).json({ error: action.adminOnly ? 'Only Business Administrators can discharge clients.' : 'Only active employees can activate clients.' });
        }
        await db.query('BEGIN');
        const beforeRes = await db.query('SELECT ProgramStatus FROM Clients WHERE ClientId = $1 FOR UPDATE', [id]);
        if (beforeRes.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Client not found.' });
        }
        const oldStatus = beforeRes.rows[0].programstatus;
        if (DISCHARGE_STATUSES.includes(oldStatus) !== action.fromDischarged) {
            await db.query('ROLLBACK');
            return res.status(409).json({ error: action.fromDischarged ? 'Only discharged clients can be activated.' : 'This client is already discharged.' });
        }
        await db.query('UPDATE Clients SET ProgramStatus = $1 WHERE ClientId = $2', [status, id]);
        const statusLabel = subcategory ? `${status} (${subcategory})` : status;
        await db.query(
            `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, $4)`,
            [id, user, `${action.label} - ${statusLabel}: ${note.trim()}`, action.category]
        );
        let summaryFileName;
        if (action.recordsDischarge) {
            const dischargeRes = await db.query(
                `INSERT INTO ClientDischarges (ClientId, DischargeType, Subcategory, Note, DischargedBy) VALUES ($1, $2, $3, $4, $5) RETURNING DischargedOn`,
                [id, status, subcategory || null, note.trim(), user]
            );
            // The discharge summary PDF is saved to the client's attachments in the same transaction
            const clientRes = await db.query(
                `SELECT c.*, g.GroupName, g.Counselor, COALESCE(c.ProgramType, g.ProgramType, 'State SO') AS ProgramType,
                        (SELECT Date FROM Attendance WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastAttended,
                        (SELECT Date FROM PolygraphResults WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastPoly
                 FROM Clients c LEFT JOIN Groups g ON c.GroupId = g.GroupId WHERE c.ClientId = $1`,
                [id]
            );
            const client = clientRes.rows[0];
            const dischargedOn = dischargeRes.rows[0].dischargedon;
            const pdf = await buildDischargeSummaryPdf({
                client, dischargeType: status, subcategory, note: note.trim(), dischargedOn, dischargedBy: roleRes.rows[0].displayname || user,
            });
            const day = `${dischargedOn.getFullYear()}-${String(dischargedOn.getMonth() + 1).padStart(2, '0')}-${String(dischargedOn.getDate()).padStart(2, '0')}`;
            summaryFileName = `Discharge Summary - ${client.firstname} ${client.lastname} - ${day}.pdf`;
            await db.query(
                `INSERT INTO ClientAttachments (ClientId, FileName, ContentType, FileSize, Data, UploadedBy) VALUES ($1, $2, 'application/pdf', $3, $4, $5)`,
                [id, summaryFileName.slice(0, 255), pdf.length, pdf, user]
            );
        }
        await logClientChange(db, {
            clientId: id, changedBy: user, changeType: 'Program Status',
            oldValue: oldStatus || 'None', newValue: status, details: subcategory ? `${action.details} Subcategory: ${subcategory}.` : action.details,
        });
        await db.query('COMMIT');
        await logAction(user, action.logAction, `Client ID ${id}: ${oldStatus || 'None'} to ${statusLabel}`);
        if (summaryFileName) await logAction(user, 'Add Attachment', `Client ID ${id}: ${summaryFileName}`);
        res.json({ success: true, programStatus: status, summaryFileName });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
};

router.post('/api/clients/:id/discharge', changeProgramStatus(STATUS_ACTIONS.discharge));
router.post('/api/clients/:id/activate', changeProgramStatus(STATUS_ACTIONS.activate));

router.get('/api/clients/:id/attendance', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            // Same-day attendances: the most recently recorded first
            // Assessments and individual sessions have no group; they show as e.g. "Assessment - Psychosexual Assessment"
            `SELECT a.*, COALESCE(g.GroupName, CASE WHEN a.Type IN ('Assessment', 'Individual') THEN a.Type || COALESCE(' - ' || st.Name, '') END) AS GroupName,
                    COALESCE(g.Schedule, CASE WHEN a.Provider IS NOT NULL THEN 'with ' || a.Provider END) AS GroupSchedule,
                    g.Counselor AS GroupCounselor
             FROM Attendance a LEFT JOIN Groups g ON a."Group" = g.GroupId LEFT JOIN SessionTypes st ON st.SessionTypeId = a.SessionTypeId
             WHERE a.Client = $1 ORDER BY a.Date DESC, a.AttendanceId DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/clients/:id/financials', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM FinancialTransactions WHERE Client = $1 ORDER BY Date DESC', [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/clients/:id/notes', async (req, res) => {
    try {
        const { id } = req.params;
        // Denied notes are kept for the record but no longer shown on the account
        const result = await pool.query(
            `SELECT * FROM Notes WHERE Client = $1 AND ApprovalStatus IS DISTINCT FROM 'Denied' ORDER BY Date DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/clients/:id/notes', async (req, res) => {
    try {
        const { id } = req.params;
        const { user, comments, category } = req.body;
        // Notes typed on the Case Notes tab are admin or therapist notes; the other categories are written by the system
        if (!['Admin', 'Therapist'].includes(category)) {
            return res.status(400).json({ error: 'Choose a note type: Admin Note or Therapist Note.' });
        }
        // A Counselor's note waits for a Business Administrator when the client hasn't attended this month
        // (their latest attendance of any kind is in an earlier month, or they have none). Role is from the session.
        let approvalStatus = null;
        if (req.user?.role === 'Counselor') {
            const attended = await pool.query(
                `SELECT EXISTS (SELECT 1 FROM Attendance WHERE Client = $1 AND date_trunc('month', Date) = date_trunc('month', CURRENT_DATE)) AS thisMonth`,
                [id]
            );
            if (!attended.rows[0].thismonth) approvalStatus = 'Pending';
        }
        const result = await pool.query(
            'INSERT INTO Notes (Client, Date, "User", Comments, Category, ApprovalStatus) VALUES ($1, NOW(), $2, $3, $4, $5) RETURNING *',
            [id, user, comments, category, approvalStatus]
        );
        await logAction(user, 'Add Note', `Added note to Client ID ${id}${approvalStatus ? ' (awaiting Business Administrator approval)' : ''}`);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A note can be changed by its author or by a Business Administrator
const noteForChange = async (noteId, user) => {
    const role = await activeRoleFor(user);
    const found = await pool.query('SELECT * FROM Notes WHERE NoteId = $1', [noteId]);
    const note = found.rows[0];
    if (!note) return { status: 404, error: 'Case note not found.' };
    const isAuthor = String(note.User || '').trim().toLowerCase() === String(user || '').trim().toLowerCase();
    if (!role || (role !== 'Business Administrator' && !isAuthor)) {
        return { status: 403, error: "Only the note's author or a Business Administrator can change this note." };
    }
    return { note };
};

router.put('/api/notes/:noteId', async (req, res) => {
    try {
        const { noteId } = req.params;
        const { user, comments } = req.body;
        if (!String(comments || '').trim()) {
            return res.status(400).json({ error: 'The note cannot be empty.' });
        }
        const check = await noteForChange(noteId, user);
        if (check.error) return res.status(check.status).json({ error: check.error });
        const result = await pool.query(
            'UPDATE Notes SET Comments = $1, EditedBy = $2, EditedOn = NOW() WHERE NoteId = $3 RETURNING *',
            [String(comments).trim(), user, noteId]
        );
        await logAction(user, 'Edit Note', `Edited note ${noteId} on Client ID ${check.note.client}. Previous text: ${check.note.comments}`);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Case notes awaiting approval, oldest first, with their client (Business Administrators only)
router.get('/api/notes/pending', requireRole('Business Administrator'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT n.*, c.FirstName, c.LastName, c.DOCNumber, c.DocType, c.ProgramType, e.DisplayName AS AuthorName,
                    (SELECT MAX(Date) FROM Attendance WHERE Client = n.Client) AS LastAttended
             FROM Notes n
             JOIN Clients c ON c.ClientId = n.Client
             LEFT JOIN EmployeeRoles e ON LOWER(e.EmployeeEmail) = LOWER(n."User")
             WHERE n.ApprovalStatus = 'Pending'
             ORDER BY c.LastName, c.FirstName, n.Date`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Approves or denies a pending note (Business Administrators only). Approving can save edited text with it.
router.post('/api/notes/:noteId/review', requireRole('Business Administrator'), async (req, res) => {
    try {
        const { noteId } = req.params;
        const { decision, comments, user } = req.body;
        if (!['approve', 'deny'].includes(decision)) return res.status(400).json({ error: 'Choose approve or deny.' });
        const found = await pool.query('SELECT * FROM Notes WHERE NoteId = $1', [noteId]);
        const note = found.rows[0];
        if (!note) return res.status(404).json({ error: 'Case note not found.' });
        if (note.approvalstatus !== 'Pending') return res.status(409).json({ error: `This note was already ${String(note.approvalstatus || 'reviewed').toLowerCase()}.` });
        const status = decision === 'approve' ? 'Approved' : 'Denied';
        const edited = decision === 'approve' && comments !== undefined && String(comments).trim() !== String(note.comments || '').trim();
        if (edited && !String(comments).trim()) return res.status(400).json({ error: 'The note cannot be empty.' });
        const result = await pool.query(
            `UPDATE Notes SET ApprovalStatus = $1, ReviewedBy = $2, ReviewedOn = NOW(),
                 Comments = CASE WHEN $3 THEN $4 ELSE Comments END,
                 EditedBy = CASE WHEN $3 THEN $2 ELSE EditedBy END,
                 EditedOn = CASE WHEN $3 THEN NOW() ELSE EditedOn END
             WHERE NoteId = $5 RETURNING *`,
            [status, user, edited, String(comments ?? '').trim(), noteId]
        );
        await logAction(user, `Note ${status}`, `${status} ${note.category || ''} note ${noteId} on Client ID ${note.client} by ${note.User}.`
            + (edited ? ` Edited before approval. Previous text: ${note.comments}` : ` Text: ${note.comments}`));
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/api/notes/:noteId', async (req, res) => {
    try {
        const { noteId } = req.params;
        const { user } = req.body;
        const check = await noteForChange(noteId, user);
        if (check.error) return res.status(check.status).json({ error: check.error });
        await pool.query('DELETE FROM Notes WHERE NoteId = $1', [noteId]);
        await logAction(user, 'Delete Note', `Deleted ${check.note.category || ''} note ${noteId} on Client ID ${check.note.client} by ${check.note.User}. Text: ${check.note.comments}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/clients/:id/polygraphs', async (req, res) => {
    try {
        const { id } = req.params;
        // PolygraphDateTime goes out as local wall-clock text so time zones cannot shift it
        const result = await pool.query(
            `SELECT ResultId, AppointmentId, Client, Date, Type, Results, Polygrapher, Notes,
                    to_char(PolygraphDateTime, 'YYYY-MM-DD"T"HH24:MI:SS') AS PolygraphDateTime
             FROM PolygraphResults WHERE Client = $1 ORDER BY COALESCE(PolygraphDateTime, Date) DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- CLIENT ATTACHMENTS ---
// Files are stored in the database. Uploads arrive as raw bytes (application/octet-stream, so the global JSON parser
// leaves them alone) with the name and real type in headers.
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

router.get('/api/clients/:id/attachments', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT AttachmentId, ClientId, FileName, ContentType, FileSize, UploadedBy, UploadedOn
             FROM ClientAttachments WHERE ClientId = $1 ORDER BY UploadedOn DESC, AttachmentId DESC`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/clients/:id/attachments', express.raw({ type: 'application/octet-stream', limit: ATTACHMENT_MAX_BYTES }), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.get('X-User') || '';
        const fileName = decodeURIComponent(req.get('X-File-Name') || '').trim();
        const contentType = req.get('X-File-Type') || 'application/octet-stream';
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            return res.status(400).json({ error: 'Choose a file to upload.' });
        }
        if (!fileName) {
            return res.status(400).json({ error: 'The file needs a name.' });
        }
        const roleRes = await pool.query('SELECT 1 FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
        if (roleRes.rows.length === 0) {
            return res.status(403).json({ error: 'Only active employees can add attachments.' });
        }
        const result = await pool.query(
            `INSERT INTO ClientAttachments (ClientId, FileName, ContentType, FileSize, Data, UploadedBy)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING AttachmentId, ClientId, FileName, ContentType, FileSize, UploadedBy, UploadedOn`,
            [id, fileName.slice(0, 255), contentType.slice(0, 255), req.body.length, req.body, user]
        );
        await logAction(user, 'Add Attachment', `Client ID ${id}: ${fileName}`);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Always sent as a download with nosniff; the browser decides whether to show it from the blob it builds
router.get('/api/attachments/:attachmentId', async (req, res) => {
    try {
        const result = await pool.query('SELECT FileName, ContentType, Data FROM ClientAttachments WHERE AttachmentId = $1', [req.params.attachmentId]);
        const file = result.rows[0];
        if (!file) {
            return res.status(404).json({ error: 'Attachment not found.' });
        }
        res.set({
            'Content-Type': file.contenttype,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
            'X-Content-Type-Options': 'nosniff',
        });
        res.send(file.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rename (any active employee). The original extension is kept so downloads still open in the right program.
router.patch('/api/attachments/:attachmentId', async (req, res) => {
    try {
        const { user } = req.body;
        let fileName = String(req.body.fileName || '').trim();
        if (!fileName) {
            return res.status(400).json({ error: 'Enter a name for the attachment.' });
        }
        const roleRes = await pool.query('SELECT 1 FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
        if (roleRes.rows.length === 0) {
            return res.status(403).json({ error: 'Only active employees can rename attachments.' });
        }
        const beforeRes = await pool.query('SELECT ClientId, FileName FROM ClientAttachments WHERE AttachmentId = $1', [req.params.attachmentId]);
        const before = beforeRes.rows[0];
        if (!before) {
            return res.status(404).json({ error: 'Attachment not found.' });
        }
        const extension = before.filename.match(/\.[^.\s]{1,10}$/)?.[0];
        if (extension && !fileName.toLowerCase().endsWith(extension.toLowerCase())) {
            fileName += extension;
        }
        const result = await pool.query(
            `UPDATE ClientAttachments SET FileName = $1 WHERE AttachmentId = $2
             RETURNING AttachmentId, ClientId, FileName, ContentType, FileSize, UploadedBy, UploadedOn`,
            [fileName.slice(0, 255), req.params.attachmentId]
        );
        await logAction(user, 'Rename Attachment', `Client ID ${before.clientid}: ${before.filename} to ${result.rows[0].filename}`);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Business Administrators only, so client records aren't lost by mistake
router.delete('/api/attachments/:attachmentId', async (req, res) => {
    try {
        const user = req.get('X-User') || '';
        const roleRes = await pool.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
        if (roleRes.rows[0]?.role !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can delete attachments.' });
        }
        const result = await pool.query('DELETE FROM ClientAttachments WHERE AttachmentId = $1 RETURNING ClientId, FileName', [req.params.attachmentId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Attachment not found.' });
        }
        await logAction(user, 'Delete Attachment', `Client ID ${result.rows[0].clientid}: ${result.rows[0].filename}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Choices for the client's Race and Sex fields (both optional)
const CLIENT_RACES = ['American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino', 'Native Hawaiian or Other Pacific Islander', 'White', 'Two or More Races', 'Other'];
const CLIENT_SEXES = ['Male', 'Female'];

// Update Client Information
router.put('/api/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            firstname, middlename, lastname, docnumber, supervisingagent,
            programstartdate, programstatus, phase, groupid,
            treatmentfee, accountbalance, vouchers, polyfeevoucher, polyfeepaid, polyfee,
            address, city, county, state, zip,
            mainphone, altphone, emergencycontact, emergencycontactphone,
            comments, programtype, race, dateofbirth, sex, pretrial, assessor, buspasses, buspassrefill, updatedBy,
            individualgroupid, federalunits, federalunitrefills, copay, doctype
        } = req.body;
        // The ID #'s kind (DOC, PACTS, ...): changed only when sent; blank clears it
        if (doctype !== undefined && doctype !== null && doctype !== '' && !ID_TYPES.includes(doctype)) {
            return res.status(400).json({ error: `ID # type must be one of: ${ID_TYPES.join(', ')}.` });
        }
        // Federal clients' copay for individual sessions: changed only when sent; blank clears it
        const copayValue = copay === undefined || copay === null || copay === '' ? null : Math.round(Number(copay) * 100) / 100;
        if (copayValue !== null && !(Number.isFinite(copayValue) && copayValue >= 0)) {
            return res.status(400).json({ error: 'Copay must be $0.00 or more, or blank.' });
        }
        // Bus passes and the monthly refill: whole numbers from 0 to BUS_PASS_MAX, changed only when sent
        const passCount = (value) => (value === undefined || value === null || value === '' ? null : Number(value));
        const busPasses = passCount(buspasses);
        const busPassRefill = passCount(buspassrefill);
        for (const [label, value] of [['Bus passes', busPasses], ['The monthly bus pass refill', busPassRefill]]) {
            if (value !== null && (!Number.isInteger(value) || value < 0 || value > BUS_PASS_MAX)) {
                return res.status(400).json({ error: `${label} must be a whole number from 0 to ${BUS_PASS_MAX}.` });
            }
        }

        if (race && !CLIENT_RACES.includes(race)) {
            return res.status(400).json({ error: `Race must be one of: ${CLIENT_RACES.join(', ')}.` });
        }
        if (sex && !CLIENT_SEXES.includes(sex)) {
            return res.status(400).json({ error: `Sex must be one of: ${CLIENT_SEXES.join(', ')}.` });
        }
        if (dateofbirth && String(dateofbirth).split('T')[0] > new Date().toISOString().split('T')[0]) {
            return res.status(400).json({ error: 'Date of birth cannot be in the future.' });
        }

        // Federal billing units: { code: units }, a blank clears one; checked before anything is saved
        for (const sent of [federalunits, federalunitrefills]) {
            if (!sent || typeof sent !== 'object') continue;
            const unitProblem = Object.entries(sent).map(([code, value]) => unitsProblem(code, value)).find(Boolean);
            if (unitProblem) return res.status(400).json({ error: unitProblem });
        }

        // The individual group must be an INDIVIDUAL group; changed only when sent (an empty value clears it)
        const individualGroup = await individualGroupFrom(individualgroupid);
        if (individualGroup.error) return res.status(400).json({ error: individualGroup.error });

        // Tracked fields before the edit, for the change log
        const beforeRes = await pool.query('SELECT DocType, DOCNumber, Copay, ProgramStatus, ProgramType, SupervisingAgent, GroupId, IndividualGroupId, PolyFee, PolyFeePaid, PolyFeeVoucher, Phase, Pretrial, Assessor, BusPasses, BusPassRefill FROM Clients WHERE ClientId = $1', [id]);
        const before = beforeRes.rows[0];

        // The full set of poly fee vouchers depends on the phase the client will be in after this edit. A count sent back
        // unchanged may be over a new phase's full set; the UPDATE below trims it.
        const fullSet = polyVoucherMax(phase || before?.phase);
        const polyVoucher = polyfeevoucher !== undefined && polyfeevoucher !== null && polyfeevoucher !== '' ? Number(polyfeevoucher) : null;
        if (polyVoucher !== null && (!Number.isInteger(polyVoucher) || polyVoucher < 0
            || (polyVoucher > fullSet && polyVoucher !== Number(before?.polyfeevoucher)))) {
            return res.status(400).json({ error: `Poly fee voucher must be a whole number from 0 to ${fullSet}.` });
        }
        // The poly fee total belongs to the override while one is active
        const polyOverride = await activePolyFeeOverride(pool, id);
        if (polyOverride && polyfee !== undefined && polyfee !== null && polyfee !== '' && Number(polyfee) !== Number(before?.polyfee)) {
            return res.status(400).json({ error: 'A temporary poly fee override is active. Change or remove the override to change the poly fee total.' });
        }
        if (programstatus && programstatus !== before?.programstatus) {
            if (DISCHARGE_STATUSES.includes(before?.programstatus)) {
                return res.status(400).json({ error: 'Program status is locked while the client is discharged. Use the Activate button.' });
            }
            if (!EDITABLE_PROGRAM_STATUSES.includes(programstatus)) {
                return res.status(400).json({ error: `Program status can only be changed to ${EDITABLE_PROGRAM_STATUSES.join(' or ')} here. Use the Discharge button for ${programstatus}.` });
            }
        }

        await pool.query(
            `UPDATE Clients SET 
                FirstName = COALESCE($1, FirstName),
                MiddleName = $2,
                LastName = COALESCE($3, LastName),
                DOCNumber = COALESCE($4, DOCNumber),
                SupervisingAgent = COALESCE($5, SupervisingAgent),
                ProgramStartDate = $6,
                ProgramStatus = COALESCE($7, ProgramStatus),
                Phase = COALESCE($8, Phase),
                GroupId = $9,
                TreatmentFee = COALESCE($10, TreatmentFee),
                AccountBalance = COALESCE($11, AccountBalance),
                Vouchers = COALESCE($12, Vouchers),
                Address = $13,
                City = $14,
                County = $15,
                State = $16,
                Zip = $17,
                MainPhone = $18,
                AltPhone = $19,
                EmergencyContact = $20,
                EmergencyContactPhone = $21,
                Comments = $22,
                ProgramType = COALESCE($23, ProgramType),
                -- Right-hand columns are the pre-update values: fill the vouchers when this edit makes the poly fee paid in full,
                -- and never leave more than the full set for the client's phase after the edit
                PolyFeeVoucher = CASE
                    WHEN PolyFeePaid < PolyFee AND COALESCE($26, PolyFeePaid) >= COALESCE($27, PolyFee) THEN ${POLY_VOUCHER_MAX_SQL('COALESCE($8, Phase)')}
                    ELSE LEAST(COALESCE($25, PolyFeeVoucher), ${POLY_VOUCHER_MAX_SQL('COALESCE($8, Phase)')})
                END,
                PolyVouchersBeforeFill = CASE
                    WHEN PolyFeePaid < PolyFee AND COALESCE($26, PolyFeePaid) >= COALESCE($27, PolyFee) THEN PolyFeeVoucher
                    ELSE PolyVouchersBeforeFill
                END,
                PolyFeePaid = COALESCE($26, PolyFeePaid),
                PolyFee = COALESCE($27, PolyFee),
                Race = $28,
                DateOfBirth = $29,
                Sex = $30,
                -- Kept only while the client's program (after this edit) is one that has pretrial clients
                Pretrial = COALESCE($31, Pretrial) AND COALESCE($23, ProgramType) = ANY($32::text[]),
                -- Changed only when the request sends it (an empty value clears it)
                Assessor = CASE WHEN $33::boolean THEN $34 ELSE Assessor END,
                BusPasses = COALESCE($35, BusPasses),
                BusPassRefill = COALESCE($36, BusPassRefill),
                -- Only SO clients (after this edit) have an individual group
                IndividualGroupId = CASE WHEN COALESCE($23, ProgramType) = ANY($39::text[])
                    THEN (CASE WHEN $37::boolean THEN $38::int ELSE IndividualGroupId END) ELSE NULL END,
                -- Federal clients only (after this edit); changed only when sent
                Copay = CASE WHEN COALESCE($23, ProgramType) = ANY($42::text[])
                    THEN (CASE WHEN $40::boolean THEN $41::numeric ELSE Copay END) ELSE NULL END,
                DocType = CASE WHEN $43::boolean THEN $44::text ELSE DocType END
            WHERE ClientId = $24`,
            [
                firstname || null, middlename || null, lastname || null, docnumber || null, supervisingagent || null,
                programstartdate || null, programstatus || null, phase || null, groupid ? Number(groupid) : null,
                treatmentfee !== undefined && treatmentfee !== null && treatmentfee !== '' ? Number(treatmentfee) : null,
                accountbalance !== undefined && accountbalance !== null && accountbalance !== '' ? Number(accountbalance) : null,
                vouchers !== undefined && vouchers !== null && vouchers !== '' ? Number(vouchers) : null,
                address || null, city || null, county || null, state || null, zip || null,
                mainphone || null, altphone || null, emergencycontact || null, emergencycontactphone || null,
                comments || null, programtype || null, id,
                polyVoucher,
                polyfeepaid !== undefined && polyfeepaid !== null && polyfeepaid !== '' ? Number(polyfeepaid) : null,
                polyfee !== undefined && polyfee !== null && polyfee !== '' ? Number(polyfee) : null,
                race || null, dateofbirth || null, sex || null,
                typeof pretrial === 'boolean' ? pretrial : null, PRETRIAL_PROGRAM_TYPES,
                assessor !== undefined, String(assessor ?? '').trim() || null,
                busPasses, busPassRefill,
                individualgroupid !== undefined, individualGroup.id, SO_PROGRAM_TYPES,
                copay !== undefined, copayValue, FEDERAL_PROGRAM_TYPES,
                doctype !== undefined, doctype || null,
            ]
        );

        // Units are kept for the codes of the client's program after this edit
        const programNow = (await pool.query('SELECT ProgramType FROM Clients WHERE ClientId = $1', [id])).rows[0]?.programtype;
        await saveClientFederalUnits(pool, { clientId: id, programType: programNow, units: federalunits, changedBy: updatedBy });
        await saveClientUnitRefills(pool, { clientId: id, programType: programNow, refills: federalunitrefills, changedBy: updatedBy });

        const updated = await pool.query(
            `SELECT c.*, g.GroupName, ig.GroupName AS IndividualGroupName, ${FEDERAL_UNITS_SQL('c.ClientId')} AS FederalUnits, ${FEDERAL_UNIT_REFILLS_SQL('c.ClientId')} AS FederalUnitRefills, COALESCE(c.ProgramType, g.ProgramType, 'State SO') AS ProgramType,
                    (SELECT Date FROM Attendance WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastAttended,
                    (SELECT Date FROM PolygraphResults WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastPoly
             FROM Clients c
             LEFT JOIN Groups g ON c.GroupId = g.GroupId
             LEFT JOIN Groups ig ON c.IndividualGroupId = ig.GroupId
             WHERE c.ClientId = $1`,
            [id]
        );

        if (before && updated.rows[0]) {
            const after = await pool.query('SELECT DocType, DOCNumber, Copay, ProgramStatus, ProgramType, SupervisingAgent, GroupId, IndividualGroupId, Pretrial, Assessor, BusPasses, BusPassRefill FROM Clients WHERE ClientId = $1', [id]);
            const now = after.rows[0];
            // An edit that makes the poly fee paid in full filled the vouchers (see the CASE above); that counts toward an override
            const wasFull = Number(before.polyfee) > 0 && Number(before.polyfeepaid) >= Number(before.polyfee);
            const isFull = Number(updated.rows[0].polyfee) > 0 && Number(updated.rows[0].polyfeepaid) >= Number(updated.rows[0].polyfee);
            if (!wasFull && isFull) await countPolyFeeFill(pool, id, 1);
            // A phase change that trims the vouchers to the new phase's full set goes on the change log
            const vouchersBefore = Number(before.polyfeevoucher || 0);
            const vouchersAfter = Number(updated.rows[0].polyfeevoucher || 0);
            if ((before.phase || '') !== (updated.rows[0].phase || '') && vouchersBefore > fullSet && vouchersAfter < vouchersBefore) {
                await logClientChange(pool, {
                    clientId: id, changedBy: updatedBy, changeType: 'Poly Fee Vouchers',
                    oldValue: String(vouchersBefore), newValue: String(vouchersAfter),
                    details: `Phase changed to ${updated.rows[0].phase}: poly fee vouchers trimmed to its full set of ${fullSet}.`,
                });
            }
            const tracked = [
                ['ID #', idText(before), idText(now)],
                ['Program Status', before.programstatus, now.programstatus],
                ['Program Type', before.programtype, now.programtype],
                ['Supervising Agent', before.supervisingagent, now.supervisingagent],
                ['Assessor', before.assessor, now.assessor],
                ['Bus Passes', String(before.buspasses ?? 0), String(now.buspasses ?? 0)],
                ['Bus Pass Refill', String(before.buspassrefill ?? 0), String(now.buspassrefill ?? 0)],
                ['Copay', before.copay === null ? '' : `$${Number(before.copay).toFixed(2)}`, now.copay === null ? '' : `$${Number(now.copay).toFixed(2)}`],
            ];
            for (const [changeType, oldValue, newValue] of tracked) {
                if ((oldValue || '') !== (newValue || '')) {
                    await logClientChange(pool, { clientId: id, changedBy: updatedBy, changeType, oldValue: oldValue || 'None', newValue: newValue || 'None' });
                }
            }
            if (!!before.pretrial !== !!now.pretrial) {
                await logClientChange(pool, {
                    clientId: id, changedBy: updatedBy, changeType: 'Pretrial',
                    oldValue: before.pretrial ? 'Checked' : 'Unchecked', newValue: now.pretrial ? 'Checked' : 'Unchecked',
                    details: !now.pretrial && pretrial === true ? `Cleared: ${now.programtype} clients are not pretrial.` : undefined,
                });
            }
            if ((before.groupid || null) !== (now.groupid || null)) {
                await logClientChange(pool, {
                    clientId: id, changedBy: updatedBy, changeType: 'Group',
                    oldValue: await groupNameFor(before.groupid), newValue: await groupNameFor(now.groupid),
                });
            }
            if ((before.individualgroupid || null) !== (now.individualgroupid || null)) {
                await logClientChange(pool, {
                    clientId: id, changedBy: updatedBy, changeType: 'Individual Group',
                    oldValue: await groupNameFor(before.individualgroupid), newValue: await groupNameFor(now.individualgroupid),
                });
            }
        }

        res.json({ success: true, client: updated.rows[0] });
    } catch (err) {
        // 23505 = unique_violation: another client has this ID # and type
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Another client already has this ID # (same type and number).' });
        }
        console.error('Error updating client:', err);
        res.status(500).json({ error: err.message });
    }
});

// Create a new client. Starts with a zero balance, zero vouchers, and the default program type.
router.post('/api/clients', async (req, res) => {
    try {
        const {
            firstname, middlename, lastname, docnumber, supervisingagent,
            programstartdate, programstatus, phase, groupid,
            address, city, county, state, zip,
            mainphone, altphone, emergencycontact, emergencycontactphone,
            comments, programtype, treatmentfee, vouchers, pretrial, createdBy, individualgroupid, doctype
        } = req.body;
        if (doctype && !ID_TYPES.includes(doctype)) {
            return res.status(400).json({ error: `ID # type must be one of: ${ID_TYPES.join(', ')}.` });
        }
        const individualGroup = await individualGroupFrom(individualgroupid);
        if (individualGroup.error) return res.status(400).json({ error: individualGroup.error });
        const individualGroupId = SO_PROGRAM_TYPES.includes(programtype) ? individualGroup.id : null;

        // BIP clients have no phase; they store a whole-number week in the same column. New BIP clients always start at week 0.
        const clientPhase = programtype === 'BIP' ? '0' : phase;
        const isPretrial = pretrial === true && PRETRIAL_PROGRAM_TYPES.includes(programtype);

        // ID # and supervising agent are optional; blanks are stored as NULL so the unique ID # index allows many of them
        const required = {
            'First name': firstname, 'Last name': lastname, 'Program type': programtype,
            'Program start date': programstartdate, 'Program status': programstatus, Phase: clientPhase
        };
        const missing = Object.entries(required).filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
        if (missing.length > 0) {
            return res.status(400).json({ error: `Required: ${missing.join(', ')}.` });
        }
        if (!EDITABLE_PROGRAM_STATUSES.includes(programstatus)) {
            return res.status(400).json({ error: `New clients must be ${EDITABLE_PROGRAM_STATUSES.join(' or ')}.` });
        }

        const result = await pool.query(
            `INSERT INTO Clients (
                FirstName, MiddleName, LastName, DOCNumber, SupervisingAgent,
                ProgramStartDate, ProgramStatus, Phase, GroupId,
                Address, City, County, State, Zip,
                MainPhone, AltPhone, EmergencyContact, EmergencyContactPhone,
                Comments, ProgramType, TreatmentFee, Vouchers, Pretrial, IndividualGroupId, DocType
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, $11, $12, $13, $14,
                $15, $16, $17, $18,
                $19, COALESCE($20, 'State SO'), COALESCE($21, 0), COALESCE($22, 0), $23, $24, $25
            ) RETURNING ClientId`,
            [
                firstname.trim(), middlename?.trim() || null, lastname.trim(), docnumber?.trim() || null, supervisingagent?.trim() || null,
                programstartdate, programstatus, clientPhase.trim(), groupid ? Number(groupid) : null,
                address || null, city || null, county || null, state || null, zip || null,
                mainphone || null, altphone || null, emergencycontact || null, emergencycontactphone || null,
                comments || null, programtype || null,
                treatmentfee !== undefined && treatmentfee !== null && treatmentfee !== '' ? Number(treatmentfee) : null,
                vouchers !== undefined && vouchers !== null && vouchers !== '' ? Number(vouchers) : null,
                isPretrial, individualGroupId, doctype || null
            ]
        );
        await logClientChange(pool, {
            clientId: result.rows[0].clientid, changedBy: createdBy, changeType: 'Client Created',
            details: `Created as ${programtype}${isPretrial ? ' (Pretrial)' : ''}, ${programstatus}, group: ${await groupNameFor(groupid ? Number(groupid) : null)}`
                + `${individualGroupId ? `, individual group: ${await groupNameFor(individualGroupId)}` : ''}`
                + `${supervisingagent?.trim() ? `, agent: ${supervisingagent.trim()}` : ''}.`,
        });
        res.status(201).json({ success: true, clientId: result.rows[0].clientid, message: 'Client added successfully.' });
    } catch (err) {
        // 23505 = unique_violation: the ID # (same type and number) is already on file
        if (err.code === '23505') {
            return res.status(409).json({ error: 'A client with this ID # (same type and number) already exists.' });
        }
        console.error('Error creating client:', err);
        res.status(500).json({ error: err.message });
    }
});

// Whether a client could be deleted right now: tries the delete in a transaction that is always rolled back, so the answer
// follows the database's own rules (records that would be removed with the client don't block it; attendance, notes and
// other kept records do). Used to show the Delete button only when it would work.
router.get('/api/clients/:id/deletable', requireRole('Business Administrator'), async (req, res) => {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const result = await db.query('DELETE FROM Clients WHERE ClientId = $1 RETURNING ClientId', [req.params.id]);
        res.json({ deletable: result.rows.length > 0 });
    } catch (err) {
        if (err.code === '23503') return res.json({ deletable: false, blockedBy: err.table || null });
        res.status(500).json({ error: err.message });
    } finally {
        await db.query('ROLLBACK').catch(() => {});
        db.release();
    }
});

// Delete a client (Business Administrators only)
router.delete('/api/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userEmail = req.headers['x-user-email'] || 'unknown';

        // Check user role
        const userResult = await pool.query(
            'SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE',
            [userEmail]
        );
        const userRole = userResult.rows[0]?.role;
        if (userRole !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can delete clients.' });
        }

        const result = await pool.query('DELETE FROM Clients WHERE ClientId = $1 RETURNING ClientId', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Client not found.' });
        }

        await logAction(userEmail, 'Client Deleted', `Deleted client ID ${id}`, 'Audit');
        res.json({ success: true, message: 'Client deleted successfully.' });
    } catch (err) {
        // 23503 = foreign_key_violation: attendance, notes, or other records still reference this client
        if (err.code === '23503') {
            return res.status(409).json({ error: 'This client has attendance records, notes, or other data that cannot be automatically removed. Contact an administrator for assistance.' });
        }
        console.error('Error deleting client:', err);
        res.status(500).json({ error: 'Failed to delete client.' });
    }
});

// Fee override expirations are not stored; each one is listed the day after its ExpiresOn,
// unless the override was changed or removed before then.
router.get('/api/clients/:id/change-log', async (req, res) => {
    try {
        const { id } = req.params;
        const roleRes = await pool.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [req.query.user]);
        if (roleRes.rows[0]?.role !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can view the change log.' });
        }
        const result = await pool.query(
            `SELECT ChangeId, ChangedOn, ChangedBy, ChangeType, OldValue, NewValue, Details
             FROM ClientChangeLog WHERE ClientId = $1
             UNION ALL
             SELECT NULL, (x.ExpiresOn + 1)::timestamp, 'System', 'Fee Override', x.NewValue, 'Expired',
                    'Temporary fee override expired; the regular treatment fee applies again.'
             FROM (
                 SELECT ExpiresOn, NewValue, LEAD(ChangedOn) OVER (ORDER BY ChangedOn, ChangeId) AS NextChange
                 FROM ClientChangeLog WHERE ClientId = $1 AND ChangeType = 'Fee Override'
             ) x
             WHERE x.ExpiresOn IS NOT NULL AND x.ExpiresOn < CURRENT_DATE AND (x.NextChange IS NULL OR x.NextChange::date > x.ExpiresOn)
             ORDER BY ChangedOn DESC, ChangeId DESC NULLS LAST`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
