const express = require('express');
const { buildDischargeSummaryPdf } = require('../dischargeSummary');
const { logAction, pool } = require('../db');
const { activeRoleFor } = require('../lib/access');
const { requireRole } = require('../lib/auth');
const { groupNameFor, logClientChange } = require('../lib/changeLog');
const { POLY_VOUCHER_MAX, activePolyFeeOverride, countPolyFeeFill } = require('../lib/poly');
const { ACTIVE_FEE_OVERRIDE, ATTENDED_THIS_MONTH, BIP_CHECKIN_BLOCK } = require('../lib/sql');

const router = express.Router();

router.get('/api/clients', async (req, res) => {
    try {
        const query = `
            SELECT 
                c.*, 
                g.GroupName, 
                COALESCE(c.ProgramType, g.ProgramType, 'State SO') AS ProgramType,
                (SELECT Date FROM Attendance WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastAttended,
                (SELECT Date FROM PolygraphResults WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastPoly,
                ${ATTENDED_THIS_MONTH} AS AttendedThisMonth,
                ${ACTIVE_FEE_OVERRIDE} AS ActiveFeeOverride,
                ${BIP_CHECKIN_BLOCK} AS BipCheckInBlock
            FROM Clients c
            LEFT JOIN Groups g ON c.GroupId = g.GroupId
            ORDER BY c.LastName ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
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

// Statuses that can be set when adding or editing a client; the discharge statuses below are only set through discharge
const EDITABLE_PROGRAM_STATUSES = ['Active', 'Inactive'];

// Discharge types a Business Administrator can pick; each becomes the client's program status
const DISCHARGE_STATUSES = ['Completed', 'Deceased', 'Discharged Supervision', 'Program Failed', 'Revoked', 'Transferred', 'Terminated'];
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
                    COALESCE(g.Schedule, CASE WHEN a.Provider IS NOT NULL THEN 'with ' || a.Provider END) AS GroupSchedule
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
            `SELECT n.*, c.FirstName, c.LastName, c.DOCNumber, c.ProgramType, e.DisplayName AS AuthorName,
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
            comments, programtype, race, dateofbirth, sex, updatedBy
        } = req.body;

        if (race && !CLIENT_RACES.includes(race)) {
            return res.status(400).json({ error: `Race must be one of: ${CLIENT_RACES.join(', ')}.` });
        }
        if (sex && !CLIENT_SEXES.includes(sex)) {
            return res.status(400).json({ error: `Sex must be one of: ${CLIENT_SEXES.join(', ')}.` });
        }
        if (dateofbirth && String(dateofbirth).split('T')[0] > new Date().toISOString().split('T')[0]) {
            return res.status(400).json({ error: 'Date of birth cannot be in the future.' });
        }

        const polyVoucher = polyfeevoucher !== undefined && polyfeevoucher !== null && polyfeevoucher !== '' ? Number(polyfeevoucher) : null;
        if (polyVoucher !== null && (!Number.isInteger(polyVoucher) || polyVoucher < 0 || polyVoucher > POLY_VOUCHER_MAX)) {
            return res.status(400).json({ error: `Poly fee voucher must be a whole number from 0 to ${POLY_VOUCHER_MAX}.` });
        }

        // Tracked fields before the edit, for the change log
        const beforeRes = await pool.query('SELECT ProgramStatus, ProgramType, SupervisingAgent, GroupId, PolyFee, PolyFeePaid FROM Clients WHERE ClientId = $1', [id]);
        const before = beforeRes.rows[0];
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
                -- Right-hand columns are the pre-update values: fill the vouchers when this edit makes the poly fee paid in full
                PolyFeeVoucher = CASE
                    WHEN PolyFeePaid < PolyFee AND COALESCE($26, PolyFeePaid) >= COALESCE($27, PolyFee) THEN ${POLY_VOUCHER_MAX}
                    ELSE COALESCE($25, PolyFeeVoucher)
                END,
                PolyVouchersBeforeFill = CASE
                    WHEN PolyFeePaid < PolyFee AND COALESCE($26, PolyFeePaid) >= COALESCE($27, PolyFee) THEN PolyFeeVoucher
                    ELSE PolyVouchersBeforeFill
                END,
                PolyFeePaid = COALESCE($26, PolyFeePaid),
                PolyFee = COALESCE($27, PolyFee),
                Race = $28,
                DateOfBirth = $29,
                Sex = $30
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
                race || null, dateofbirth || null, sex || null
            ]
        );

        const updated = await pool.query(
            `SELECT c.*, g.GroupName, COALESCE(c.ProgramType, g.ProgramType, 'State SO') AS ProgramType,
                    (SELECT Date FROM Attendance WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastAttended,
                    (SELECT Date FROM PolygraphResults WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastPoly
             FROM Clients c
             LEFT JOIN Groups g ON c.GroupId = g.GroupId
             WHERE c.ClientId = $1`,
            [id]
        );

        if (before && updated.rows[0]) {
            const after = await pool.query('SELECT ProgramStatus, ProgramType, SupervisingAgent, GroupId FROM Clients WHERE ClientId = $1', [id]);
            const now = after.rows[0];
            // An edit that makes the poly fee paid in full filled the vouchers (see the CASE above); that counts toward an override
            const wasFull = Number(before.polyfee) > 0 && Number(before.polyfeepaid) >= Number(before.polyfee);
            const isFull = Number(updated.rows[0].polyfee) > 0 && Number(updated.rows[0].polyfeepaid) >= Number(updated.rows[0].polyfee);
            if (!wasFull && isFull) await countPolyFeeFill(pool, id, 1);
            const tracked = [
                ['Program Status', before.programstatus, now.programstatus],
                ['Program Type', before.programtype, now.programtype],
                ['Supervising Agent', before.supervisingagent, now.supervisingagent],
            ];
            for (const [changeType, oldValue, newValue] of tracked) {
                if ((oldValue || '') !== (newValue || '')) {
                    await logClientChange(pool, { clientId: id, changedBy: updatedBy, changeType, oldValue: oldValue || 'None', newValue: newValue || 'None' });
                }
            }
            if ((before.groupid || null) !== (now.groupid || null)) {
                await logClientChange(pool, {
                    clientId: id, changedBy: updatedBy, changeType: 'Group',
                    oldValue: await groupNameFor(before.groupid), newValue: await groupNameFor(now.groupid),
                });
            }
        }

        res.json({ success: true, client: updated.rows[0] });
    } catch (err) {
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
            comments, programtype, treatmentfee, vouchers, createdBy
        } = req.body;

        // BIP clients have no phase; they store a whole-number week in the same column. New BIP clients always start at week 0.
        const clientPhase = programtype === 'BIP' ? '0' : phase;

        // DOC # and supervising agent are optional; blanks are stored as NULL so the unique DOC # index allows many of them
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
                Comments, ProgramType, TreatmentFee, Vouchers
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, $11, $12, $13, $14,
                $15, $16, $17, $18,
                $19, COALESCE($20, 'State SO'), COALESCE($21, 0), COALESCE($22, 0)
            ) RETURNING ClientId`,
            [
                firstname.trim(), middlename?.trim() || null, lastname.trim(), docnumber?.trim() || null, supervisingagent?.trim() || null,
                programstartdate, programstatus, clientPhase.trim(), groupid ? Number(groupid) : null,
                address || null, city || null, county || null, state || null, zip || null,
                mainphone || null, altphone || null, emergencycontact || null, emergencycontactphone || null,
                comments || null, programtype || null,
                treatmentfee !== undefined && treatmentfee !== null && treatmentfee !== '' ? Number(treatmentfee) : null,
                vouchers !== undefined && vouchers !== null && vouchers !== '' ? Number(vouchers) : null
            ]
        );
        await logClientChange(pool, {
            clientId: result.rows[0].clientid, changedBy: createdBy, changeType: 'Client Created',
            details: `Created as ${programtype}, ${programstatus}, group: ${await groupNameFor(groupid ? Number(groupid) : null)}`
                + `${supervisingagent?.trim() ? `, agent: ${supervisingagent.trim()}` : ''}.`,
        });
        res.status(201).json({ success: true, clientId: result.rows[0].clientid, message: 'Client added successfully.' });
    } catch (err) {
        // 23505 = unique_violation: DOC # is already on file
        if (err.code === '23505') {
            return res.status(409).json({ error: 'A client with this DOC # already exists.' });
        }
        console.error('Error creating client:', err);
        res.status(500).json({ error: err.message });
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
