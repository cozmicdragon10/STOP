const express = require('express');
const { logAction, pool } = require('../db');
const { OPEN_GROUP_ADMIN_ROLES, activeRoleFor, openGroupViewer } = require('../lib/access');
const { recordAttendance } = require('../lib/attendance');
const { logClientChange } = require('../lib/changeLog');
const { BIP_CHECKIN_BLOCK, INDIVIDUAL_SESSION_TYPES, NEEDS_OUR_INTAKE, YMD } = require('../lib/sql');

const router = express.Router();

router.get('/api/session-types', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM SessionTypes ORDER BY Category, Active DESC, Name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const SESSION_TYPE_KINDS = ['Standard', 'BIP Intake', 'BIP Reinstate'];
const validPrice = (v) => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0;

// Checks a price list entry from the body; returns an error message or null
const sessionTypeProblem = ({ category, name, fee, kind = 'Standard', lateFee }) => {
    if (!INDIVIDUAL_SESSION_TYPES.includes(category)) return 'Choose Assessment or Individual.';
    if (!String(name || '').trim()) return 'Enter a name.';
    if (!validPrice(fee)) return 'Enter a price of $0.00 or more.';
    if (!SESSION_TYPE_KINDS.includes(kind)) return `Choose a kind: ${SESSION_TYPE_KINDS.join(', ')}.`;
    if (kind !== 'Standard' && category !== 'Assessment') return 'Only assessments can be a BIP intake or BIP reinstate.';
    if (kind === 'BIP Reinstate' && !validPrice(lateFee)) return 'Enter the price for a reinstate done 6 months to a year after the intake.';
    return null;
};

// The stored settings for a price list entry; BIP intakes and reinstates are always BIP only
const sessionTypeValues = ({ name, fee, kind = 'Standard', bipOnly, lateFee }) => [
    String(name).trim().slice(0, 100), Number(fee).toFixed(2), kind, kind !== 'Standard' || bipOnly === true,
    kind === 'BIP Reinstate' ? Number(lateFee).toFixed(2) : null,
];
const describeSessionType = (t) => `${t.name} $${Number(t.fee).toFixed(2)}${t.latefee !== null && t.latefee !== undefined ? ` / $${Number(t.latefee).toFixed(2)} after 6 months` : ''}`
    + `${t.kind !== 'Standard' ? ` [${t.kind}]` : ''}${t.biponly ? ' (BIP only)' : ''}${t.active === false ? ' (inactive)' : ''}`;

// The client's most recent completed BIP intake (BIP Intake or DV Assessment, here or at another provider) on or before
// the date, and where the date falls: 'early' (under 6 months after it), 'late' (6 months to under a year), or 'expired'
// (a year or more). Null when there is none.
const lastBipIntake = async (db, clientId, onDate) => {
    const r = await db.query(
        `SELECT to_char(x.Done, 'YYYY-MM-DD') AS IntakeDate, x.Name AS IntakeName,
                CASE WHEN $2::date < x.Done + INTERVAL '6 months' THEN 'early'
                     WHEN $2::date < x.Done + INTERVAL '1 year' THEN 'late' ELSE 'expired' END AS Window
         FROM (
             SELECT a.Date AS Done, st.Name FROM Attendance a JOIN SessionTypes st ON st.SessionTypeId = a.SessionTypeId
             WHERE a.Client = $1 AND st.Kind = 'BIP Intake'
             UNION ALL
             SELECT o.AssessmentDate, o.AssessmentType || ' (' || o.ProviderName || ')' FROM OutsideBipAssessments o WHERE o.ClientId = $1
         ) x
         WHERE x.Done <= $2::date
         ORDER BY x.Done DESC LIMIT 1`,
        [clientId, onDate]
    );
    return r.rows[0] || null;
};

// The client's Progress tab: for BIP clients, why they can't be checked into group yet (block: 'intake', 'our-intake',
// 'reinstate', or null) and their last discharge; every completed assessment (done here, or a BIP intake recorded from
// another provider), newest first; and the assessments still open on the Assessments & Individuals tab.
router.get('/api/clients/:id/progress', async (req, res) => {
    try {
        const { id } = req.params;
        const statusRes = await pool.query(
            `SELECT c.ProgramType, ${BIP_CHECKIN_BLOCK} AS Block,
                    (SELECT to_char(MAX(d.DischargedOn), 'YYYY-MM-DD') FROM ClientDischarges d WHERE d.ClientId = c.ClientId) AS LastDischarge
             FROM Clients c WHERE c.ClientId = $1`,
            [id]
        );
        if (!statusRes.rows[0]) return res.status(404).json({ error: 'Client not found.' });
        const done = await pool.query(
            `SELECT 'here' AS Source, a.AttendanceId AS Id, COALESCE(st.Name, 'Assessment') AS Name, COALESCE(st.Kind, 'Standard') AS Kind,
                    to_char(a.Date, 'YYYY-MM-DD') AS Date, a.Provider, a.Comments AS Notes, a.CreatedBy AS RecordedBy,
                    a.GroupFee AS Fee, a.AccountPaid AS Paid, a.PaymentMethod
             FROM Attendance a LEFT JOIN SessionTypes st ON st.SessionTypeId = a.SessionTypeId
             WHERE a.Client = $1 AND a.Type = 'Assessment'
             UNION ALL
             SELECT 'outside', o.OutsideAssessmentId, o.AssessmentType, 'BIP Intake', to_char(o.AssessmentDate, 'YYYY-MM-DD'),
                    o.ProviderName, o.Notes, o.RecordedBy, NULL, NULL, NULL
             FROM OutsideBipAssessments o WHERE o.ClientId = $1
             ORDER BY Date DESC, Id DESC`,
            [id]
        );
        const open = await pool.query(
            `SELECT o.OpenSessionId, st.Name, to_char(o.SessionDate, 'YYYY-MM-DD') AS Date, o.Provider, o.Fee, o.CreatedBy
             FROM OpenIndividualSessions o JOIN SessionTypes st ON st.SessionTypeId = o.SessionTypeId
             WHERE o.ClientId = $1 AND o.Category = 'Assessment' ORDER BY o.SessionDate DESC`,
            [id]
        );
        const s = statusRes.rows[0];
        res.json({ isBip: s.programtype === 'BIP', block: s.block, lastDischarge: s.lastdischarge, completed: done.rows, open: open.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Records a BIP Intake or DV Assessment done at another provider (Business Administrators and Office Admins)
router.post('/api/clients/:id/outside-bip-assessments', async (req, res) => {
    try {
        const { id } = req.params;
        const { assessmentType, assessmentDate, providerName, notes, user } = req.body;
        if (!OPEN_GROUP_ADMIN_ROLES.includes(await activeRoleFor(user))) {
            return res.status(403).json({ error: 'Only Business Administrators and Office Admins can record outside assessments.' });
        }
        if (!['BIP Intake', 'DV Assessment'].includes(assessmentType)) return res.status(400).json({ error: 'Choose BIP Intake or DV Assessment.' });
        if (!YMD.test(String(assessmentDate || ''))) return res.status(400).json({ error: 'Enter the date the assessment was completed.' });
        if (!String(providerName || '').trim()) return res.status(400).json({ error: 'Enter the provider that did the assessment.' });
        const clientRes = await pool.query('SELECT ProgramType FROM Clients WHERE ClientId = $1', [id]);
        if (!clientRes.rows[0]) return res.status(404).json({ error: 'Client not found.' });
        if (clientRes.rows[0].programtype !== 'BIP') return res.status(400).json({ error: 'Outside BIP assessments can only be recorded for BIP clients.' });
        const result = await pool.query(
            `INSERT INTO OutsideBipAssessments (ClientId, AssessmentType, AssessmentDate, ProviderName, Notes, RecordedBy)
             SELECT $1, $2, $3, $4, $5, $6 WHERE $3::date <= CURRENT_DATE RETURNING OutsideAssessmentId`,
            [id, assessmentType, assessmentDate, String(providerName).trim().slice(0, 255), String(notes || '').trim() || null, user]
        );
        if (!result.rows[0]) return res.status(400).json({ error: 'The assessment date cannot be in the future.' });
        const what = `${assessmentType} on ${assessmentDate} at ${String(providerName).trim()}`;
        await logClientChange(pool, { clientId: id, changedBy: user, changeType: 'Outside BIP Assessment', newValue: what, details: String(notes || '').trim() || null });
        await logAction(user, 'Outside BIP Assessment Recorded', `Client ID ${id}: ${what}`);
        res.status(201).json({ success: true, id: result.rows[0].outsideassessmentid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Removes an outside assessment recorded by mistake (Business Administrators only)
router.delete('/api/outside-bip-assessments/:id', async (req, res) => {
    try {
        const { user } = req.body || {};
        if (await activeRoleFor(user) !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can remove outside assessments.' });
        }
        const result = await pool.query(
            `DELETE FROM OutsideBipAssessments WHERE OutsideAssessmentId = $1
             RETURNING ClientId, AssessmentType, to_char(AssessmentDate, 'YYYY-MM-DD') AS AssessmentDate, ProviderName`,
            [req.params.id]
        );
        const row = result.rows[0];
        if (!row) return res.status(404).json({ error: 'Outside assessment not found.' });
        const what = `${row.assessmenttype} on ${row.assessmentdate} at ${row.providername}`;
        await logClientChange(pool, { clientId: row.clientid, changedBy: user, changeType: 'Outside BIP Assessment', oldValue: what, newValue: 'Removed' });
        await logAction(user, 'Outside BIP Assessment Removed', `Client ID ${row.clientid}: ${what}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/clients/:id/bip-intake', async (req, res) => {
    try {
        const date = YMD.test(String(req.query.date || '')) ? req.query.date : new Date().toISOString().slice(0, 10);
        const intake = await lastBipIntake(pool, req.params.id, date);
        // needsOurIntake: no reinstate allowed (discharged after an outside intake); our own intake is needed
        const ourRes = await pool.query(`SELECT ${NEEDS_OUR_INTAKE('$1::int')} AS needs`, [req.params.id]);
        res.json(intake && { ...intake, needsOurIntake: ourRes.rows[0].needs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Business Administrators only. A duplicate name in the same category is refused by the unique key.
router.post('/api/session-types', async (req, res) => {
    try {
        const { category, user } = req.body;
        if (await activeRoleFor(user) !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can change the price list.' });
        }
        const problem = sessionTypeProblem(req.body);
        if (problem) return res.status(400).json({ error: problem });
        const result = await pool.query(
            'INSERT INTO SessionTypes (Category, Name, Fee, Kind, BipOnly, LateFee) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [category, ...sessionTypeValues(req.body)]
        );
        await logAction(user, 'Price List Added', `${category}: ${describeSessionType(result.rows[0])}`);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(err.code === '23505' ? 409 : 500).json({ error: err.code === '23505' ? 'That name is already on the price list.' : err.message });
    }
});

// Entries are deactivated rather than deleted, so closed sessions keep their name
router.put('/api/session-types/:id', async (req, res) => {
    try {
        const { active, user } = req.body;
        if (await activeRoleFor(user) !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can change the price list.' });
        }
        const beforeRes = await pool.query('SELECT * FROM SessionTypes WHERE SessionTypeId = $1', [req.params.id]);
        const before = beforeRes.rows[0];
        if (!before) return res.status(404).json({ error: 'Price list entry not found.' });
        const problem = sessionTypeProblem({ ...req.body, category: before.category });
        if (problem) return res.status(400).json({ error: problem });
        const result = await pool.query(
            'UPDATE SessionTypes SET Name = $1, Fee = $2, Kind = $3, BipOnly = $4, LateFee = $5, Active = $6 WHERE SessionTypeId = $7 RETURNING *',
            [...sessionTypeValues(req.body), active !== false, req.params.id]
        );
        const after = result.rows[0];
        await logAction(user, 'Price List Changed', `${before.category}: ${describeSessionType(before)} to ${describeSessionType(after)}`);
        res.json(after);
    } catch (err) {
        res.status(err.code === '23505' ? 409 : 500).json({ error: err.code === '23505' ? 'That name is already on the price list.' : err.message });
    }
});

// Who may see and change an open session: Business Administrators, Office Admins, the employee who opened it,
// and the counselor/therapist it is with (Provider holds the employee's display name)
const canSeeIndividualSession = (viewer, row) => {
    if (!viewer) return false;
    if (OPEN_GROUP_ADMIN_ROLES.includes(viewer.role)) return true;
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    return same(row.createdby, viewer.employeeemail) || (!!viewer.displayname && same(row.provider, viewer.displayname));
};

const OPEN_INDIVIDUAL_COLUMNS = `o.OpenSessionId, o.ClientId, c.FirstName, c.LastName, c.DOCNumber, c.ProgramType, o.Category, o.SessionTypeId,
    st.Name AS SessionTypeName, to_char(o.SessionDate, 'YYYY-MM-DD') AS SessionDate, o.Fee, o.Payment, o.PaymentMethod,
    o.Provider, o.Comments, o.PaymentComments, o.CreatedBy, o.UpdatedOn`;
const OPEN_INDIVIDUAL_FROM = `OpenIndividualSessions o JOIN Clients c ON c.ClientId = o.ClientId JOIN SessionTypes st ON st.SessionTypeId = o.SessionTypeId`;

router.get('/api/individual-sessions/open', async (req, res) => {
    try {
        const viewer = await openGroupViewer(req.query.user);
        const result = await pool.query(`SELECT ${OPEN_INDIVIDUAL_COLUMNS} FROM ${OPEN_INDIVIDUAL_FROM} ORDER BY o.SessionDate DESC, c.LastName, c.FirstName`);
        res.json(result.rows.filter(row => canSeeIndividualSession(viewer, row)));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Closed sessions, newest first. Business Administrators see all; others see the ones they opened, closed, or provided.
router.get('/api/individual-sessions/closed', async (req, res) => {
    try {
        const viewer = await openGroupViewer(req.query.user);
        if (!viewer) return res.json([]);
        const result = await pool.query(
            `SELECT a.AttendanceId, a.Client AS ClientId, c.FirstName, c.LastName, a.Type AS Category, st.Name AS SessionTypeName,
                    to_char(a.Date, 'YYYY-MM-DD') AS SessionDate, a.GroupFee AS Fee, a.AccountPaid AS Payment, a.PaymentMethod,
                    a.Provider, a.Comments, COALESCE(a.OpenedBy, a.CreatedBy) AS OpenedBy, a.CreatedBy AS ClosedBy, a.CreatedOn AS ClosedOn,
                    -- What was typed as payment comments: the payment's ledger text without its standard opening sentence
                    (SELECT NULLIF(regexp_replace(f.Comments, '^Payment applied during .* session on \\d{4}-\\d{2}-\\d{2}\\.\\s*', ''), '')
                     FROM FinancialTransactions f WHERE f.AttendanceId = a.AttendanceId AND f.Type = 'Payment'
                     ORDER BY f.TransactionId LIMIT 1) AS PaymentComments
             FROM Attendance a
             JOIN Clients c ON c.ClientId = a.Client
             LEFT JOIN SessionTypes st ON st.SessionTypeId = a.SessionTypeId
             WHERE a.Type IN ('Assessment', 'Individual')
               AND ($1::boolean OR LOWER(COALESCE(a.OpenedBy, a.CreatedBy)) = LOWER($2) OR LOWER(a.CreatedBy) = LOWER($2)
                    OR ($3 <> '' AND LOWER(TRIM(a.Provider)) = LOWER(TRIM($3))))
             ORDER BY a.Date DESC, a.CreatedOn DESC NULLS LAST
             LIMIT 100`,
            [viewer.role === 'Business Administrator', viewer.employeeemail, viewer.displayname || '']
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Checks a session from the body against the price list and the client; returns { error } or the cleaned-up session.
// Only a Business Administrator can set a fee other than the price list's.
const checkIndividualSession = async (db, body, viewer) => {
    const { client, category, sessionTypeId, date, fee, payment, paymentMethod, provider } = body;
    if (!INDIVIDUAL_SESSION_TYPES.includes(category)) return { error: 'Choose Assessment or Individual.' };
    if (!YMD.test(String(date || ''))) return { error: 'Enter the session date.' };
    if (!String(provider || '').trim()) return { error: 'Choose the counselor or therapist.' };
    let feeNum = Number(fee);
    const paymentNum = Number(payment || 0);
    if (!Number.isFinite(feeNum) || feeNum < 0) return { error: 'Enter a fee of $0.00 or more.' };
    if (!Number.isFinite(paymentNum) || paymentNum < 0) return { error: 'Enter a payment of $0.00 or more.' };
    if (paymentNum > 0 && !['Cash', 'Credit Card'].includes(paymentMethod)) return { error: 'Choose a payment method: Cash or Credit Card.' };
    // Assessments are paid in cash only
    if (paymentNum > 0 && category === 'Assessment' && paymentMethod !== 'Cash') return { error: 'Assessments can only be paid in cash.' };
    const typeRes = await db.query('SELECT Category, Name, Fee, Kind, BipOnly, LateFee FROM SessionTypes WHERE SessionTypeId = $1', [sessionTypeId]);
    const type = typeRes.rows[0];
    if (!type || type.category !== category) return { error: `Choose ${category === 'Assessment' ? 'an assessment' : 'an individual session'} type from the price list.` };
    const clientRes = await db.query('SELECT ProgramType, FirstName, LastName FROM Clients WHERE ClientId = $1', [client]);
    const c = clientRes.rows[0];
    if (!c) return { error: 'Client not found.' };
    const name = `${c.lastname}, ${c.firstname}`;
    if (category === 'Individual' && c.programtype === 'BIP') return { error: `${name} is a BIP client. BIP clients do not have individual sessions.` };
    if (type.biponly && c.programtype !== 'BIP') return { error: `${type.name} is only for BIP clients, and ${name} is not in BIP.` };
    // A reinstate is priced by the time since the client's last BIP intake, and can't be done a year or more after it
    let listFee = Number(type.fee);
    if (type.kind === 'BIP Reinstate') {
        const ourRes = await db.query(`SELECT ${NEEDS_OUR_INTAKE('$1::int')} AS needs`, [client]);
        if (ourRes.rows[0].needs) {
            return { error: `${name} was discharged after an intake done at another provider, so a ${type.name} can't be done. Complete our BIP Intake or DV Assessment instead.` };
        }
        const intake = await lastBipIntake(db, client, date);
        if (!intake) return { error: `${name} has no BIP Intake or DV Assessment on record, so a ${type.name} can't be done. Do a new BIP Intake or DV Assessment instead.` };
        if (intake.window === 'expired') {
            return { error: `It has been a year or more since ${name}'s last ${intake.intakename} (${intake.intakedate}), so a ${type.name} can't be done. Do a new BIP Intake or DV Assessment instead.` };
        }
        if (intake.window === 'late') listFee = Number(type.latefee ?? type.fee);
    }
    if (viewer?.role !== 'Business Administrator') feeNum = listFee;
    return {
        session: {
            client: Number(client), category, sessionTypeId: Number(sessionTypeId), typeName: type.name, kind: type.kind, date,
            fee: Math.round(feeNum * 100) / 100, payment: Math.round(paymentNum * 100) / 100,
            paymentMethod: paymentNum > 0 ? paymentMethod : null, provider: String(provider).trim().slice(0, 255),
            clientName: `${c.lastname}, ${c.firstname}`,
        },
    };
};

// Saves a session as open (new, or an update of openSessionId). Nothing is charged until it is closed.
router.put('/api/individual-sessions/open', async (req, res) => {
    try {
        const { openSessionId, comments, paymentComments, user } = req.body;
        const viewer = await openGroupViewer(user);
        if (!viewer) return res.status(403).json({ error: 'Only active employees can save sessions.' });
        const checked = await checkIndividualSession(pool, req.body, viewer);
        if (checked.error) return res.status(400).json({ error: checked.error });
        const s = checked.session;
        let id = openSessionId;
        if (id) {
            const existing = await pool.query('SELECT CreatedBy, Provider FROM OpenIndividualSessions WHERE OpenSessionId = $1', [id]);
            if (!existing.rows[0]) return res.status(404).json({ error: 'This open session was already closed or discarded.' });
            if (!canSeeIndividualSession(viewer, existing.rows[0])) return res.status(403).json({ error: 'Only the employee who opened this session, its counselor or therapist, or an administrator can change it.' });
            await pool.query(
                `UPDATE OpenIndividualSessions SET ClientId = $1, Category = $2, SessionTypeId = $3, SessionDate = $4, Fee = $5, Payment = $6,
                     PaymentMethod = $7, Provider = $8, Comments = $9, PaymentComments = $10, UpdatedOn = NOW() WHERE OpenSessionId = $11`,
                [s.client, s.category, s.sessionTypeId, s.date, s.fee, s.payment, s.paymentMethod, s.provider, comments || null, paymentComments || null, id]
            );
        } else {
            const inserted = await pool.query(
                `INSERT INTO OpenIndividualSessions (ClientId, Category, SessionTypeId, SessionDate, Fee, Payment, PaymentMethod, Provider, Comments, PaymentComments, CreatedBy)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING OpenSessionId`,
                [s.client, s.category, s.sessionTypeId, s.date, s.fee, s.payment, s.paymentMethod, s.provider, comments || null, paymentComments || null, viewer.employeeemail]
            );
            id = inserted.rows[0].opensessionid;
        }
        await logAction(user, `${s.category} Saved`, `Saved open ${s.typeName} for ${s.clientName} (Client ID ${s.client}) on ${s.date}`);
        const result = await pool.query(`SELECT ${OPEN_INDIVIDUAL_COLUMNS} FROM ${OPEN_INDIVIDUAL_FROM} WHERE o.OpenSessionId = $1`, [id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/api/individual-sessions/open/:id', async (req, res) => {
    try {
        const { user } = req.body || {};
        const existing = await pool.query('SELECT ClientId, Category, CreatedBy, Provider FROM OpenIndividualSessions WHERE OpenSessionId = $1', [req.params.id]);
        const row = existing.rows[0];
        if (!row) return res.status(404).json({ error: 'This open session was already closed or discarded.' });
        if (!canSeeIndividualSession(await openGroupViewer(user), row)) {
            return res.status(403).json({ error: 'Only the employee who opened this session, its counselor or therapist, or an administrator can discard it.' });
        }
        await pool.query('DELETE FROM OpenIndividualSessions WHERE OpenSessionId = $1', [req.params.id]);
        await logAction(user, `${row.category} Discarded`, `Discarded open ${row.category.toLowerCase()} ID ${req.params.id} for Client ID ${row.clientid}`);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Closes a session: records the attendance, the fee, and any payment in one transaction, and clears the open session
// (openSessionId) it came from. A session can also be closed directly without being saved as open first.
// A BIP intake (BIP Intake, DV Assessment) or BIP reinstate closes only with both boxes checked: paymentConfirmed (the payment
// covers the fee and any past due balance, so the account owes nothing after) and paperworkCompleted (intake paperwork is
// done for an intake; the BIP Reinstatement Contract is signed for a reinstate).
router.post('/api/individual-sessions/close', async (req, res) => {
    const { openSessionId, comments, paymentComments, user, paymentConfirmed, paperworkCompleted } = req.body;
    const db = await pool.connect();
    try {
        const viewer = await openGroupViewer(user);
        if (!viewer) return res.status(403).json({ error: 'Only active employees can close sessions.' });
        await db.query('BEGIN');
        let openedBy = viewer.employeeemail;
        if (openSessionId) {
            const openRes = await db.query('SELECT CreatedBy, Provider FROM OpenIndividualSessions WHERE OpenSessionId = $1 FOR UPDATE', [openSessionId]);
            const open = openRes.rows[0];
            if (!open) {
                await db.query('ROLLBACK');
                return res.status(409).json({ error: 'This open session was already closed or discarded.' });
            }
            if (!canSeeIndividualSession(viewer, open)) {
                await db.query('ROLLBACK');
                return res.status(403).json({ error: 'Only the employee who opened this session, its counselor or therapist, or an administrator can close it.' });
            }
            openedBy = open.createdby || openedBy;
            await db.query('DELETE FROM OpenIndividualSessions WHERE OpenSessionId = $1', [openSessionId]);
        }
        const checked = await checkIndividualSession(db, req.body, viewer);
        if (checked.error) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: checked.error });
        }
        const s = checked.session;
        const needsChecks = s.kind === 'BIP Intake' || s.kind === 'BIP Reinstate';
        const secondCheck = s.kind === 'BIP Reinstate' ? 'BIP Reinstatement Contract signed' : 'intake paperwork completed';
        if (needsChecks) {
            const refuse = async (message) => { await db.query('ROLLBACK'); return res.status(400).json({ error: message }); };
            if (paymentConfirmed !== true) return refuse('Check off the payment for the assessment and any past due balance first.');
            if (paperworkCompleted !== true) return refuse(s.kind === 'BIP Reinstate' ? 'Check off that the BIP Reinstatement Contract is signed.' : 'Check off that the intake paperwork is completed.');
            const balRes = await db.query('SELECT AccountBalance FROM Clients WHERE ClientId = $1 FOR UPDATE', [s.client]);
            // Stored sign: positive = owes. The payment must leave the account owing nothing.
            const amountDue = Math.max(0, Math.round((Number(balRes.rows[0].accountbalance || 0) + s.fee) * 100) / 100);
            if (s.payment + 0.005 < amountDue) {
                return refuse(`${s.clientName} needs to pay $${amountDue.toFixed(2)} (the ${s.typeName} and any past due balance) before the ${s.typeName} can be completed.`);
            }
        }
        const note = String(comments || '').trim();
        const { attendanceId, newBalance } = await recordAttendance(db, {
            client: s.client, group: null, date: s.date, sessionNumber: 1, paid: true, groupFee: s.fee, accountPaid: s.payment,
            paymentMethod: s.paymentMethod, voucherUsed: false, type: s.category, createdBy: viewer.employeeemail, feeType: `${s.category} Fee`,
            paymentComments: String(paymentComments || '').trim(),
            comments: needsChecks ? `${(note || s.typeName).replace(/\.+$/, '')}. Payment received and ${secondCheck}.` : note || s.typeName,
        });
        await db.query('UPDATE Attendance SET SessionTypeId = $1, Provider = $2, OpenedBy = $3 WHERE AttendanceId = $4', [s.sessionTypeId, s.provider, openedBy, attendanceId]);
        await db.query('COMMIT');
        await logAction(user, `${s.category} Closed`, `${s.typeName} for ${s.clientName} (Client ID ${s.client}) on ${s.date} with ${s.provider}: fee $${s.fee.toFixed(2)}, paid $${s.payment.toFixed(2)}${s.paymentMethod ? ` ${s.paymentMethod}` : ''}`);
        res.status(201).json({ success: true, attendanceId, newBalance });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

module.exports = router;
