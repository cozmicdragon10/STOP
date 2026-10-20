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
                ${ATTENDED_THIS_MONTH} AS AttendedThisMonth
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

app.get('/api/clients/:id/attendance', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT a.*, g.GroupName FROM Attendance a LEFT JOIN Groups g ON a."Group" = g.GroupId WHERE a.Client = $1 ORDER BY a.Date DESC`,
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

app.get('/api/clients/:id/polygraphs', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM PolygraphResults WHERE Client = $1 ORDER BY Date DESC', [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Client Information
app.put('/api/clients/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            firstname, middlename, lastname, docnumber, supervisingagent,
            programstartdate, programstatus, phase, groupid,
            treatmentfee, accountbalance, vouchers,
            address, city, county, state, zip,
            mainphone, altphone, emergencycontact, emergencycontactphone,
            comments, programtype
        } = req.body;

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
                ProgramType = COALESCE($23, ProgramType)
            WHERE ClientId = $24`,
            [
                firstname || null, middlename || null, lastname || null, docnumber || null, supervisingagent || null,
                programstartdate || null, programstatus || null, phase || null, groupid ? Number(groupid) : null,
                treatmentfee !== undefined && treatmentfee !== null && treatmentfee !== '' ? Number(treatmentfee) : null,
                accountbalance !== undefined && accountbalance !== null && accountbalance !== '' ? Number(accountbalance) : null,
                vouchers !== undefined && vouchers !== null && vouchers !== '' ? Number(vouchers) : null,
                address || null, city || null, county || null, state || null, zip || null,
                mainphone || null, altphone || null, emergencycontact || null, emergencycontactphone || null,
                comments || null, programtype || null, id
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
            comments, programtype
        } = req.body;

        const required = {
            'First name': firstname, 'Last name': lastname, 'DOC #': docnumber, 'Supervising agent': supervisingagent,
            'Program start date': programstartdate, 'Program status': programstatus, Phase: phase
        };
        const missing = Object.entries(required).filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
        if (missing.length > 0) {
            return res.status(400).json({ error: `Required: ${missing.join(', ')}.` });
        }

        const result = await pool.query(
            `INSERT INTO Clients (
                FirstName, MiddleName, LastName, DOCNumber, SupervisingAgent,
                ProgramStartDate, ProgramStatus, Phase, GroupId,
                Address, City, County, State, Zip,
                MainPhone, AltPhone, EmergencyContact, EmergencyContactPhone,
                Comments, ProgramType
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10, $11, $12, $13, $14,
                $15, $16, $17, $18,
                $19, COALESCE($20, 'State SO')
            ) RETURNING ClientId`,
            [
                firstname.trim(), middlename?.trim() || null, lastname.trim(), docnumber.trim(), supervisingagent.trim(),
                programstartdate, programstatus, phase.trim(), groupid ? Number(groupid) : null,
                address || null, city || null, county || null, state || null, zip || null,
                mainphone || null, altphone || null, emergencycontact || null, emergencycontactphone || null,
                comments || null, programtype || null
            ]
        );
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
            `SELECT c.*, ${ATTENDED_THIS_MONTH} AS AttendedThisMonth FROM Clients c WHERE c.GroupId = $1`,
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
        const { clientId } = req.body;
        await pool.query('UPDATE Clients SET GroupId = $1 WHERE ClientId = $2', [id, clientId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ATTENDANCE & PAYMENTS ---
// Writes one attendance row, its ledger entry, and the client's balance.
// Takes the caller's transaction client so batch check-ins stay all-or-nothing.
// State SO Phase 1 (weekly) and Phase 2 (monthly) clients are charged the treatment fee once per calendar month, on their first attendance.
// Mirrors isMonthlyFeeClient in frontend/src/utils/soPhases.ts.
const isMonthlyFeeClient = (row) => row.programtype === 'State SO' && (row.phase === 'Phase 1 - Weekly' || row.phase === 'Phase 2 - Monthly');

const recordAttendance = async (db, { client, group, date, paid, groupFee, accountPaid, paymentMethod, voucherUsed, type, comments, createdBy }) => {
    const clientRes = await db.query('SELECT AccountBalance, ProgramType, Phase FROM Clients WHERE ClientId = $1 FOR UPDATE', [client]);
    if (clientRes.rows.length === 0) {
        throw new Error(`Client ${client} not found.`);
    }

    const sessionDate = date || new Date().toISOString().split('T')[0];
    const oldBalance = Number(clientRes.rows[0].accountbalance || 0);
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
        `INSERT INTO Attendance (Client, "Group", Date, Paid, GroupFee, AccountPaid, AccountTotal, VoucherUsed, Type, Comments, CreatedBy)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING AttendanceId;`,
        [client, group || null, sessionDate, paid, feeNum, paidNum, newBalance, voucherUsed, type, comments || null, createdBy]
    );

    if (paidNum > 0) {
        await db.query(
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod)
             VALUES ($1, NOW(), 'Payment', $2, 'Group Fee', $3, $4, $5)`,
            [client, paidNum, newBalance, `Payment applied during ${type} session on ${sessionDate}.`, paymentMethod]
        );
    } else if (feeNum > 0) {
        await db.query(
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments)
             VALUES ($1, NOW(), 'Charge', $2, 'Group Fee', $3, $4)`,
            [client, feeNum, newBalance, `${type} fee assessed on ${sessionDate}.`]
        );
    }

    await db.query(
        'UPDATE Clients SET AccountBalance = $1, LastDateAttended = $2 WHERE ClientId = $3',
        [newBalance, sessionDate, client]
    );

    return { attendanceId: attRes.rows[0].attendanceid, newBalance };
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

// Group check-in: every client on the session sheet is saved in one transaction
app.post('/api/attendance/batch', async (req, res) => {
    const { group, date, type, createdBy, entries } = req.body;

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
        const results = [];
        for (const entry of entries) {
            const { attendanceId, newBalance } = await recordAttendance(clientDb, {
                ...entry, group, date, type: type || 'Group', createdBy, paid: true
            });
            results.push({ client: entry.client, attendanceId, newBalance });
        }
        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, count: results.length, results });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

app.post('/api/financials/payment', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const { client, amount, comments, createdBy, paymentMethod } = req.body;
        const allowedMethods = ['Cash', 'Credit Card'];
        if (!allowedMethods.includes(paymentMethod)) {
            await clientDb.query('ROLLBACK');
            return res.status(400).json({ error: 'Choose a payment method: Cash or Credit Card.' });
        }

        const clientRes = await clientDb.query('SELECT AccountBalance FROM Clients WHERE ClientId = $1', [client]);
        const oldBalance = Number(clientRes.rows[0].accountbalance || 0);
        const payAmount = Number(amount || 0);
        const newBalance = oldBalance - payAmount;

        await clientDb.query(
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod)
             VALUES ($1, NOW(), 'Payment', $2, 'Account Payment', $3, $4, $5)`,
            [client, payAmount, newBalance, comments || `Direct account payment processed by ${createdBy}`, paymentMethod]
        );

        await clientDb.query('UPDATE Clients SET AccountBalance = $1 WHERE ClientId = $2', [newBalance, client]);

        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, newBalance });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        clientDb.release();
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
        const query = `
            SELECT 
                s.*,
                a.appointmentid,
                a.client AS assignedclientid,
                CASE 
                    WHEN a.appointmentid IS NOT NULL AND a.status = 'Scheduled' THEN 'Assigned'
                    WHEN s.isfilled = TRUE THEN 'Assigned'
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
        const { client, date, type, results, polygrapher, notes } = req.body;
        await pool.query(
            `INSERT INTO PolygraphResults (Client, Date, Type, Results, Polygrapher, Notes)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [client, date, type, results, polygrapher, notes]
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

app.get('/api/reports/deposit', async (req, res) => {
    try {
        const payments = await pool.query("SELECT SUM(Amount) FROM FinancialTransactions WHERE Type = 'Payment'");
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

// Assign Client to Polygraph Slot
app.post('/api/polygraphs/slots/:slotId/assign', async (req, res) => {
    try {
        const { slotId } = req.params;
        const { clientId, type, user, comments } = req.body;

        if (!clientId) {
            return res.status(400).json({ error: 'Client ID is required.' });
        }

        const slotRes = await pool.query('SELECT * FROM PolygraphSlots WHERE SlotId = $1', [slotId]);
        if (slotRes.rows.length === 0) {
            return res.status(404).json({ error: 'Slot not found.' });
        }

        const slot = slotRes.rows[0];
        const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : String(slot.date).split('T')[0];
        const scheduledDateTime = `${dateStr} ${slot.time}`;
        const slotType = type || slot.type || 'Maintenance';

        // Delete any existing scheduled appointment on this slot
        await pool.query("DELETE FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);

        // Insert new scheduled appointment
        await pool.query(
            `INSERT INTO PolygraphAppointments (SlotId, Client, ScheduledDateTime, Polygrapher, Type, Status)
             VALUES ($1, $2, $3, $4, $5, 'Scheduled')`,
            [slotId, clientId, scheduledDateTime, slot.polygrapher, slotType]
        );

        // Mark slot as filled
        await pool.query('UPDATE PolygraphSlots SET IsFilled = TRUE, Type = $1 WHERE SlotId = $2', [slotType, slotId]);

        // Record the appointment in the client's case notes
        const noteText = `Polygraph scheduled ${await slotNoteContext(slot)}.`
            + (String(comments || '').trim() ? ` Notes: ${String(comments).trim()}` : '');
        await pool.query(
            `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, 'Polygraph')`,
            [clientId, user || 'Unknown', noteText]
        );

        res.json({ success: true, message: 'Client assigned to polygraph slot successfully.' });
    } catch (err) {
        console.error('Error assigning client to slot:', err);
        res.status(500).json({ error: err.message });
    }
});

// Reopen Polygraph Slot (Cancel reservation and make slot available again)
app.post('/api/polygraphs/slots/:slotId/open', async (req, res) => {
    try {
        const { slotId } = req.params;
        const { reason, notes, user } = req.body;
        if (!String(reason || '').trim()) {
            return res.status(400).json({ error: 'A cancellation reason is required.' });
        }

        const slotRes = await pool.query('SELECT * FROM PolygraphSlots WHERE SlotId = $1', [slotId]);
        if (slotRes.rows.length === 0) {
            return res.status(404).json({ error: 'Slot not found.' });
        }
        const slot = slotRes.rows[0];

        // Remember who was booked so the cancellation can be logged on their account
        const apptRes = await pool.query("SELECT Client FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);

        // Remove the scheduled appointment
        await pool.query("DELETE FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);

        if (apptRes.rows.length > 0) {
            const noteText = `Polygraph reservation canceled ${await slotNoteContext(slot)}. Reason: ${String(reason).trim()}.`
                + (String(notes || '').trim() ? ` Notes: ${String(notes).trim()}` : '');
            await pool.query(
                `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, 'Polygraph')`,
                [apptRes.rows[0].client, user || 'Unknown', noteText]
            );
        }

        // Mark slot as not filled (Open)
        await pool.query('UPDATE PolygraphSlots SET IsFilled = FALSE WHERE SlotId = $1', [slotId]);

        res.json({ success: true, message: 'Reservation removed. Slot is now open for scheduling.' });
    } catch (err) {
        console.error('Error reopening slot:', err);
        res.status(500).json({ error: err.message });
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