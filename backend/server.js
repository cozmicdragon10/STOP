const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();
const { hashPassword, verifyPassword } = require('./passwords');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring client', err.stack);
    }
    console.log('Connected to PostgreSQL database successfully.');
    release();
});

// Helper for Logging
const logAction = async (userEmail, action, details, type = 'Audit') => {
    try {
        await pool.query(
            'INSERT INTO SystemLogs (UserEmail, Action, Details, Type) VALUES ($1, $2, $3, $4)',
            [userEmail, action, details, type]
        );
    } catch (err) {
        console.error('Failed to log action:', err);
    }
};

// --- AUTHENTICATION & ROLE LOOKUP ---
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE',
            [email]
        );
        const row = result.rows[0];
        const passwordOk = row ? await verifyPassword(password || '', row.passwordhash) : false;
        if (!passwordOk) {
            await logAction(email, 'Login Failed', 'Incorrect password, unauthorized, or inactive user login attempt', 'Login');
            return res.status(403).json({ error: 'Email or password is incorrect, or the account is inactive.' });
        }
        await logAction(email, 'User Login', 'User logged in successfully', 'Login');
        // Never send the password hash to the browser
        const { passwordhash, ...user } = row;
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- CLIENT ROSTER & LOGS ---
// True when the client already has an attendance row in the current calendar month.
// Used for the State SO Phase 1 rule: the treatment fee is charged once per month.
const ATTENDED_THIS_MONTH = `EXISTS (SELECT 1 FROM Attendance a WHERE a.Client = c.ClientId AND date_trunc('month', a.Date) = date_trunc('month', CURRENT_DATE))`;

app.get('/api/clients', async (req, res) => {
    try {
        const query = `
            SELECT 
                c.*, 
                g.GroupName, 
                COALESCE(c.ProgramType, g.ProgramType, 'State SO') AS ProgramType,
                (SELECT Date FROM Attendance WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastAttended,
                (SELECT Date FROM PolygraphResults WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastPoly,
                ${ATTENDED_THIS_MONTH} AS AttendedThisMonth,
                ${ACTIVE_FEE_OVERRIDE} AS ActiveFeeOverride
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
app.put('/api/clients/:id/no-poly-required', async (req, res) => {
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
        const roleRes = await db.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
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
        if (action.recordsDischarge) {
            await db.query(
                `INSERT INTO ClientDischarges (ClientId, DischargeType, Subcategory, Note, DischargedBy) VALUES ($1, $2, $3, $4, $5)`,
                [id, status, subcategory || null, note.trim(), user]
            );
        }
        await logClientChange(db, {
            clientId: id, changedBy: user, changeType: 'Program Status',
            oldValue: oldStatus || 'None', newValue: status, details: subcategory ? `${action.details} Subcategory: ${subcategory}.` : action.details,
        });
        await db.query('COMMIT');
        await logAction(user, action.logAction, `Client ID ${id}: ${oldStatus || 'None'} to ${statusLabel}`);
        res.json({ success: true, programStatus: status });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
};

app.post('/api/clients/:id/discharge', changeProgramStatus(STATUS_ACTIONS.discharge));
app.post('/api/clients/:id/activate', changeProgramStatus(STATUS_ACTIONS.activate));

app.get('/api/clients/:id/attendance', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            // Same-day attendances: the most recently recorded first
            `SELECT a.*, g.GroupName, g.Schedule AS GroupSchedule FROM Attendance a LEFT JOIN Groups g ON a."Group" = g.GroupId
             WHERE a.Client = $1 ORDER BY a.Date DESC, a.AttendanceId DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/clients/:id/financials', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM FinancialTransactions WHERE Client = $1 ORDER BY Date DESC', [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/clients/:id/notes', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM Notes WHERE Client = $1 ORDER BY Date DESC', [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clients/:id/notes', async (req, res) => {
    try {
        const { id } = req.params;
        const { user, comments, category } = req.body;
        const result = await pool.query(
            'INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, $4) RETURNING *',
            [id, user, comments, category]
        );
        await logAction(user, 'Add Note', `Added note to Client ID ${id}`);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Notes show "edited" once changed; the original text is kept in the system log
pool.query('ALTER TABLE Notes ADD COLUMN IF NOT EXISTS EditedBy VARCHAR(255), ADD COLUMN IF NOT EXISTS EditedOn TIMESTAMP')
    .catch(err => console.error('Could not add Notes edit columns:', err.message));

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

app.put('/api/notes/:noteId', async (req, res) => {
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

app.delete('/api/notes/:noteId', async (req, res) => {
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

app.get('/api/clients/:id/polygraphs', async (req, res) => {
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

app.get('/api/clients/:id/attachments', async (req, res) => {
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

app.post('/api/clients/:id/attachments', express.raw({ type: 'application/octet-stream', limit: ATTACHMENT_MAX_BYTES }), async (req, res) => {
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
app.get('/api/attachments/:attachmentId', async (req, res) => {
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
app.patch('/api/attachments/:attachmentId', async (req, res) => {
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
app.delete('/api/attachments/:attachmentId', async (req, res) => {
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

// A client's poly fee voucher runs 0 to this; paying the poly fee in full fills it
const POLY_VOUCHER_MAX = 6;

// Minimum gap after a No Deception Indicated polygraph before the next one may be scheduled
const POLY_NDI_WAIT = '5 months 14 days';

// Results that earn the client poly fee vouchers at SO group close (No Significant Response counts the same as NDI)
const POLY_VOUCHER_EARNING_RESULTS = ['No Deception Indicated', 'No Significant Response'];

// Results that can keep the client in the NDI voucher incentive, but only by Business Administrator override
const POLY_INCENTIVE_OVERRIDE_RESULTS = ['Inconclusive', 'No Opinion'];

// A client's most recent polygraph result, ordered by when it took place (falling back to the day it was recorded).
// clientParam is the query placeholder for the client id. Columns: Results, IncentiveContinued, Taken.
const LAST_POLY_RESULT_SQL = (clientParam) => `
    SELECT Results, IncentiveContinued, COALESCE(PolygraphDateTime, Date::timestamp) AS Taken
    FROM PolygraphResults WHERE Client = ${clientParam}
    ORDER BY COALESCE(PolygraphDateTime, Date::timestamp) DESC, ResultId DESC LIMIT 1`;

// Choices for the client's Race and Sex fields (both optional)
const CLIENT_RACES = ['American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino', 'Native Hawaiian or Other Pacific Islander', 'White', 'Two or More Races', 'Other'];
const CLIENT_SEXES = ['Male', 'Female'];

// Update Client Information
app.put('/api/clients/:id', async (req, res) => {
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
app.post('/api/clients', async (req, res) => {
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
app.delete('/api/clients/:id', async (req, res) => {
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

// --- CLIENT CHANGE LOG ---
// History of account changes shown on the client's Change Log tab (Business Administrators only).
// Fee Override rows keep ExpiresOn so the expiration can be listed once the date passes.
pool.query(`
    CREATE TABLE IF NOT EXISTS ClientChangeLog (
        ChangeId SERIAL PRIMARY KEY,
        ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
        ChangedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ChangedBy VARCHAR(255),
        ChangeType VARCHAR(50) NOT NULL,
        OldValue TEXT,
        NewValue TEXT,
        Details TEXT,
        ExpiresOn DATE
    )
`).catch(err => console.error('Could not create ClientChangeLog table:', err.message));

const logClientChange = (db, { clientId, changedBy, changeType, oldValue = null, newValue = null, details = null, expiresOn = null }) =>
    db.query(
        `INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details, ExpiresOn)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [clientId, changedBy || 'Unknown', changeType, oldValue, newValue, details, expiresOn]
    );

const groupNameFor = async (groupId) => {
    if (!groupId) return 'None';
    const res = await pool.query('SELECT GroupName FROM Groups WHERE GroupId = $1', [groupId]);
    return res.rows[0]?.groupname || `Group ${groupId}`;
};

// Fee override expirations are not stored; each one is listed the day after its ExpiresOn,
// unless the override was changed or removed before then.
app.get('/api/clients/:id/change-log', async (req, res) => {
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

// --- TEMPORARY FEE OVERRIDES ---
// A reduced treatment fee that applies through ExpirationDate (inclusive); after that the client's regular TreatmentFee applies again.
pool.query(`
    CREATE TABLE IF NOT EXISTS TemporaryFeeOverrides (
        OverrideId SERIAL PRIMARY KEY,
        ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
        ReducedFee NUMERIC(10, 2) NOT NULL,
        ExpirationDate DATE NOT NULL,
        CreatedBy VARCHAR(255),
        CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(err => console.error('Could not create TemporaryFeeOverrides table:', err.message));

const ACTIVE_FEE_OVERRIDE = `(SELECT o.ReducedFee FROM TemporaryFeeOverrides o WHERE o.ClientId = c.ClientId AND o.ExpirationDate >= CURRENT_DATE ORDER BY o.CreatedOn DESC LIMIT 1)`;

app.get('/api/clients/:id/fee-override', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT * FROM TemporaryFeeOverrides
             WHERE ClientId = $1 AND ExpirationDate >= CURRENT_DATE
             ORDER BY CreatedOn DESC LIMIT 1`,
            [id]
        );
        res.json({ override: result.rows[0] || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/clients/:id/fee-override', async (req, res) => {
    try {
        const { id } = req.params;
        const { reducedFee, expirationDate, createdBy } = req.body;

        if (reducedFee === undefined || reducedFee === null || reducedFee === '' || Number(reducedFee) < 0 || !expirationDate) {
            return res.status(400).json({ error: 'A reduced fee (0 or more) and an expiration date are required.' });
        }

        // An override still in effect is being changed; otherwise this activates a new one
        const priorRes = await pool.query(
            `SELECT ReducedFee, to_char(ExpirationDate, 'MM/DD/YYYY') AS Expires FROM TemporaryFeeOverrides
             WHERE ClientId = $1 AND ExpirationDate >= CURRENT_DATE ORDER BY CreatedOn DESC LIMIT 1`,
            [id]
        );
        const prior = priorRes.rows[0];

        await pool.query('DELETE FROM TemporaryFeeOverrides WHERE ClientId = $1', [id]);
        const result = await pool.query(
            `INSERT INTO TemporaryFeeOverrides (ClientId, ReducedFee, ExpirationDate, CreatedBy)
             VALUES ($1, $2, $3, $4) RETURNING *, to_char(ExpirationDate, 'MM/DD/YYYY') AS ExpiresText`,
            [id, Number(reducedFee), expirationDate, createdBy]
        );

        await logAction(createdBy, 'Fee Override Set', `Set temporary fee override for Client ID ${id}: $${reducedFee} until ${expirationDate}`);
        await logClientChange(pool, {
            clientId: id, changedBy: createdBy, changeType: 'Fee Override',
            oldValue: prior ? `$${Number(prior.reducedfee).toFixed(2)} through ${prior.expires}` : null,
            newValue: `$${Number(reducedFee).toFixed(2)} through ${result.rows[0].expirestext}`,
            details: prior ? 'Temporary fee override changed.' : 'Temporary fee override activated.',
            expiresOn: expirationDate,
        });
        res.status(201).json({ override: result.rows[0] });
    } catch (err) {
        console.error('Error setting fee override:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/clients/:id/fee-override', async (req, res) => {
    try {
        const { id } = req.params;
        const { removedBy } = req.body;

        const removed = await pool.query(
            `DELETE FROM TemporaryFeeOverrides WHERE ClientId = $1
             RETURNING ReducedFee, ExpirationDate >= CURRENT_DATE AS StillActive, to_char(ExpirationDate, 'MM/DD/YYYY') AS Expires`,
            [id]
        );
        const active = removed.rows.find(r => r.stillactive);
        if (active) {
            await logClientChange(pool, {
                clientId: id, changedBy: removedBy, changeType: 'Fee Override',
                oldValue: `$${Number(active.reducedfee).toFixed(2)} through ${active.expires}`, newValue: 'Removed',
                details: 'Temporary fee override removed before it expired.',
            });
        }

        if (removedBy) {
            await logAction(removedBy, 'Fee Override Removed', `Removed temporary fee override for Client ID ${id}`);
        }

        res.json({ success: true, message: 'Fee override removed successfully.' });
    } catch (err) {
        console.error('Error removing fee override:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- TEMPORARY POLY FEE OVERRIDES ---
// A reduced poly fee total for a set number of fills instead of a date. A fill is the poly fee being paid in full, which
// fills the poly fee vouchers. While active, the client's PolyFee is the reduced fee and RegularFee keeps what it was.
// The override ends once its last fill has been used (the vouchers spent scheduling a polygraph); PolyFee then goes back
// to RegularFee. Ending it at the fill itself would leave that payment measured against the regular fee when it's spent.
pool.query(`
    CREATE TABLE IF NOT EXISTS PolyFeeOverrides (
        OverrideId SERIAL PRIMARY KEY,
        ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
        ReducedFee NUMERIC(10, 2) NOT NULL,
        RegularFee NUMERIC(10, 2) NOT NULL,
        FillsAllowed INT NOT NULL,
        FillsUsed INT NOT NULL DEFAULT 0,
        CreatedBy VARCHAR(255),
        CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        EndedOn TIMESTAMP
    )
`).catch(err => console.error('Could not create PolyFeeOverrides table:', err.message));

const POLY_OVERRIDE_MAX_FILLS = 20;

const activePolyFeeOverride = async (db, clientId) => {
    const r = await db.query('SELECT * FROM PolyFeeOverrides WHERE ClientId = $1 AND EndedOn IS NULL ORDER BY CreatedOn DESC LIMIT 1', [clientId]);
    return r.rows[0] || null;
};

// One more (or one fewer) fill toward the client's active poly fee override, if they have one
const countPolyFeeFill = (db, clientId, change) => db.query(
    'UPDATE PolyFeeOverrides SET FillsUsed = GREATEST(FillsUsed + $1, 0) WHERE ClientId = $2 AND EndedOn IS NULL',
    [change, clientId]
);

// Ends the client's active poly fee override and puts the regular poly fee back. Returns the ended override, if any.
const endPolyFeeOverride = async (db, clientId) => {
    const ended = await db.query(
        'UPDATE PolyFeeOverrides SET EndedOn = NOW() WHERE ClientId = $1 AND EndedOn IS NULL RETURNING *',
        [clientId]
    );
    const override = ended.rows[0];
    if (!override) return null;
    // Ended first, so a fill this causes isn't counted toward it
    const poly = await changePolyFeePaid(db, clientId, 0, { fee: Number(override.regularfee) });
    return { override, poly };
};

const polyOverrideText = (o) => `$${Number(o.reducedfee).toFixed(2)} for ${o.fillsallowed} fill${Number(o.fillsallowed) === 1 ? '' : 's'}`;

app.get('/api/clients/:id/poly-fee-override', async (req, res) => {
    try {
        res.json({ override: await activePolyFeeOverride(pool, req.params.id) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Sets or changes the override (Business Administrators only). Changing one keeps its fills used and regular fee.
app.post('/api/clients/:id/poly-fee-override', async (req, res) => {
    const { id } = req.params;
    const { reducedFee, fills, user } = req.body || {};
    if (await activeRoleFor(user) !== 'Business Administrator') {
        return res.status(403).json({ error: 'Only Business Administrators can set a poly fee override.' });
    }
    const fee = Math.round(Number(reducedFee) * 100) / 100;
    const fillsAllowed = Number(fills);
    if (reducedFee === '' || reducedFee === null || reducedFee === undefined || !Number.isFinite(fee) || fee < 0) {
        return res.status(400).json({ error: 'Enter a reduced poly fee of $0.00 or more.' });
    }
    if (!Number.isInteger(fillsAllowed) || fillsAllowed < 1 || fillsAllowed > POLY_OVERRIDE_MAX_FILLS) {
        return res.status(400).json({ error: `Number of fills must be a whole number from 1 to ${POLY_OVERRIDE_MAX_FILLS}.` });
    }

    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const clientRes = await db.query('SELECT PolyFee FROM Clients WHERE ClientId = $1 FOR UPDATE', [id]);
        if (clientRes.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Client not found.' });
        }
        const prior = await activePolyFeeOverride(db, id);
        if (prior && fillsAllowed < Number(prior.fillsused)) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: `This override has already been filled ${prior.fillsused} time(s); allow at least that many.` });
        }
        let override;
        if (prior) {
            override = (await db.query(
                'UPDATE PolyFeeOverrides SET ReducedFee = $1, FillsAllowed = $2 WHERE OverrideId = $3 RETURNING *',
                [fee, fillsAllowed, prior.overrideid]
            )).rows[0];
        } else {
            override = (await db.query(
                `INSERT INTO PolyFeeOverrides (ClientId, ReducedFee, RegularFee, FillsAllowed, CreatedBy)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [id, fee, Number(clientRes.rows[0].polyfee || 0), fillsAllowed, user]
            )).rows[0];
        }
        // Lowering the fee can make what's already paid a full payment, which fills the vouchers and counts as a fill
        const poly = await changePolyFeePaid(db, id, 0, { fee });
        override = await activePolyFeeOverride(db, id);

        await logClientChange(db, {
            clientId: id, changedBy: user, changeType: 'Poly Fee Override',
            oldValue: prior ? polyOverrideText(prior) : `$${Number(clientRes.rows[0].polyfee || 0).toFixed(2)} (regular)`,
            newValue: polyOverrideText(override),
            details: (prior ? 'Temporary poly fee override changed.' : `Temporary poly fee override activated; regular poly fee $${Number(override.regularfee).toFixed(2)} returns after the last fill is used.`)
                + voucherChangeText(poly),
        });
        await db.query('COMMIT');
        await logAction(user, 'Poly Fee Override Set', `Client ID ${id}: poly fee ${polyOverrideText(override)} (regular $${Number(override.regularfee).toFixed(2)}).${voucherChangeText(poly)}`);
        res.status(201).json({ override, ...poly });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Removes the override early and puts the regular poly fee back (Business Administrators only)
app.delete('/api/clients/:id/poly-fee-override', async (req, res) => {
    const { id } = req.params;
    const { user } = req.body || {};
    if (await activeRoleFor(user) !== 'Business Administrator') {
        return res.status(403).json({ error: 'Only Business Administrators can remove a poly fee override.' });
    }
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        await db.query('SELECT 1 FROM Clients WHERE ClientId = $1 FOR UPDATE', [id]);
        const result = await endPolyFeeOverride(db, id);
        if (!result) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'No poly fee override is active.' });
        }
        const { override, poly } = result;
        await logClientChange(db, {
            clientId: id, changedBy: user, changeType: 'Poly Fee Override',
            oldValue: polyOverrideText(override), newValue: 'Removed',
            details: `Removed after ${override.fillsused} of ${override.fillsallowed} fill(s); poly fee back to $${Number(override.regularfee).toFixed(2)}.${voucherChangeText(poly)}`,
        });
        await db.query('COMMIT');
        await logAction(user, 'Poly Fee Override Removed', `Client ID ${id}: removed poly fee override ${polyOverrideText(override)}.${voucherChangeText(poly)}`);
        res.json({ success: true, ...poly });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// --- GROUPS MODULE ---
app.get('/api/groups', async (req, res) => {
    try {
        const query = `
            SELECT g.*, 
            (SELECT COUNT(*) FROM Clients WHERE GroupId = g.GroupId) AS ClientCount
            FROM Groups g ORDER BY g.GroupName ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/groups/:id/clients', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT c.*, ${ATTENDED_THIS_MONTH} AS AttendedThisMonth, ${ACTIVE_FEE_OVERRIDE} AS ActiveFeeOverride,
                    (SELECT Date FROM Attendance WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastAttended
             FROM Clients c WHERE c.GroupId = $1`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { groupName, location, counselor, programType, schedule, address, active } = req.body;
        const required = { 'Group name': groupName, Location: location, Counselor: counselor, 'Program type': programType, Schedule: schedule };
        const missing = Object.entries(required).filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
        if (missing.length > 0) {
            return res.status(400).json({ error: `Required: ${missing.join(', ')}.` });
        }
        const result = await pool.query(
            `UPDATE Groups SET GroupName = $1, Location = $2, Counselor = $3, ProgramType = $4,
                Schedule = $5, Address = $6, Active = $7
             WHERE GroupId = $8 RETURNING GroupId`,
            [groupName.trim(), location.trim(), counselor.trim(), programType.trim(), schedule.trim(), (address || '').trim(), active !== false, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found.' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/groups', async (req, res) => {
    try {
        const { groupName, location, counselor, programType, schedule, address } = req.body;
        const required = { 'Group name': groupName, Location: location, Counselor: counselor, 'Program type': programType, Schedule: schedule };
        const missing = Object.entries(required).filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
        if (missing.length > 0) {
            return res.status(400).json({ error: `Required: ${missing.join(', ')}.` });
        }
        const result = await pool.query(
            `INSERT INTO Groups (GroupName, Location, Counselor, ProgramType, Schedule, Address, Active)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING GroupId`,
            [groupName.trim(), location.trim(), counselor.trim(), programType.trim(), schedule.trim(), (address || '').trim()]
        );
        res.status(201).json({ success: true, groupId: result.rows[0].groupid, message: 'Group created successfully.' });
    } catch (err) {
        console.error('Error creating group:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const assigned = await pool.query('SELECT COUNT(*) AS count FROM Clients WHERE GroupId = $1', [id]);
        if (Number(assigned.rows[0].count) > 0) {
            return res.status(409).json({ error: 'This group still has assigned clients. Reassign them to another group before deleting it.' });
        }
        const result = await pool.query('DELETE FROM Groups WHERE GroupId = $1 RETURNING GroupId', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found.' });
        }
        res.json({ success: true, message: 'Group deleted successfully.' });
    } catch (err) {
        // 23503 = foreign_key_violation: attendance or call-in history still references this group
        if (err.code === '23503') {
            return res.status(409).json({ error: 'This group has attendance or call-in history and cannot be deleted. Deactivate it instead: open Manage Group, uncheck Active on the Schedule & Counselor tab, and save.' });
        }
        console.error('Error deleting group:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/groups/:id/assign', async (req, res) => {
    try {
        const { id } = req.params;
        const { clientId, assignedBy } = req.body;
        const beforeRes = await pool.query('SELECT GroupId FROM Clients WHERE ClientId = $1', [clientId]);
        await pool.query('UPDATE Clients SET GroupId = $1 WHERE ClientId = $2', [id, clientId]);
        const oldGroupId = beforeRes.rows[0]?.groupid || null;
        if (beforeRes.rows.length > 0 && oldGroupId !== Number(id)) {
            await logClientChange(pool, {
                clientId, changedBy: assignedBy, changeType: 'Group',
                oldValue: await groupNameFor(oldGroupId), newValue: await groupNameFor(Number(id)),
                details: 'Reassigned from Manage Group.',
            });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ATTENDANCE & PAYMENTS ---
// Writes one attendance row, its ledger entry, and the client's balance.
// Takes the caller's transaction client so batch check-ins stay all-or-nothing.
// State SO and Voluntary SO Phase 1 (weekly) and Phase 2 (monthly) clients are charged the treatment fee once per calendar month,
// on their first attendance. Mirrors isMonthlyFeeClient in frontend/src/utils/soPhases.ts.
const isMonthlyFeeClient = (row) => (row.programtype === 'State SO' || row.programtype === 'Voluntary SO')
    && (row.phase === 'Phase 1 - Weekly' || row.phase === 'Phase 2 - Monthly');

// A client's first group check-in of a calendar month needs a balance of -$180.00 or better, i.e. owing at most this much
// (stored sign: positive = owes) after any payment taken at check-in. BIP clients are exempt. Mirrors FIRST_CHECKIN_MAX_OWED in frontend/src/utils/balance.ts.
const FIRST_CHECKIN_MAX_OWED = 180;

// SO group program types, as stored on Groups
const SO_GROUP_TYPES = ['SO', 'FED SO'];

// awardNdiVoucher: when set (closing an SO group), a client charged the group fee whose most recent
// polygraph earns vouchers (POLY_VOUCHER_EARNING_RESULTS, or kept in the incentive by override) earns one poly fee voucher, up to POLY_VOUCHER_MAX.
// sessionNumber: which session of the group that day (1 for the first); a group can meet again after its earlier session was closed
const recordAttendance = async (db, { client, group, date, sessionNumber, paid, groupFee, accountPaid, paymentMethod, voucherUsed, type, comments, createdBy, awardNdiVoucher }) => {
    const clientRes = await db.query('SELECT AccountBalance, ProgramType, Phase, FirstName, LastName FROM Clients WHERE ClientId = $1 FOR UPDATE', [client]);
    if (clientRes.rows.length === 0) {
        throw new Error(`Client ${client} not found.`);
    }

    const sessionDate = date || new Date().toISOString().split('T')[0];
    const sessionNum = Number(sessionNumber) > 0 ? Math.floor(Number(sessionNumber)) : 1;

    // A client can attend a given session of a group only once
    if (group) {
        const dupRes = await db.query(
            'SELECT 1 FROM Attendance WHERE Client = $1 AND "Group" = $2 AND Date = $3 AND SessionNumber = $4 LIMIT 1',
            [client, group, sessionDate, sessionNum]
        );
        if (dupRes.rows.length > 0) {
            const { lastname, firstname } = clientRes.rows[0];
            throw new Error(`${lastname}, ${firstname} already attended this group session on ${sessionDate} and cannot be checked in to it again.`);
        }
    }
    const oldBalance = Number(clientRes.rows[0].accountbalance || 0);

    // First group check-in of the calendar month: after any payment taken now, the client may owe at most FIRST_CHECKIN_MAX_OWED.
    // BIP clients are exempt.
    if (group && clientRes.rows[0].programtype !== 'BIP') {
        const monthRes = await db.query(
            `SELECT 1 FROM Attendance WHERE Client = $1 AND date_trunc('month', Date) = date_trunc('month', $2::date) LIMIT 1`,
            [client, sessionDate]
        );
        const owedAfterPayment = oldBalance - Number(accountPaid || 0);
        if (monthRes.rows.length === 0 && owedAfterPayment > FIRST_CHECKIN_MAX_OWED) {
            const { lastname, firstname } = clientRes.rows[0];
            throw new Error(`${lastname}, ${firstname} must pay their existing balance before their first group check-in of the month: `
                + `the balance must be -$${FIRST_CHECKIN_MAX_OWED.toFixed(2)} or better (pay at least $${(owedAfterPayment - FIRST_CHECKIN_MAX_OWED).toFixed(2)} more).`);
        }
    }

    let feeNum = Number(groupFee || 0);
    if (isMonthlyFeeClient(clientRes.rows[0]) && feeNum > 0) {
        const priorRes = await db.query(
            `SELECT 1 FROM Attendance WHERE Client = $1 AND date_trunc('month', Date) = date_trunc('month', $2::date) LIMIT 1`,
            [client, sessionDate]
        );
        // Already charged this month: the fee does not apply again
        if (priorRes.rows.length > 0) feeNum = 0;
    }
    const paidNum = Number(accountPaid || 0);
    const newBalance = oldBalance - paidNum + feeNum;

    // Every payment needs a method (Cash or Credit Card). Credit card payments are recorded only; processing comes later.
    if (paidNum > 0 && !['Cash', 'Credit Card'].includes(paymentMethod)) {
        throw new Error(`Choose a payment method for the payment on client ${client}: Cash or Credit Card.`);
    }

    const attRes = await db.query(
        `INSERT INTO Attendance (Client, "Group", Date, Paid, GroupFee, AccountPaid, AccountTotal, VoucherUsed, Type, Comments, CreatedBy, PaymentMethod, SessionNumber)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING AttendanceId;`,
        [client, group || null, sessionDate, paid, feeNum, paidNum, newBalance, voucherUsed, type, comments || null, createdBy, paidNum > 0 ? paymentMethod : null, sessionNum]
    );

    const attendanceId = attRes.rows[0].attendanceid;
    if (paidNum > 0) {
        await db.query(
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod, AttendanceId)
             VALUES ($1, NOW(), 'Payment', $2, 'Group Fee', $3, $4, $5, $6)`,
            [client, paidNum, newBalance, `Payment applied during ${type} session on ${sessionDate}.`, paymentMethod, attendanceId]
        );
    } else if (feeNum > 0) {
        await db.query(
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, AttendanceId)
             VALUES ($1, NOW(), 'Charge', $2, 'Group Fee', $3, $4, $5)`,
            [client, feeNum, newBalance, `${type} fee assessed on ${sessionDate}.`, attendanceId]
        );
    }

    // BIP clients count weeks attended: every attendance adds one to the week number stored in Phase.
    // A non-numeric value (left over from before BIP used week numbers) counts as week 0.
    const { programtype, phase } = clientRes.rows[0];
    const newPhase = programtype === 'BIP'
        ? String((/^\d+$/.test(String(phase ?? '').trim()) ? Number(phase) : 0) + 1)
        : null;

    await db.query(
        'UPDATE Clients SET AccountBalance = $1, LastDateAttended = $2, Phase = COALESCE($3, Phase) WHERE ClientId = $4',
        [newBalance, sessionDate, newPhase, client]
    );

    let polyVoucherAwarded = false;
    if (awardNdiVoucher && feeNum > 0) {
        const polyRes = await db.query(LAST_POLY_RESULT_SQL('$1'), [client]);
        const lastPoly = polyRes.rows[0];
        if (lastPoly && (POLY_VOUCHER_EARNING_RESULTS.includes(lastPoly.results) || lastPoly.incentivecontinued)) {
            const voucherRes = await db.query(
                'UPDATE Clients SET PolyFeeVoucher = PolyFeeVoucher + 1 WHERE ClientId = $1 AND PolyFeeVoucher < $2 RETURNING PolyFeeVoucher',
                [client, POLY_VOUCHER_MAX]
            );
            polyVoucherAwarded = voucherRes.rows.length > 0;
        }
    }

    return { attendanceId, newBalance, polyVoucherAwarded };
};

app.post('/api/attendance', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const { attendanceId, newBalance } = await recordAttendance(clientDb, req.body);
        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, attendanceId, newBalance });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

// Sessions of a group on a date (YYYY-MM-DD), oldest first. Closed sessions list the ids of the clients who attended;
// open ones (saved with Finish Check-In, not yet closed) have no attendance yet and are listed so their numbers aren't reused.
// A client cannot be checked in to the same session twice, but can attend a later session that day.
app.get('/api/groups/:groupId/sessions', async (req, res) => {
    try {
        const { groupId } = req.params;
        const { date } = req.query;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
            return res.status(400).json({ error: 'A session date (YYYY-MM-DD) is required.' });
        }
        const result = await pool.query(
            `SELECT SessionNumber, TRUE AS Closed, array_agg(DISTINCT Client) AS Clients
             FROM Attendance WHERE "Group" = $1 AND Date = $2
             GROUP BY SessionNumber
             UNION ALL
             SELECT o.SessionNumber, FALSE, ARRAY[]::int[]
             FROM OpenGroupSessions o
             WHERE o.GroupId = $1 AND o.SessionDate = $2
               AND NOT EXISTS (SELECT 1 FROM Attendance a WHERE a."Group" = $1 AND a.Date = $2 AND a.SessionNumber = o.SessionNumber)
             ORDER BY SessionNumber`,
            [groupId, date]
        );
        res.json(result.rows.map(r => ({ sessionNumber: r.sessionnumber, closed: r.closed, clients: r.clients })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Group check-in: every client on the session sheet is saved in one transaction
app.post('/api/attendance/batch', async (req, res) => {
    const { group, date, sessionNumber, type, createdBy, entries } = req.body;
    const sessionNum = Number(sessionNumber) > 0 ? Math.floor(Number(sessionNumber)) : 1;

    if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'No clients were provided for check-in.' });
    }

    const clientIds = entries.map(e => Number(e.client));
    if (new Set(clientIds).size !== clientIds.length) {
        return res.status(400).json({ error: 'The same client cannot be checked in twice in one session.' });
    }

    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const groupRes = await clientDb.query('SELECT ProgramType FROM Groups WHERE GroupId = $1', [group]);
        const isSoGroup = SO_GROUP_TYPES.includes(String(groupRes.rows[0]?.programtype || '').trim().toUpperCase());
        const results = [];
        for (const entry of entries) {
            const { attendanceId, newBalance, polyVoucherAwarded } = await recordAttendance(clientDb, {
                ...entry, group, date, sessionNumber: sessionNum, type: type || 'Group', createdBy, paid: true, awardNdiVoucher: isSoGroup
            });
            results.push({ client: entry.client, attendanceId, newBalance, polyVoucherAwarded });
        }
        // Closing the group clears its saved open sheet for this session. Who opened it is kept on the attendance rows
        // so the closed group stays visible to them; a group closed without being opened first was opened by the closer.
        const openedRes = await clientDb.query(
            'DELETE FROM OpenGroupSessions WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3 RETURNING CreatedBy',
            [group, date, sessionNum]
        );
        const openedBy = openedRes.rows[0]?.createdby || createdBy;
        await clientDb.query(
            'UPDATE Attendance SET OpenedBy = $1 WHERE AttendanceId = ANY($2::int[])',
            [openedBy, results.map(r => r.attendanceId)]
        );
        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, count: results.length, results, polyVouchersAwarded: results.filter(r => r.polyVoucherAwarded).length });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

// --- OPEN GROUPS ---
// Group check-ins saved with Finish Check-In so they can be closed later

// Session numbers let a group meet more than once a day. Existing rows are session 1. Open sheets become unique per
// group, date, and session (was per group and date).
pool.query('ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS SessionNumber INT NOT NULL DEFAULT 1')
    .then(() => pool.query('ALTER TABLE OpenGroupSessions ADD COLUMN IF NOT EXISTS SessionNumber INT NOT NULL DEFAULT 1'))
    .then(() => pool.query('ALTER TABLE OpenGroupSessions DROP CONSTRAINT IF EXISTS opengroupsessions_groupid_sessiondate_key'))
    .then(() => pool.query('CREATE UNIQUE INDEX IF NOT EXISTS OpenGroupSessions_Session_Key ON OpenGroupSessions (GroupId, SessionDate, SessionNumber)'))
    // Employee who opened the group check-in this attendance was closed from; NULL on older rows (treated as CreatedBy)
    .then(() => pool.query('ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS OpenedBy VARCHAR(255)'))
    .catch(err => console.error('Could not add group session numbers:', err.message));

const OPEN_GROUP_COLUMNS = `o.OpenSessionId, o.GroupId, g.GroupName, to_char(o.SessionDate, 'YYYY-MM-DD') AS SessionDate,
    o.SessionNumber, o.Entries, o.CreatedBy, o.UpdatedOn`;

// Who may see and change an open check-in: Business Administrators, Office Admins, the group's counselor
// (Groups.Counselor holds the employee's display name), and the employee who opened it (CreatedBy)
const OPEN_GROUP_ADMIN_ROLES = ['Business Administrator', 'Office Admin'];
const openGroupViewer = async (email) => {
    const r = await pool.query('SELECT EmployeeEmail, DisplayName, Role FROM EmployeeRoles WHERE LOWER(EmployeeEmail) = LOWER($1) AND Active = TRUE', [email || '']);
    return r.rows[0] || null;
};
const canSeeOpenGroup = (viewer, row) => {
    if (!viewer) return false;
    if (OPEN_GROUP_ADMIN_ROLES.includes(viewer.role)) return true;
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    return same(row.createdby, viewer.employeeemail) || (!!viewer.displayname && same(row.counselor, viewer.displayname));
};

app.get('/api/open-groups', async (req, res) => {
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
// they counsel and the ones they opened.
app.get('/api/closed-groups', async (req, res) => {
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
app.put('/api/open-groups', async (req, res) => {
    try {
        const { group, date, sessionNumber, entries, createdBy } = req.body;
        if (!group || !date || !Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'A group, session date, and at least one checked-in client are required.' });
        }
        const sessionNum = Number(sessionNumber) > 0 ? Math.floor(Number(sessionNumber)) : 1;
        const existing = await pool.query(
            `SELECT o.CreatedBy, g.Counselor FROM OpenGroupSessions o JOIN Groups g ON g.GroupId = o.GroupId
             WHERE o.GroupId = $1 AND o.SessionDate = $2 AND o.SessionNumber = $3`,
            [group, date, sessionNum]
        );
        if (existing.rows[0] && !canSeeOpenGroup(await openGroupViewer(createdBy), existing.rows[0])) {
            return res.status(403).json({ error: 'This group already has an open check-in for this session, started by another counselor. Only that counselor, the group\'s counselor, or an administrator can change it.' });
        }
        const saved = await pool.query(
            `INSERT INTO OpenGroupSessions (GroupId, SessionDate, SessionNumber, Entries, CreatedBy, UpdatedOn)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (GroupId, SessionDate, SessionNumber)
             DO UPDATE SET Entries = EXCLUDED.Entries, UpdatedOn = NOW()
             RETURNING OpenSessionId`,
            [group, date, sessionNum, JSON.stringify(entries), createdBy]
        );
        const result = await pool.query(
            `SELECT ${OPEN_GROUP_COLUMNS} FROM OpenGroupSessions o
             JOIN Groups g ON g.GroupId = o.GroupId WHERE o.OpenSessionId = $1`,
            [saved.rows[0].opensessionid]
        );
        await logAction(createdBy, 'Group Check-In Saved', `Saved open check-in for Group ID ${group} on ${date} (${entries.length} client(s))`);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/open-groups/:id', async (req, res) => {
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

app.post('/api/financials/payment', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const { client, amount, comments, createdBy, paymentMethod, applyToPolyFee } = req.body;
        const allowedMethods = ['Cash', 'Credit Card'];
        if (!allowedMethods.includes(paymentMethod)) {
            await clientDb.query('ROLLBACK');
            return res.status(400).json({ error: 'Choose a payment method: Cash or Credit Card.' });
        }
        if (!(Number(amount) > 0)) {
            await clientDb.query('ROLLBACK');
            return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
        }

        const clientRes = await clientDb.query('SELECT AccountBalance, PolyFeePaid, PolyFee, PolyFeeVoucher FROM Clients WHERE ClientId = $1 FOR UPDATE', [client]);
        const oldBalance = Number(clientRes.rows[0].accountbalance || 0);
        const payAmount = Number(amount || 0);
        const comment = comments || `Direct account payment processed by ${createdBy}`;

        // With applyToPolyFee, the payment covers the unpaid poly fee first; only the excess goes to the account balance
        const oldPolyPaid = Number(clientRes.rows[0].polyfeepaid || 0);
        const polyOwed = Math.max(0, Number(clientRes.rows[0].polyfee || 0) - oldPolyPaid);
        const polyAmount = applyToPolyFee ? Math.min(payAmount, polyOwed) : 0;
        const accountAmount = payAmount - polyAmount;
        const newBalance = oldBalance - accountAmount;
        const newPolyPaid = oldPolyPaid + polyAmount;
        // The payment that completes the poly fee fills the vouchers
        const newPolyVoucher = polyAmount > 0 && polyAmount >= polyOwed ? POLY_VOUCHER_MAX : Number(clientRes.rows[0].polyfeevoucher || 0);

        if (polyAmount > 0) {
            // The poly fee is tracked separately, so the account balance is unchanged by this row
            await clientDb.query(
                `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod)
                 VALUES ($1, NOW(), 'Payment', $2, 'Poly Fee', $3, $4, $5)`,
                [client, polyAmount, oldBalance, comment, paymentMethod]
            );
        }
        if (accountAmount > 0) {
            await clientDb.query(
                `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod)
                 VALUES ($1, NOW(), 'Payment', $2, 'Account Payment', $3, $4, $5)`,
                [client, accountAmount, newBalance, comment, paymentMethod]
            );
        }

        // Filling the vouchers remembers the count before (the right-hand PolyFeeVoucher is the pre-update value), so
        // adjusting or refunding this payment later can take back only what the fill added
        const fillsVouchers = polyAmount > 0 && polyAmount >= polyOwed;
        await clientDb.query(
            `UPDATE Clients SET AccountBalance = $1, PolyFeePaid = $2, PolyFeeVoucher = $3,
                 PolyVouchersBeforeFill = CASE WHEN $5 THEN PolyFeeVoucher ELSE PolyVouchersBeforeFill END
             WHERE ClientId = $4`,
            [newBalance, newPolyPaid, newPolyVoucher, client, fillsVouchers]
        );
        if (fillsVouchers) await countPolyFeeFill(clientDb, client, 1);

        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, newBalance, polyFeePaid: newPolyPaid, polyFeeVoucher: newPolyVoucher, polyApplied: polyAmount, accountApplied: accountAmount });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

// Custom fee charged to a client's account (Business Administrators only)
app.post('/api/financials/charge', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        const { client, amount, comments, createdBy } = req.body;
        const roleRes = await clientDb.query(
            'SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE',
            [createdBy]
        );
        if (roleRes.rows[0]?.role !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can charge custom fees.' });
        }
        if (!(Number(amount) > 0)) {
            return res.status(400).json({ error: 'Charge amount must be greater than zero.' });
        }
        if (!comments || !comments.trim()) {
            return res.status(400).json({ error: 'Notes are required for a custom fee.' });
        }

        await clientDb.query('BEGIN');
        const clientRes = await clientDb.query('SELECT AccountBalance FROM Clients WHERE ClientId = $1', [client]);
        const oldBalance = Number(clientRes.rows[0].accountbalance || 0);
        const chargeAmount = Number(amount);
        const newBalance = oldBalance + chargeAmount;

        await clientDb.query(
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments)
             VALUES ($1, NOW(), 'Charge', $2, 'Custom Fee', $3, $4)`,
            [client, chargeAmount, newBalance, comments.trim()]
        );

        await clientDb.query('UPDATE Clients SET AccountBalance = $1 WHERE ClientId = $2', [newBalance, client]);

        await clientDb.query('COMMIT');
        await logAction(createdBy, 'Custom Fee Charged', `Charged Client ID ${client} a custom fee of $${chargeAmount.toFixed(2)}: ${comments.trim()}`);
        res.status(201).json({ success: true, newBalance });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

// AttendanceId ties a check-in's ledger row to its attendance row (rows saved before it existed are matched by comment).
// The Adjusted columns keep what a corrected payment was first recorded as, and who corrected it and why.
// Attendance.CreatedOn orders check-ins against ledger rows; rows saved before it existed stay NULL.
pool.query(`
    ALTER TABLE FinancialTransactions
        ADD COLUMN IF NOT EXISTS AttendanceId INT,
        ADD COLUMN IF NOT EXISTS OriginalAmount NUMERIC(10, 2),
        ADD COLUMN IF NOT EXISTS AdjustedBy VARCHAR(255),
        ADD COLUMN IF NOT EXISTS AdjustedOn TIMESTAMP,
        ADD COLUMN IF NOT EXISTS AdjustmentReason TEXT
`)
    .then(() => pool.query('ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS CreatedOn TIMESTAMP'))
    .then(() => pool.query('ALTER TABLE Attendance ALTER COLUMN CreatedOn SET DEFAULT CURRENT_TIMESTAMP'))
    // Refund, Dispute, and Dispute Won rows point at the credit card payment they belong to; the payment keeps its dispute status
    .then(() => pool.query(`
        ALTER TABLE FinancialTransactions
            ADD COLUMN IF NOT EXISTS RelatedTransactionId INT,
            ADD COLUMN IF NOT EXISTS DisputeStatus VARCHAR(20)
    `))
    .then(() => pool.query(`
        ALTER TABLE FinancialTransactions DROP CONSTRAINT IF EXISTS financialtransactions_type_check,
            ADD CONSTRAINT financialtransactions_type_check
                CHECK (Type IN ('Payment', 'Charge', 'Adjustment', 'Voucher', 'Refund', 'Dispute', 'Dispute Won'))
    `))
    // Vouchers the client had before paying the poly fee in full filled them; NULL while not filled by a payment
    .then(() => pool.query('ALTER TABLE Clients ADD COLUMN IF NOT EXISTS PolyVouchersBeforeFill INT'))
    .catch(err => console.error('Could not add payment adjustment columns:', err.message));

// Ledger row types that take money back off a payment (the client owes it again), and the one that puts it back
const PAYMENT_REVERSAL_TYPES = ['Refund', 'Dispute'];

// Moves a client's PolyFeePaid by delta (and, with fee, sets a new poly fee total) and keeps the vouchers in step. Becoming
// paid in full fills them and remembers the count before; dropping below paid in full takes back only what that fill added,
// keeping incentive vouchers earned before it. A fill from before PolyVouchersBeforeFill existed has no count saved, so those
// vouchers go to 0. Fills (and fills taken back) count toward an active poly fee override.
const changePolyFeePaid = async (db, clientId, delta, { fee: newFee } = {}) => {
    const r = await db.query('SELECT PolyFeePaid, PolyFee, PolyFeeVoucher, PolyVouchersBeforeFill FROM Clients WHERE ClientId = $1 FOR UPDATE', [clientId]);
    const c = r.rows[0];
    const feeBefore = Number(c.polyfee || 0);
    const fee = newFee === undefined ? feeBefore : Number(newFee);
    const paidBefore = Number(c.polyfeepaid || 0);
    const paidAfter = Math.round((paidBefore + delta) * 100) / 100;
    const vouchersBefore = Number(c.polyfeevoucher || 0);
    let vouchers = vouchersBefore;
    let beforeFill = c.polyvouchersbeforefill;
    const wasFull = feeBefore > 0 && paidBefore >= feeBefore;
    const isFull = fee > 0 && paidAfter >= fee;
    if (!wasFull && isFull) {
        beforeFill = vouchers;
        vouchers = POLY_VOUCHER_MAX;
        await countPolyFeeFill(db, clientId, 1);
    } else if (wasFull && !isFull) {
        vouchers = Math.min(vouchers, Number(beforeFill ?? 0));
        beforeFill = null;
        await countPolyFeeFill(db, clientId, -1);
    }
    await db.query(
        'UPDATE Clients SET PolyFeePaid = $1, PolyFee = $2, PolyFeeVoucher = $3, PolyVouchersBeforeFill = $4 WHERE ClientId = $5',
        [paidAfter, fee, vouchers, beforeFill, clientId]
    );
    return { polyFeePaid: paidAfter, polyFee: fee, polyFeeVoucher: vouchers, vouchersRemoved: Math.max(0, vouchersBefore - vouchers), vouchersAdded: Math.max(0, vouchers - vouchersBefore) };
};

// The polygraph a client is booked into with poly fee vouchers, if any. Changing a poly fee payment doesn't cancel it,
// so the caller is told about it instead.
const scheduledPolygraphFor = async (db, clientId) => {
    const r = await db.query(
        `SELECT s.SlotId, to_char(s.Date, 'YYYY-MM-DD') AS Date, s.Time, s.Location
         FROM PolygraphAppointments a JOIN PolygraphSlots s ON s.SlotId = a.SlotId
         WHERE a.Client = $1 AND a.Status = 'Scheduled' AND COALESCE(a.PolyVouchersUsed, 0) > 0
         ORDER BY s.Date, s.Time LIMIT 1`,
        [clientId]
    );
    const slot = r.rows[0];
    return slot ? { slotId: slot.slotid, date: slot.date, time: slot.time, location: slot.location } : null;
};

const scheduledPolygraphText = (slot) => (slot
    ? ` The client already has a polygraph scheduled ${slot.date}${slot.time ? ` at ${slot.time}` : ''}${slot.location ? ` (${slot.location})` : ''} using poly fee vouchers; it was not changed.`
    : '');

const voucherChangeText = (poly) => (poly.vouchersRemoved > 0 ? ` ${poly.vouchersRemoved} poly fee voucher(s) removed.` : '')
    + (poly.vouchersAdded > 0 ? ` Poly fee paid in full: vouchers filled to ${POLY_VOUCHER_MAX}.` : '');

// The check-in a ledger row was taken at: its AttendanceId, or for rows saved before that existed, the one attendance row
// whose comment and paid amount match
const checkInFor = async (db, tx) => {
    if (tx.attendanceid) return tx.attendanceid;
    if (tx.feetype !== 'Group Fee') return null;
    const match = await db.query(
        `SELECT AttendanceId FROM Attendance
         WHERE Client = $1 AND AccountPaid = $2
           AND 'Payment applied during ' || Type || ' session on ' || to_char(Date, 'YYYY-MM-DD') || '.' = $3`,
        [tx.client, Number(tx.amount), tx.comments]
    );
    return match.rows.length === 1 ? match.rows[0].attendanceid : null;
};

// Corrects the amount of a cash payment (Business Administrators only). For an account payment the difference moves the
// client's balance and the balance stored on this and every later ledger and attendance row, and a payment taken at
// check-in also updates that attendance row's AccountPaid, which the group income report and its cash deposits use.
// For a poly fee payment the difference moves PolyFeePaid instead, and the vouchers follow (see changePolyFeePaid).
app.put('/api/financials/:id/adjust', async (req, res) => {
    const { id } = req.params;
    const { amount, reason, user } = req.body || {};
    if (await activeRoleFor(user) !== 'Business Administrator') {
        return res.status(403).json({ error: 'Only Business Administrators can adjust payments.' });
    }
    const newAmount = Math.round(Number(amount) * 100) / 100;
    if (!(newAmount > 0)) {
        return res.status(400).json({ error: 'The adjusted amount must be greater than zero.' });
    }
    const why = String(reason || '').trim();
    if (!why) {
        return res.status(400).json({ error: 'A reason is required to adjust a payment.' });
    }

    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const txRes = await db.query('SELECT * FROM FinancialTransactions WHERE TransactionId = $1 FOR UPDATE', [id]);
        const tx = txRes.rows[0];
        if (!tx) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'That ledger entry no longer exists.' });
        }
        // Payments saved before the method was recorded were all cash; adjusting one records it as Cash.
        // Credit card payments are corrected with a refund or dispute instead.
        if (tx.type !== 'Payment' || (tx.paymentmethod && tx.paymentmethod !== 'Cash')) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: 'Only cash payments can be adjusted.' });
        }
        const clientRes = await db.query('SELECT AccountBalance FROM Clients WHERE ClientId = $1 FOR UPDATE', [tx.client]);
        const isPoly = tx.feetype === 'Poly Fee';

        const oldAmount = Number(tx.amount);
        // Paying more lowers what the client owes (stored sign: positive = owes)
        const delta = Math.round((newAmount - oldAmount) * 100) / 100;
        if (delta === 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: `The payment is already $${newAmount.toFixed(2)}.` });
        }

        const paidOn = new Date(tx.date).toLocaleDateString('en-US');
        if (isPoly) {
            // Poly fee rows store the account balance, which this doesn't change
            const poly = await changePolyFeePaid(db, tx.client, delta);
            const scheduledPolygraph = await scheduledPolygraphFor(db, tx.client);
            await db.query(
                `UPDATE FinancialTransactions SET Amount = $1, PaymentMethod = 'Cash', OriginalAmount = COALESCE(OriginalAmount, $2), AdjustedBy = $3,
                     AdjustedOn = NOW(), AdjustmentReason = $4
                 WHERE TransactionId = $5`,
                [newAmount, oldAmount, user, why, tx.transactionid]
            );
            await logClientChange(db, {
                clientId: tx.client,
                changedBy: user,
                changeType: 'Payment Adjusted',
                oldValue: `$${oldAmount.toFixed(2)}`,
                newValue: `$${newAmount.toFixed(2)}`,
                details: `Cash Poly Fee payment from ${paidOn}: ${why}. Poly fee paid now $${poly.polyFeePaid.toFixed(2)}.${voucherChangeText(poly)}${scheduledPolygraphText(scheduledPolygraph)}`,
            });
            await db.query('COMMIT');
            await logAction(user, 'Payment Adjusted', `Client ID ${tx.client}: cash poly fee payment ${tx.transactionid} from ${paidOn} changed from $${oldAmount.toFixed(2)} to $${newAmount.toFixed(2)}: ${why}.${voucherChangeText(poly)}${scheduledPolygraphText(scheduledPolygraph)}`);
            return res.json({ success: true, newBalance: Number(clientRes.rows[0].accountbalance), attendanceUpdated: false, ...poly, scheduledPolygraph });
        }

        const attendanceId = await checkInFor(db, tx);

        // Compared in SQL so the stored timestamp keeps its full precision
        await db.query(
            `UPDATE FinancialTransactions SET FinalBalance = FinalBalance - $1
             WHERE Client = $2 AND FinalBalance IS NOT NULL
               AND (TransactionId = $3 OR (Date, TransactionId) > (SELECT Date, TransactionId FROM FinancialTransactions WHERE TransactionId = $3))`,
            [delta, tx.client, tx.transactionid]
        );
        // Later check-ins: by CreatedOn when saved, otherwise after the linked check-in, otherwise on a later day
        await db.query(
            `UPDATE Attendance SET AccountTotal = AccountTotal - $1
             WHERE Client = $2 AND (
                 AttendanceId = $3
                 OR CreatedOn > (SELECT Date FROM FinancialTransactions WHERE TransactionId = $4)
                 OR (CreatedOn IS NULL AND CASE WHEN $3::int IS NULL
                         THEN Date > (SELECT Date FROM FinancialTransactions WHERE TransactionId = $4)::date
                         ELSE AttendanceId > $3 END)
             )`,
            [delta, tx.client, attendanceId || null, tx.transactionid]
        );
        if (attendanceId) {
            await db.query(
                `UPDATE Attendance SET AccountPaid = $1, PaymentMethod = COALESCE(PaymentMethod, 'Cash') WHERE AttendanceId = $2`,
                [newAmount, attendanceId]
            );
        }
        await db.query(
            `UPDATE FinancialTransactions SET Amount = $1, PaymentMethod = 'Cash', OriginalAmount = COALESCE(OriginalAmount, $2), AdjustedBy = $3,
                 AdjustedOn = NOW(), AdjustmentReason = $4, AttendanceId = COALESCE(AttendanceId, $5)
             WHERE TransactionId = $6`,
            [newAmount, oldAmount, user, why, attendanceId || null, tx.transactionid]
        );
        const balRes = await db.query(
            'UPDATE Clients SET AccountBalance = AccountBalance - $1 WHERE ClientId = $2 RETURNING AccountBalance',
            [delta, tx.client]
        );
        await logClientChange(db, {
            clientId: tx.client,
            changedBy: user,
            changeType: 'Payment Adjusted',
            oldValue: `$${oldAmount.toFixed(2)}`,
            newValue: `$${newAmount.toFixed(2)}`,
            details: `Cash ${tx.feetype || 'payment'} from ${paidOn}: ${why}`,
        });

        await db.query('COMMIT');
        await logAction(user, 'Payment Adjusted', `Client ID ${tx.client}: cash payment ${tx.transactionid} from ${paidOn} changed from $${oldAmount.toFixed(2)} to $${newAmount.toFixed(2)}: ${why}`);
        res.json({ success: true, newBalance: Number(balRes.rows[0].accountbalance), attendanceUpdated: Boolean(attendanceId) });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Refunds and disputes on a credit card payment (Business Administrators only). Each is its own ledger row pointing at the
// payment. A refund or dispute takes that much back off the payment: the client owes it again (for a poly fee payment it
// comes off PolyFeePaid instead), and a check-in payment's AccountPaid drops so the group income report shows what was kept.
// A dispute reverses the payment as soon as it's opened; winning it puts the disputed amount back, losing it leaves it reversed.
const CARD_ACTIONS = ['refund', 'dispute', 'dispute-won', 'dispute-lost'];
app.post('/api/financials/:id/card-action', async (req, res) => {
    const { id } = req.params;
    const { action, amount, reason, user } = req.body || {};
    if (await activeRoleFor(user) !== 'Business Administrator') {
        return res.status(403).json({ error: 'Only Business Administrators can record refunds and disputes.' });
    }
    if (!CARD_ACTIONS.includes(action)) {
        return res.status(400).json({ error: 'Unknown credit card action.' });
    }
    const why = String(reason || '').trim();
    if (!why) {
        return res.status(400).json({ error: 'A reason is required.' });
    }

    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const txRes = await db.query('SELECT * FROM FinancialTransactions WHERE TransactionId = $1 FOR UPDATE', [id]);
        const tx = txRes.rows[0];
        if (!tx) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'That ledger entry no longer exists.' });
        }
        if (tx.type !== 'Payment' || tx.paymentmethod !== 'Credit Card') {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: 'Refunds and disputes are only for credit card payments.' });
        }
        const clientRes = await db.query('SELECT AccountBalance FROM Clients WHERE ClientId = $1 FOR UPDATE', [tx.client]);

        const related = await db.query(
            'SELECT Type, Amount FROM FinancialTransactions WHERE RelatedTransactionId = $1 ORDER BY Date, TransactionId',
            [tx.transactionid]
        );
        let kept = Number(tx.amount);
        let openDispute = 0;
        for (const r of related.rows) {
            if (PAYMENT_REVERSAL_TYPES.includes(r.type)) kept -= Number(r.amount);
            else if (r.type === 'Dispute Won') kept += Number(r.amount);
            if (r.type === 'Dispute') openDispute = Number(r.amount);
        }
        kept = Math.round(kept * 100) / 100;

        let rowType = null;
        let rowAmount = 0;
        if (action === 'refund' || action === 'dispute') {
            if (tx.disputestatus === 'Open') {
                await db.query('ROLLBACK');
                return res.status(400).json({ error: 'Mark the open dispute on this payment won or lost first.' });
            }
            rowAmount = Math.round(Number(amount) * 100) / 100;
            if (!(rowAmount > 0) || rowAmount > kept) {
                await db.query('ROLLBACK');
                return res.status(400).json({ error: kept > 0 ? `Enter an amount from $0.01 to $${kept.toFixed(2)}.` : 'Nothing is left on this payment to refund or dispute.' });
            }
            rowType = action === 'refund' ? 'Refund' : 'Dispute';
        } else {
            if (tx.disputestatus !== 'Open') {
                await db.query('ROLLBACK');
                return res.status(400).json({ error: 'This payment has no open dispute.' });
            }
            if (action === 'dispute-won') {
                rowType = 'Dispute Won';
                rowAmount = openDispute;
            }
        }

        // Change to what was paid: negative takes money back, positive puts it back
        const paidChange = rowType === 'Dispute Won' ? rowAmount : -rowAmount;
        const isPoly = tx.feetype === 'Poly Fee';
        let newBalance = Number(clientRes.rows[0].accountbalance || 0);
        let poly = null;
        const attendanceId = isPoly ? null : await checkInFor(db, tx);
        if (rowType) {
            if (isPoly) {
                poly = await changePolyFeePaid(db, tx.client, paidChange);
            } else {
                const balRes = await db.query(
                    'UPDATE Clients SET AccountBalance = AccountBalance - $1 WHERE ClientId = $2 RETURNING AccountBalance',
                    [paidChange, tx.client]
                );
                newBalance = Number(balRes.rows[0].accountbalance);
                if (attendanceId) {
                    await db.query('UPDATE Attendance SET AccountPaid = GREATEST(AccountPaid + $1, 0) WHERE AttendanceId = $2', [paidChange, attendanceId]);
                }
            }
        }

        const paidOn = new Date(tx.date).toLocaleDateString('en-US');
        const label = { refund: 'Refund', dispute: 'Dispute opened', 'dispute-won': 'Dispute won', 'dispute-lost': 'Dispute lost' }[action];
        if (rowType) {
            await db.query(
                `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod, AttendanceId, RelatedTransactionId)
                 VALUES ($1, NOW(), $2, $3, $4, $5, $6, 'Credit Card', $7, $8)`,
                [tx.client, rowType, rowAmount, tx.feetype, newBalance,
                    `${label} on the $${Number(tx.amount).toFixed(2)} credit card payment from ${paidOn}: ${why} (${user})`,
                    attendanceId, tx.transactionid]
            );
        }
        const status = { dispute: 'Open', 'dispute-won': 'Won', 'dispute-lost': 'Lost' }[action] ?? tx.disputestatus ?? null;
        await db.query(
            'UPDATE FinancialTransactions SET DisputeStatus = $1, AttendanceId = COALESCE(AttendanceId, $2) WHERE TransactionId = $3',
            [status, attendanceId, tx.transactionid]
        );

        const scheduledPolygraph = isPoly && rowType ? await scheduledPolygraphFor(db, tx.client) : null;
        const details = `${label}${rowType ? ` of $${rowAmount.toFixed(2)}` : ''} on the $${Number(tx.amount).toFixed(2)} credit card ${tx.feetype || 'payment'} from ${paidOn}: ${why}.`
            + (poly ? ` Poly fee paid now $${poly.polyFeePaid.toFixed(2)}.${voucherChangeText(poly)}` : '')
            + scheduledPolygraphText(scheduledPolygraph);
        await logClientChange(db, {
            clientId: tx.client,
            changedBy: user,
            changeType: action === 'refund' ? 'Payment Refunded' : 'Payment Disputed',
            details,
        });

        await db.query('COMMIT');
        await logAction(user, action === 'refund' ? 'Payment Refunded' : 'Payment Disputed', `Client ID ${tx.client}, payment ${tx.transactionid}: ${details}`);
        res.json({ success: true, newBalance, attendanceUpdated: Boolean(attendanceId && rowType), ...(poly || {}), scheduledPolygraph });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// --- CALL-IN MODULE ---
// Optional call-in reasons. Keep in sync with CALL_IN_REASONS in frontend/src/App.tsx.
const CALL_IN_REASONS = ['Routine check-in', 'Missed appointment', 'Reschedule request', 'Transportation issue', 'Work conflict', 'Other'];

app.post('/api/callin/client', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const { client, date, comment, createdBy, reason } = req.body;
        if (reason && !CALL_IN_REASONS.includes(reason)) {
            await clientDb.query('ROLLBACK');
            return res.status(400).json({ error: 'Unknown call-in reason.' });
        }
        const reasonText = reason ? ` (Reason: ${reason})` : '';

        const eventRes = await clientDb.query(
            `INSERT INTO EventLog (Client, Type, Comment, CreatedBy, CallInReason) VALUES ($1, 'Call-In', $2, $3, $4) RETURNING EventId`,
            [client, comment, createdBy, reason || null]
        );

        await clientDb.query(
            `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, $2, $3, $4, 'Call-In')`,
            [client, date || new Date(), createdBy, `[Call-In Log]${reasonText}: ${comment}`]
        );

        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, eventId: eventRes.rows[0].eventid });
    } catch (err) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        clientDb.release();
    }
});

app.post('/api/callin/group', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const { group, date, comment, createdBy, reason, callInDate } = req.body;
        if (reason && !CALL_IN_REASONS.includes(reason)) {
            await clientDb.query('ROLLBACK');
            return res.status(400).json({ error: 'Unknown call-in reason.' });
        }
        // Optional date the call-in is for. The entry is still logged today; this only applies when it differs from today.
        const today = new Date().toLocaleDateString('en-CA');
        if (callInDate && !/^\d{4}-\d{2}-\d{2}$/.test(callInDate)) {
            await clientDb.query('ROLLBACK');
            return res.status(400).json({ error: 'Call-in date must be a valid date.' });
        }
        const forDate = callInDate && callInDate !== today ? callInDate : null;
        const reasonText = reason ? ` (Reason: ${reason})` : '';
        const forText = forDate ? ` (For: ${forDate})` : '';

        const clientsRes = await clientDb.query(`SELECT ClientId FROM Clients WHERE GroupId = $1 AND ProgramStatus = 'Active'`, [group]);
        for (let c of clientsRes.rows) {
            await clientDb.query(
                `INSERT INTO EventLog (Client, "Group", Type, Comment, CreatedBy, CallInReason, CallInDate) VALUES ($1, $2, 'Group Call-In', $3, $4, $5, $6)`,
                [c.clientid, group, comment, createdBy, reason || null, forDate]
            );
            await clientDb.query(
                `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, $2, $3, $4, 'Call-In')`,
                [c.clientid, date || new Date(), createdBy, `[Group Call-In Log]${forText}${reasonText}: ${comment}`]
            );
        }

        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, count: clientsRes.rows.length, forDate });
    } catch (err) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        clientDb.release();
    }
});

// --- POLYGRAPH MODULE ---
app.get('/api/polygraphs/slots', async (req, res) => {
    try {
        await deletePastOpenSlots();
        const query = `
            SELECT 
                s.*,
                a.appointmentid,
                a.client AS "assignedClientId",
                CASE 
                    WHEN a.appointmentid IS NOT NULL AND a.status = 'Scheduled' THEN 'Assigned'
                    -- Filled with no scheduled appointment: the reservation was cancelled after the appointment time
                    WHEN s.isfilled = TRUE THEN 'Closed'
                    ELSE 'Open'
                END AS status,
                CASE
                    WHEN c.clientid IS NOT NULL THEN CONCAT(c.lastname, ', ', c.firstname)
                    ELSE NULL
                END AS "assignedClientName"
            FROM PolygraphSlots s
            LEFT JOIN PolygraphAppointments a ON s.slotid = a.slotid AND a.status = 'Scheduled'
            LEFT JOIN Clients c ON a.client = c.clientid
            ORDER BY s.Date ASC, s.Time ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/polygraphs/slots', async (req, res) => {
    try {
        const { location, address, date, time, polygrapher, type, comments, slots } = req.body;

        // The examiner must be an active Polygrapher
        const examinerRes = await pool.query(
            "SELECT 1 FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Role = 'Polygrapher' AND Active = TRUE", [polygrapher]
        );
        if (examinerRes.rows.length === 0) {
            return res.status(400).json({ error: 'Choose an active polygrapher as the examiner.' });
        }

        if (date && time) {
            const todayStr = new Date().toLocaleDateString('en-CA');
            const now = new Date();
            const curHours = String(now.getHours()).padStart(2, '0');
            const curMinutes = String(now.getMinutes()).padStart(2, '0');
            const currentTimeStr = `${curHours}:${curMinutes}`;

            const dateOnly = date.includes('T') ? date.split('T')[0] : date;

            let timeOnly = time;
            if (/am|pm/i.test(time)) {
                const match = time.match(/(\d+):(\d+)\s*(am|pm)/i);
                if (match) {
                    let h = parseInt(match[1], 10);
                    const m = match[2];
                    const isPm = match[3].toLowerCase() === 'pm';
                    if (isPm && h < 12) h += 12;
                    if (!isPm && h === 12) h = 0;
                    timeOnly = `${String(h).padStart(2, '0')}:${m}`;
                }
            } else if (time.includes(':')) {
                const [h, m] = time.split(':');
                timeOnly = `${String(parseInt(h, 10)).padStart(2, '0')}:${m.slice(0, 2)}`;
            }

            if (dateOnly < todayStr || (dateOnly === todayStr && timeOnly < currentTimeStr)) {
                return res.status(400).json({ error: 'Appointment date and time must be in the future.' });
            }
        }

        const result = await pool.query(
            `INSERT INTO PolygraphSlots (Location, Address, Date, Time, Polygrapher, Type, Comments, SlotsAvailable)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING SlotId`,
            [location, address, date, time, polygrapher, type, comments, slots || 1]
        );
        res.status(201).json({ success: true, slotId: result.rows[0].slotid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/polygraphs/results', async (req, res) => {
    try {
        const { client, date, type, results, polygrapher, notes, slotId, incentiveContinued, user } = req.body;
        // A result without a client would never appear on any account
        if (!(Number(client) > 0)) {
            return res.status(400).json({ error: 'The polygraph result has no client. Select an assigned slot and try again.' });
        }
        // Continuing the incentive is off unless a Business Administrator overrides it on an Inconclusive or No Opinion result
        const continueIncentive = incentiveContinued === true;
        if (continueIncentive) {
            if (!POLY_INCENTIVE_OVERRIDE_RESULTS.includes(results)) {
                return res.status(400).json({ error: 'Incentive program continuation only applies to Inconclusive or No Opinion results.' });
            }
            const roleRes = await pool.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
            if (roleRes.rows[0]?.role !== 'Business Administrator') {
                return res.status(403).json({ error: 'Only Business Administrators can continue the incentive program.' });
            }
        }
        // When the polygraph took place comes from its slot, built the same way as the appointment's ScheduledDateTime
        let polygraphDateTime = null;
        if (slotId) {
            const slotRes = await pool.query('SELECT Date, Time FROM PolygraphSlots WHERE SlotId = $1', [slotId]);
            const slot = slotRes.rows[0];
            if (slot) {
                const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : String(slot.date).split('T')[0];
                polygraphDateTime = `${dateStr} ${slot.time}`;
            }
        }
        await pool.query(
            `INSERT INTO PolygraphResults (Client, Date, Type, Results, Polygrapher, Notes, PolygraphDateTime, IncentiveContinued)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [client, date, type, results, polygrapher, notes, polygraphDateTime, continueIncentive]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- TESTING MODULE ---
app.get('/api/testing/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        const result = await pool.query('SELECT * FROM Testing WHERE Client = $1 ORDER BY Date DESC', [clientId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/testing', async (req, res) => {
    try {
        const { client, testType, score, notes, date } = req.body;
        const result = await pool.query(
            'INSERT INTO Testing (Client, TestType, Score, Notes, Date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [client, testType, score, notes, date || new Date()]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- REPORTS MODULE ---
app.get('/api/reports/agent', async (req, res) => {
    try {
        const query = `
            SELECT c.ClientId, c.FirstName, c.LastName, c.DOCNumber, c.SupervisingAgent, c.AccountBalance,
            (SELECT COUNT(*) FROM Attendance WHERE Client = c.ClientId) AS TotalAttended,
            (SELECT Date FROM PolygraphResults WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastPolyDate,
            (SELECT Results FROM PolygraphResults WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastPolyResult
            FROM Clients c ORDER BY c.SupervisingAgent, c.LastName;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Payment method (Cash or Credit Card) taken at check-in, for the group income report. Rows saved before this column
// existed are filled in from the payment ledger when exactly one payment matches; the rest stay unrecorded.
pool.query('ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS PaymentMethod TEXT')
    .then(() => pool.query(`
        UPDATE Attendance a SET PaymentMethod = m.PaymentMethod
        FROM (
            SELECT a2.AttendanceId, MIN(f.PaymentMethod) AS PaymentMethod
            FROM Attendance a2
            JOIN FinancialTransactions f ON f.Client = a2.Client AND f.Type = 'Payment'
                AND f.Comments = 'Payment applied during ' || a2.Type || ' session on ' || to_char(a2.Date, 'YYYY-MM-DD') || '.'
            WHERE a2.AccountPaid > 0 AND a2.PaymentMethod IS NULL
            GROUP BY a2.AttendanceId
            HAVING COUNT(*) = 1
        ) m
        WHERE a.AttendanceId = m.AttendanceId AND m.PaymentMethod IS NOT NULL
    `))
    .catch(err => console.error('Could not add Attendance.PaymentMethod:', err.message));

// Every attendance row in the date range (YYYY-MM-DD, inclusive) with its group and client; the page totals them per group
app.get('/api/reports/groups', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))) {
            return res.status(400).json({ error: 'A start and end date (YYYY-MM-DD) are required.' });
        }
        const result = await pool.query(
            `SELECT a.AttendanceId, a."Group" AS GroupId, COALESCE(g.GroupName, 'No Group') AS GroupName, g.Counselor,
                    to_char(a.Date, 'YYYY-MM-DD') AS Date, a.SessionNumber, a.Type, a.GroupFee, a.AccountPaid, a.PaymentMethod, a.VoucherUsed,
                    c.ClientId, c.FirstName, c.LastName, c.DOCNumber
             FROM Attendance a
             JOIN Clients c ON c.ClientId = a.Client
             LEFT JOIN Groups g ON g.GroupId = a."Group"
             WHERE a.Date BETWEEN $1 AND $2
             ORDER BY GroupName, a.Date DESC, a.SessionNumber DESC, c.LastName, c.FirstName`,
            [from, to]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- GROUP CASH DEPOSITS ---
// Confirms the cash collected at one group session was taken to the bank. Over/short is AmountDeposited minus the
// session's cash; the report works it out from current attendance so later attendance edits show up as a difference.
pool.query(`
    CREATE TABLE IF NOT EXISTS GroupDeposits (
        DepositId SERIAL PRIMARY KEY,
        GroupId INT NOT NULL REFERENCES Groups(GroupId) ON DELETE CASCADE,
        SessionDate DATE NOT NULL,
        SessionNumber INT NOT NULL DEFAULT 1,
        AmountDeposited NUMERIC(10, 2) NOT NULL,
        DepositDate DATE NOT NULL,
        Notes TEXT,
        RecordedBy VARCHAR(255),
        RecordedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (GroupId, SessionDate, SessionNumber)
    )
`).catch(err => console.error('Could not create GroupDeposits table:', err.message));

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Deposits for sessions in the date range (YYYY-MM-DD, inclusive)
app.get('/api/reports/group-deposits', async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!YMD.test(String(from || '')) || !YMD.test(String(to || ''))) {
            return res.status(400).json({ error: 'A start and end date (YYYY-MM-DD) are required.' });
        }
        const result = await pool.query(
            `SELECT GroupId, to_char(SessionDate, 'YYYY-MM-DD') AS SessionDate, SessionNumber, AmountDeposited,
                    to_char(DepositDate, 'YYYY-MM-DD') AS DepositDate, Notes, RecordedBy, RecordedOn
             FROM GroupDeposits WHERE SessionDate BETWEEN $1 AND $2`,
            [from, to]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Records or corrects the deposit for one session
app.put('/api/reports/group-deposits', async (req, res) => {
    try {
        const { groupId, sessionDate, sessionNumber, amountDeposited, depositDate, notes, user } = req.body;
        if (await activeRoleFor(user) !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can record deposits.' });
        }
        const amount = Number(amountDeposited);
        if (!groupId || !YMD.test(String(sessionDate || '')) || !YMD.test(String(depositDate || '')) || !Number.isFinite(amount) || amount < 0) {
            return res.status(400).json({ error: 'A group session, deposit date, and an amount of $0.00 or more are required.' });
        }
        const session = Number(sessionNumber) || 1;
        const cash = await pool.query(
            `SELECT COALESCE(SUM(AccountPaid), 0) AS cash FROM Attendance
             WHERE "Group" = $1 AND Date = $2 AND SessionNumber = $3 AND PaymentMethod = 'Cash'`,
            [groupId, sessionDate, session]
        );
        const result = await pool.query(
            `INSERT INTO GroupDeposits (GroupId, SessionDate, SessionNumber, AmountDeposited, DepositDate, Notes, RecordedBy)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (GroupId, SessionDate, SessionNumber) DO UPDATE SET AmountDeposited = EXCLUDED.AmountDeposited,
                 DepositDate = EXCLUDED.DepositDate, Notes = EXCLUDED.Notes, RecordedBy = EXCLUDED.RecordedBy, RecordedOn = CURRENT_TIMESTAMP
             RETURNING GroupId, to_char(SessionDate, 'YYYY-MM-DD') AS SessionDate, SessionNumber, AmountDeposited,
                 to_char(DepositDate, 'YYYY-MM-DD') AS DepositDate, Notes, RecordedBy, RecordedOn`,
            [groupId, sessionDate, session, amount.toFixed(2), depositDate, String(notes || '').trim() || null, user]
        );
        const variance = amount - Number(cash.rows[0].cash);
        await logAction(
            user,
            'Group Deposit Recorded',
            `${await groupNameFor(groupId)} session ${sessionDate} #${session}: deposited $${amount.toFixed(2)} on ${depositDate} against $${Number(cash.rows[0].cash).toFixed(2)} cash` +
                (Math.abs(variance) < 0.005 ? ' (balanced).' : ` (${variance > 0 ? 'over' : 'short'} $${Math.abs(variance).toFixed(2)}).`),
            'Audit'
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/reports/group-deposits', async (req, res) => {
    try {
        const { groupId, sessionDate, sessionNumber, user } = req.body;
        if (await activeRoleFor(user) !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can remove deposits.' });
        }
        const removed = await pool.query(
            'DELETE FROM GroupDeposits WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3 RETURNING AmountDeposited',
            [groupId, sessionDate, Number(sessionNumber) || 1]
        );
        if (removed.rows.length === 0) {
            return res.status(404).json({ error: 'No deposit is recorded for that session.' });
        }
        await logAction(user, 'Group Deposit Removed', `${await groupNameFor(groupId)} session ${sessionDate} #${Number(sessionNumber) || 1}: removed the $${Number(removed.rows[0].amountdeposited).toFixed(2)} deposit.`, 'Audit');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports/deposit', async (req, res) => {
    try {
        // Refunds and disputes take money back; a won dispute puts it back
        const payments = await pool.query(`SELECT SUM(CASE WHEN Type IN ('Payment', 'Dispute Won') THEN Amount ELSE -Amount END)
                                           FROM FinancialTransactions WHERE Type IN ('Payment', 'Dispute Won', 'Refund', 'Dispute')`);
        const charges = await pool.query("SELECT SUM(Amount) FROM FinancialTransactions WHERE Type = 'Charge'");
        const transactions = await pool.query("SELECT * FROM FinancialTransactions ORDER BY Date DESC LIMIT 50");
        res.json({
            totalRevenue: Number(payments.rows[0].sum || 0),
            totalCharges: Number(charges.rows[0].sum || 0),
            recentTransactions: transactions.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ADMIN MODULE ---
app.get('/api/admin/employees', async (req, res) => {
    try {
        // Password hashes are never sent to the browser
        const result = await pool.query('SELECT EmployeeEmail, DisplayName, Role, Location, Active FROM EmployeeRoles ORDER BY DisplayName ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Edit an existing account's name, role, and active status. The email is the account key and cannot change.
app.put('/api/admin/employees/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const { displayName, role, active, updatedBy, password } = req.body;
        if (!String(displayName || '').trim() || !String(role || '').trim()) {
            return res.status(400).json({ error: 'Display name and role are required.' });
        }
        const before = await pool.query('SELECT DisplayName, Role, Active FROM EmployeeRoles WHERE EmployeeEmail = $1', [email]);
        if (before.rows.length === 0) {
            return res.status(404).json({ error: 'Account not found.' });
        }
        // Blank password means "keep the current one"
        const newPassword = String(password || '');
        const passwordHash = newPassword ? await hashPassword(newPassword) : null;
        const result = await pool.query(
            `UPDATE EmployeeRoles SET DisplayName = $1, Role = $2, Active = $3,
                PasswordHash = COALESCE($4, PasswordHash)
             WHERE EmployeeEmail = $5 RETURNING EmployeeEmail`,
            [displayName.trim(), role.trim(), active !== false, passwordHash, email]
        );
        const old = before.rows[0];
        await logAction(
            updatedBy || 'unknown',
            'Account Updated',
            `Updated ${email}: name "${old.displayname}" → "${displayName.trim()}", role ${old.role} → ${role.trim()}, active ${old.active} → ${active !== false}.${passwordHash ? ' Password changed.' : ''}`,
            'Admin'
        );
        res.json({ success: true, employeeEmail: result.rows[0].employeeemail });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/employees', async (req, res) => {
    try {
        const { employeeEmail, displayName, role, location, active, password } = req.body;
        if (!String(password || '').trim()) {
            return res.status(400).json({ error: 'A password is required for a new account.' });
        }
        const passwordHash = await hashPassword(String(password));
        await pool.query(
            'INSERT INTO EmployeeRoles (EmployeeEmail, DisplayName, Role, Location, Active, PasswordHash) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (EmployeeEmail) DO UPDATE SET Role = EXCLUDED.Role, Active = EXCLUDED.Active, PasswordHash = EXCLUDED.PasswordHash',
            [employeeEmail, displayName, role, location, active, passwordHash]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/logs', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM SystemLogs ORDER BY Timestamp DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SUPERVISING AGENTS ---
// Probation officer directory. Clients link to an agent by name through Clients.SupervisingAgent (case and spacing ignored).
pool.query(`
    CREATE TABLE IF NOT EXISTS SupervisingAgents (
        AgentId SERIAL PRIMARY KEY,
        Name VARCHAR(255) NOT NULL,
        Phone VARCHAR(50),
        Email VARCHAR(255),
        CreatedBy VARCHAR(255),
        CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).then(() => pool.query(`
    -- Older databases already had this table without the audit columns
    ALTER TABLE SupervisingAgents
        ADD COLUMN IF NOT EXISTS CreatedBy VARCHAR(255),
        ADD COLUMN IF NOT EXISTS CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP
`)).then(() => pool.query('CREATE UNIQUE INDEX IF NOT EXISTS SupervisingAgents_Name_Key ON SupervisingAgents (LOWER(TRIM(Name)))'))
  .catch(err => console.error('Could not create SupervisingAgents table:', err.message));

const AGENT_EDIT_ROLES = ['Business Administrator', 'Office Admin'];

const activeRoleFor = async (email) => {
    const roleRes = await pool.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [email]);
    return roleRes.rows[0]?.role || null;
};

app.get('/api/agents', async (req, res) => {
    try {
        const result = await pool.query('SELECT AgentId, Name, Phone, Email FROM SupervisingAgents ORDER BY Name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/agents', async (req, res) => {
    try {
        const { name, phone, email, user } = req.body;
        if (!AGENT_EDIT_ROLES.includes(await activeRoleFor(user))) {
            return res.status(403).json({ error: 'Only Business Administrators and Office Admins can add supervising agents.' });
        }
        if (!String(name || '').trim()) {
            return res.status(400).json({ error: 'A name is required.' });
        }
        const result = await pool.query(
            `INSERT INTO SupervisingAgents (Name, Phone, Email, CreatedBy) VALUES ($1, $2, $3, $4)
             RETURNING AgentId, Name, Phone, Email`,
            [name.trim(), phone?.trim() || null, email?.trim() || null, user]
        );
        await logAction(user, 'Agent Added', `Added supervising agent ${name.trim()}.`, 'Admin');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A supervising agent with that name already exists.' });
        res.status(500).json({ error: err.message });
    }
});

// A name change is carried to every client assigned under the old name, so they stay linked to the agent
app.put('/api/agents/:id', async (req, res) => {
    const db = await pool.connect();
    try {
        const { id } = req.params;
        const { name, phone, email, user } = req.body;
        if (!AGENT_EDIT_ROLES.includes(await activeRoleFor(user))) {
            return res.status(403).json({ error: 'Only Business Administrators and Office Admins can edit supervising agents.' });
        }
        if (!String(name || '').trim()) {
            return res.status(400).json({ error: 'A name is required.' });
        }
        const newName = name.trim();

        await db.query('BEGIN');
        const before = await db.query('SELECT Name FROM SupervisingAgents WHERE AgentId = $1 FOR UPDATE', [id]);
        if (before.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Supervising agent not found.' });
        }
        const oldName = before.rows[0].name;
        const result = await db.query(
            `UPDATE SupervisingAgents SET Name = $1, Phone = $2, Email = $3 WHERE AgentId = $4
             RETURNING AgentId, Name, Phone, Email`,
            [newName, phone?.trim() || null, email?.trim() || null, id]
        );

        let clientsRenamed = 0;
        if (oldName !== newName) {
            const moved = await db.query(
                `UPDATE Clients SET SupervisingAgent = $1
                 WHERE LOWER(TRIM(SupervisingAgent)) = LOWER(TRIM($2)) AND SupervisingAgent <> $1
                 RETURNING ClientId`,
                [newName, oldName]
            );
            for (const row of moved.rows) {
                await logClientChange(db, {
                    clientId: row.clientid, changedBy: user, changeType: 'Supervising Agent',
                    oldValue: oldName, newValue: newName, details: 'Agent renamed in the Supervising Agents directory.',
                });
            }
            clientsRenamed = moved.rows.length;
        }
        await db.query('COMMIT');

        await logAction(user, 'Agent Updated',
            `Updated supervising agent ${oldName}${oldName !== newName ? ` → ${newName} (${clientsRenamed} client(s) updated)` : ''}.`, 'Admin');
        res.json({ agent: result.rows[0], clientsRenamed });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') return res.status(409).json({ error: 'A supervising agent with that name already exists.' });
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Clients keep the agent's name on their record; only the directory entry is removed
app.delete('/api/agents/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req.body;
        if (await activeRoleFor(user) !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can delete supervising agents.' });
        }
        const removed = await pool.query('DELETE FROM SupervisingAgents WHERE AgentId = $1 RETURNING Name', [id]);
        if (removed.rows.length === 0) {
            return res.status(404).json({ error: 'Supervising agent not found.' });
        }
        await logAction(user, 'Agent Deleted', `Deleted supervising agent ${removed.rows[0].name}.`, 'Admin');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Slot times are stored as "HH:MM" or "h:mm AM"; the case note reads like "9:00 AM"
const formatSlotTime = (value) => {
    const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*$/i.exec(String(value || ''));
    if (!match) return String(value || '');
    const h = parseInt(match[1], 10);
    if (match[3]) return `${h}:${match[2]} ${match[3].toUpperCase()}`;
    return `${h % 12 || 12}:${match[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

// Describes a slot for case notes: "at <location> on 10/19/2026 @ 9:00 AM with examiner <name>"
const slotNoteContext = async (slot) => {
    const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : String(slot.date).split('T')[0];
    const [year, month, day] = dateStr.split('-');
    const examinerRes = await pool.query('SELECT DisplayName FROM EmployeeRoles WHERE EmployeeEmail = $1', [slot.polygrapher]);
    const examiner = examinerRes.rows[0]?.displayname || slot.polygrapher || 'Unassigned';
    return `at ${slot.location} on ${Number(month)}/${Number(day)}/${year} @ ${formatSlotTime(slot.time)} with examiner ${examiner}`;
};

// Assign Client to Polygraph Slot. The client needs a full set of poly fee vouchers (POLY_VOUCHER_MAX) and an
// account balance of $0.00 or better. Otherwise the request is refused with what is owed, so the front end can take
// that payment. Scheduling uses all of the vouchers.
app.post('/api/polygraphs/slots/:slotId/assign', async (req, res) => {
    const db = await pool.connect();
    try {
        const { slotId } = req.params;
        const { clientId, type, user, comments, bypassWaitPeriod } = req.body;

        if (!clientId) {
            return res.status(400).json({ error: 'Client ID is required.' });
        }

        const slotRes = await db.query('SELECT * FROM PolygraphSlots WHERE SlotId = $1', [slotId]);
        if (slotRes.rows.length === 0) {
            return res.status(404).json({ error: 'Slot not found.' });
        }

        const slot = slotRes.rows[0];
        if (slot.isfilled) {
            const bookedRes = await db.query("SELECT 1 FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);
            if (bookedRes.rows.length === 0) {
                return res.status(409).json({ error: 'This slot is closed: its reservation was cancelled after the appointment time.' });
            }
        }
        const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : String(slot.date).split('T')[0];
        const scheduledDateTime = `${dateStr} ${slot.time}`;
        const slotType = type || slot.type || 'Maintenance';
        const noteContext = await slotNoteContext(slot);

        // After a No Deception Indicated result, the next polygraph must be at least POLY_NDI_WAIT after the day it took place
        const waitRes = await db.query(
            `SELECT r.Results,
                    to_char(r.Taken, 'MM/DD/YYYY') AS lastTaken,
                    to_char(r.Taken::date + INTERVAL '${POLY_NDI_WAIT}', 'MM/DD/YYYY') AS earliest,
                    s.Date < (r.Taken::date + INTERVAL '${POLY_NDI_WAIT}')::date AS tooSoon
             FROM PolygraphSlots s
             CROSS JOIN LATERAL (${LAST_POLY_RESULT_SQL('$2')}) r
             WHERE s.SlotId = $1`,
            [slotId, clientId]
        );
        const lastPoly = waitRes.rows[0];
        // Set when a Business Administrator chose to schedule inside the waiting period; recorded on the case note and system log
        let waitBypassed = null;
        if (lastPoly && lastPoly.results === 'No Deception Indicated' && lastPoly.toosoon) {
            if (!bypassWaitPeriod) {
                return res.status(409).json({
                    code: 'POLY_TOO_SOON',
                    error: `This client's last polygraph (${lastPoly.lasttaken}) was No Deception Indicated, so the next one must be at least 5 months and 2 weeks later: on or after ${lastPoly.earliest}. Choose a later slot.`,
                    lastPolyDate: lastPoly.lasttaken, earliestDate: lastPoly.earliest
                });
            }
            const roleRes = await db.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
            if (roleRes.rows[0]?.role !== 'Business Administrator') {
                return res.status(403).json({ error: 'Only Business Administrators can bypass the polygraph waiting period.' });
            }
            waitBypassed = lastPoly;
        }

        await db.query('BEGIN');
        const clientRes = await db.query('SELECT PolyFeeVoucher, PolyFeePaid, PolyFee, AccountBalance FROM Clients WHERE ClientId = $1 FOR UPDATE', [clientId]);
        if (clientRes.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Client not found.' });
        }

        // One scheduled polygraph per client at a time. Checked after locking the client so two bookings can't race past it.
        const existingRes = await db.query(
            `SELECT s.SlotId FROM PolygraphAppointments a JOIN PolygraphSlots s ON s.SlotId = a.SlotId
             WHERE a.Client = $1 AND a.Status = 'Scheduled' AND a.SlotId <> $2 LIMIT 1`,
            [clientId, slotId]
        );
        if (existingRes.rows.length > 0) {
            await db.query('ROLLBACK');
            const existing = (await db.query('SELECT * FROM PolygraphSlots WHERE SlotId = $1', [existingRes.rows[0].slotid])).rows[0];
            return res.status(409).json({
                code: 'POLY_ALREADY_SCHEDULED',
                slotId: existing.slotid,
                error: `This client already has a polygraph scheduled ${await slotNoteContext(existing)}. Cancel that reservation before scheduling another.`,
            });
        }
        const vouchers = Number(clientRes.rows[0].polyfeevoucher || 0);
        // Stored sign: positive = owes
        const accountBalance = Number(clientRes.rows[0].accountbalance || 0);
        if (vouchers < POLY_VOUCHER_MAX || accountBalance > 0) {
            await db.query('ROLLBACK');
            const polyFeePaid = Number(clientRes.rows[0].polyfeepaid || 0);
            const polyFee = Number(clientRes.rows[0].polyfee || 0);
            // Paying off the poly fee is what fills the vouchers, so it is only owed while they are short
            const amountDue = vouchers < POLY_VOUCHER_MAX ? Math.max(0, polyFee - polyFeePaid) : 0;
            const balanceDue = Math.max(0, accountBalance);
            const problems = [];
            if (vouchers < POLY_VOUCHER_MAX) problems.push(`has ${vouchers}/${POLY_VOUCHER_MAX} poly fee vouchers`);
            if (balanceDue > 0) problems.push(`owes $${balanceDue.toFixed(2)} on the account`);
            return res.status(409).json({
                code: 'POLY_SCHEDULING_REQUIREMENTS',
                error: `Scheduling a polygraph needs ${POLY_VOUCHER_MAX} poly fee vouchers and an account balance of $0.00 or better; this client ${problems.join(' and ')}.`,
                vouchers, polyFeePaid, polyFee, accountBalance, amountDue, balanceDue
            });
        }

        // Delete any existing scheduled appointment on this slot
        await db.query("DELETE FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);

        // Insert new scheduled appointment
        await db.query(
            `INSERT INTO PolygraphAppointments (SlotId, Client, ScheduledDateTime, Polygrapher, Type, Status, PolyVouchersUsed)
             VALUES ($1, $2, $3, $4, $5, 'Scheduled', $6)`,
            [slotId, clientId, scheduledDateTime, slot.polygrapher, slotType, POLY_VOUCHER_MAX]
        );

        // Mark slot as filled
        await db.query('UPDATE PolygraphSlots SET IsFilled = TRUE, Type = $1 WHERE SlotId = $2', [slotType, slotId]);

        // Use the vouchers. The paid-in-full poly fee they came from is spent too, so the next polygraph starts a new poly fee.
        await db.query(
            `UPDATE Clients SET
                PolyFeeVoucher = PolyFeeVoucher - $1,
                PolyFeePaid = CASE WHEN PolyFeePaid >= PolyFee THEN PolyFeePaid - PolyFee ELSE PolyFeePaid END,
                PolyVouchersBeforeFill = NULL
             WHERE ClientId = $2`,
            [POLY_VOUCHER_MAX, clientId]
        );

        // Spending the last fill a poly fee override allows ends it and puts the regular poly fee back
        let overrideText = '';
        const polyOverride = await activePolyFeeOverride(db, clientId);
        if (polyOverride && Number(polyOverride.fillsused) >= Number(polyOverride.fillsallowed)) {
            const { override } = await endPolyFeeOverride(db, clientId);
            overrideText = ` Temporary poly fee override (${polyOverrideText(override)}) used up; poly fee back to $${Number(override.regularfee).toFixed(2)}.`;
            await logClientChange(db, {
                clientId, changedBy: user, changeType: 'Poly Fee Override',
                oldValue: polyOverrideText(override), newValue: 'Ended',
                details: `All ${override.fillsallowed} fill(s) used; poly fee back to $${Number(override.regularfee).toFixed(2)}.`,
            });
        }

        // Record the appointment in the client's case notes
        const bypassText = waitBypassed
            ? `Scheduled inside the waiting period after the No Deception Indicated polygraph on ${waitBypassed.lasttaken} (earliest normal date ${waitBypassed.earliest}) by Business Administrator override.`
            : '';
        const noteText = `Polygraph scheduled ${noteContext}. Used ${POLY_VOUCHER_MAX} poly fee vouchers.${overrideText}`
            + (bypassText ? ` ${bypassText}` : '')
            + (String(comments || '').trim() ? ` Notes: ${String(comments).trim()}` : '');
        await db.query(
            `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, 'Polygraph')`,
            [clientId, user || 'Unknown', noteText]
        );

        await db.query('COMMIT');
        if (waitBypassed) {
            await logAction(user, 'Polygraph Wait Bypassed', `Client ID ${clientId} scheduled in slot ${slotId}. ${bypassText}`);
        }
        res.json({ success: true, message: 'Client assigned to polygraph slot successfully.' });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        console.error('Error assigning client to slot:', err);
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Hours of notice a client must give for a requested cancellation to get their poly fee vouchers back
const POLY_CANCEL_NOTICE_HOURS = 48;

// When a slot starts, in server local time. Times may be stored as "14:30:00" or "2:30 PM".
const slotStart = (slot) => {
    const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : String(slot.date || '').split('T')[0];
    const [year, month, day] = dateStr.split('-').map(Number);
    const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*$/i.exec(String(slot.time || ''));
    if (!year || !month || !day || !match) return null;
    let hours = parseInt(match[1], 10) % (match[3] ? 12 : 24);
    if (match[3] && match[3].toLowerCase() === 'pm') hours += 12;
    return new Date(year, month - 1, day, hours, Number(match[2]));
};

// Deletes open slots (nobody booked) whose start time has passed. Runs before slots are listed and every few minutes.
const deletePastOpenSlots = async () => {
    const openRes = await pool.query(
        `SELECT s.* FROM PolygraphSlots s
         WHERE s.IsFilled = FALSE
           AND NOT EXISTS (SELECT 1 FROM PolygraphAppointments a WHERE a.SlotId = s.SlotId)`
    );
    const pastIds = openRes.rows
        .filter(slot => { const start = slotStart(slot); return start !== null && start.getTime() <= Date.now(); })
        .map(slot => slot.slotid);
    if (pastIds.length > 0) {
        await pool.query('DELETE FROM PolygraphSlots WHERE SlotId = ANY($1::int[]) AND IsFilled = FALSE', [pastIds]);
        console.log(`Deleted ${pastIds.length} past open polygraph slot(s): ${pastIds.join(', ')}`);
    }
};
setInterval(() => deletePastOpenSlots().catch(err => console.error('Error deleting past open slots:', err)), 5 * 60 * 1000);

// Whether a cancellation returns the booking's poly fee vouchers: true/false is fixed by the reason, null leaves it to staff
const polyVoucherReturnRule = (reason, slot) => {
    switch (reason) {
        case 'Weather':
        case 'Examiner rescheduled':
            return true;
        case 'Client late / did not show':
            return false;
        case 'Client requested cancellation': {
            const start = slotStart(slot);
            return start ? start.getTime() - Date.now() > POLY_CANCEL_NOTICE_HOURS * 60 * 60 * 1000 : null;
        }
        default:
            return null;
    }
};

// Reopen Polygraph Slot (Cancel reservation and make slot available again).
// The poly fee vouchers the booking used go back to the client as the cancellation reason dictates (polyVoucherReturnRule),
// or, where the reason leaves it open, unless returnVouchers is false. A Business Administrator can override the reason's
// rule (overrideVoucherRule), in which case returnVouchers decides. Money paid toward the poly fee is not refunded.
app.post('/api/polygraphs/slots/:slotId/open', async (req, res) => {
    const db = await pool.connect();
    try {
        const { slotId } = req.params;
        const { reason, notes, user, returnVouchers, overrideVoucherRule } = req.body;
        if (!String(reason || '').trim()) {
            return res.status(400).json({ error: 'A cancellation reason is required.' });
        }
        if (overrideVoucherRule) {
            const roleRes = await db.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
            if (roleRes.rows[0]?.role !== 'Business Administrator') {
                return res.status(403).json({ error: 'Only Business Administrators can override the poly voucher return.' });
            }
        }

        const slotRes = await db.query('SELECT * FROM PolygraphSlots WHERE SlotId = $1', [slotId]);
        if (slotRes.rows.length === 0) {
            return res.status(404).json({ error: 'Slot not found.' });
        }
        const slot = slotRes.rows[0];
        const noteContext = await slotNoteContext(slot);
        // A reservation cancelled after its appointment time leaves the slot closed instead of reopening it
        const start = slotStart(slot);
        const appointmentPassed = start !== null && start.getTime() <= Date.now();

        await db.query('BEGIN');

        // Remember who was booked so the cancellation can be logged on their account
        const apptRes = await db.query("SELECT Client, PolyVouchersUsed FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);

        // Remove the scheduled appointment
        await db.query("DELETE FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);

        if (apptRes.rows.length > 0) {
            const { client, polyvouchersused } = apptRes.rows[0];
            const rule = overrideVoucherRule ? null : polyVoucherReturnRule(String(reason).trim(), slot);
            const ruleOverridden = overrideVoucherRule && polyVoucherReturnRule(String(reason).trim(), slot) !== null;
            const refunded = (rule ?? returnVouchers !== false) ? Number(polyvouchersused || 0) : 0;
            if (refunded > 0) {
                await db.query(
                    'UPDATE Clients SET PolyFeeVoucher = LEAST(PolyFeeVoucher + $1, $2) WHERE ClientId = $3',
                    [refunded, POLY_VOUCHER_MAX, client]
                );
            }
            const noteText = `Polygraph reservation canceled ${noteContext}. Reason: ${String(reason).trim()}.`
                + (refunded > 0 ? ` ${refunded} poly fee vouchers returned to the client.` : '')
                + (ruleOverridden ? ` Poly voucher return set to ${refunded > 0 ? 'returned' : 'not returned'} by Business Administrator override.` : '')
                + (appointmentPassed ? ' The slot was not reopened because the appointment time had passed.' : '')
                + (String(notes || '').trim() ? ` Notes: ${String(notes).trim()}` : '');
            await db.query(
                `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, 'Polygraph')`,
                [client, user || 'Unknown', noteText]
            );
        }

        if (appointmentPassed && apptRes.rows.length > 0) {
            await db.query('COMMIT');
            return res.json({ success: true, reopened: false, message: 'Reservation cancelled. The appointment time has passed, so the slot was closed instead of reopened.' });
        }

        // Mark slot as not filled (Open)
        await db.query('UPDATE PolygraphSlots SET IsFilled = FALSE WHERE SlotId = $1', [slotId]);

        await db.query('COMMIT');
        res.json({ success: true, reopened: true, message: 'Reservation removed. Slot is now open for scheduling.' });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        console.error('Error reopening slot:', err);
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Delete Polygraph Slot (and any associated appointments)
app.delete('/api/polygraphs/slots/:slotId', async (req, res) => {
    try {
        const { slotId } = req.params;
        await pool.query('DELETE FROM PolygraphAppointments WHERE SlotId = $1', [slotId]);
        await pool.query('DELETE FROM PolygraphSlots WHERE SlotId = $1', [slotId]);
        res.json({ success: true, message: 'Polygraph slot deleted successfully.' });
    } catch (err) {
        console.error('Error deleting slot:', err);
        res.status(500).json({ error: 'Failed to delete slot.' });
    }
});

const PORT = process.env.PORT || 5000;
// HTTPS using the self-signed certificate in backend/certs (see SSL_PFX_PASSWORD in .env)
const https = require('https');
const fs = require('fs');
const path = require('path');
const tlsOptions = {
  pfx: fs.readFileSync(path.join(__dirname, 'certs', 'stop-server.pfx')),
  passphrase: process.env.SSL_PFX_PASSWORD,
};
https.createServer(tlsOptions, app).listen(5000, '0.0.0.0', () => {
  console.log('STOP Backend Server running on https://OKC-SERVER:5000');
});