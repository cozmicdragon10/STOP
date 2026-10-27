const express = require('express');
const { logAction, pool } = require('../db');
const { activeRoleFor, openGroupViewer } = require('../lib/access');
const { groupNameFor } = require('../lib/changeLog');
const { YMD } = require('../lib/sql');
const { withResponsible, OPEN_GROUP_ADMIN_ROLES } = require('../lib/cashResponsibility');

const router = express.Router();

router.get('/api/reports/agent', async (req, res) => {
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

// Every attendance row in the date range (YYYY-MM-DD, inclusive) with its group and client; the page totals them per group
router.get('/api/reports/groups', async (req, res) => {
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

// Deposits for sessions in the date range (YYYY-MM-DD, inclusive)
router.get('/api/reports/group-deposits', async (req, res) => {
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
router.put('/api/reports/group-deposits', async (req, res) => {
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

router.delete('/api/reports/group-deposits', async (req, res) => {
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

// --- GROUP CASH DEPOSIT REPORT ---
// Closed group sessions that took cash (or have a deposit), with whether the cash was dropped off at the bank.
// Business Administrators see every session; everyone else sees the sessions whose cash they are responsible for
// (lib/cashResponsibility.js).
const GROUP_DEPOSIT_COLUMNS = `d.AmountDeposited, to_char(d.DepositDate, 'YYYY-MM-DD') AS DepositDate, d.Notes, d.RecordedBy, d.RecordedOn`;

// One row per closed group session; filtered by the WHERE clause passed in
const closedSessionsSql = (where) => `
    SELECT a."Group" AS GroupId, g.GroupName, g.Counselor, a.Date, a.SessionNumber,
           MIN(COALESCE(a.OpenedBy, a.CreatedBy)) AS OpenedBy, MAX(a.CoveredBy) AS CoveredBy,
           MAX(a.CreatedOn) AS ClosedOn, COUNT(*)::int AS Attendance,
           COALESCE(SUM(a.AccountPaid) FILTER (WHERE a.PaymentMethod = 'Cash'), 0) AS Cash
    FROM Attendance a
    JOIN Groups g ON g.GroupId = a."Group"
    WHERE ${where}
    GROUP BY a."Group", g.GroupName, g.Counselor, a.Date, a.SessionNumber`;

router.get('/api/reports/group-cash-deposits', async (req, res) => {
    try {
        const { from, to, user } = req.query;
        if (!YMD.test(String(from || '')) || !YMD.test(String(to || ''))) {
            return res.status(400).json({ error: 'A start and end date (YYYY-MM-DD) are required.' });
        }
        const viewer = await openGroupViewer(user);
        if (!viewer) return res.json([]);
        const result = await pool.query(
            `SELECT s.GroupId, s.GroupName, s.Counselor, to_char(s.Date, 'YYYY-MM-DD') AS SessionDate, s.SessionNumber,
                    s.OpenedBy, eo.DisplayName AS OpenedByName, s.CoveredBy, s.Responsible, s.ResponsibleName,
                    s.ClosedOn, s.Attendance, s.Cash,
                    ${GROUP_DEPOSIT_COLUMNS}, er.DisplayName AS RecordedByName
             FROM (${withResponsible(closedSessionsSql('a.Date BETWEEN $1 AND $2'), '$5')}) s
             LEFT JOIN GroupDeposits d ON d.GroupId = s.GroupId AND d.SessionDate = s.Date AND d.SessionNumber = s.SessionNumber
             LEFT JOIN EmployeeRoles eo ON LOWER(eo.EmployeeEmail) = LOWER(s.OpenedBy)
             LEFT JOIN EmployeeRoles er ON LOWER(er.EmployeeEmail) = LOWER(d.RecordedBy)
             WHERE (s.Cash > 0 OR d.DepositId IS NOT NULL)
               AND ($3::boolean OR LOWER(s.Responsible) = LOWER($4))
             ORDER BY s.GroupName, s.Date DESC, s.SessionNumber DESC`,
            [from, to, viewer.role === 'Business Administrator', viewer.employeeemail, OPEN_GROUP_ADMIN_ROLES]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Checks a session's cash off as dropped off at the bank (records a deposit for the session's cash), or unchecks it.
// The employee responsible for the session's cash or a Business Administrator can check it off; only a Business
// Administrator or the employee who checked it off can uncheck it.
router.put('/api/reports/group-cash-deposits', async (req, res) => {
    try {
        const { groupId, sessionDate, sessionNumber, droppedOff, depositDate, user } = req.body;
        const viewer = await openGroupViewer(user);
        if (!viewer) return res.status(403).json({ error: 'Only active employees can check off deposits.' });
        if (!groupId || !YMD.test(String(sessionDate || ''))) {
            return res.status(400).json({ error: 'A group session is required.' });
        }
        const isAdmin = viewer.role === 'Business Administrator';
        const session = Number(sessionNumber) || 1;
        const sessionRes = await pool.query(
            withResponsible(closedSessionsSql('a."Group" = $1 AND a.Date = $2 AND a.SessionNumber = $3'), '$4'),
            [groupId, sessionDate, session, OPEN_GROUP_ADMIN_ROLES]
        );
        const info = sessionRes.rows[0];
        if (!info) return res.status(404).json({ error: 'That group session has not been closed.' });
        const responsible = String(info.responsible || '').toLowerCase() === String(viewer.employeeemail).toLowerCase();
        if (!isAdmin && !responsible) {
            return res.status(403).json({ error: 'You can only check off deposits for group sessions you are responsible for.' });
        }
        const groupName = await groupNameFor(groupId);
        const cash = Number(info.cash);

        if (droppedOff) {
            if (!YMD.test(String(depositDate || ''))) {
                return res.status(400).json({ error: 'Enter the date the deposit was dropped off.' });
            }
            // A deposit already recorded for the session (by anyone) is kept as it is
            const inserted = await pool.query(
                `INSERT INTO GroupDeposits (GroupId, SessionDate, SessionNumber, AmountDeposited, DepositDate, RecordedBy)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (GroupId, SessionDate, SessionNumber) DO NOTHING RETURNING DepositId`,
                [groupId, sessionDate, session, cash.toFixed(2), depositDate, viewer.employeeemail]
            );
            if (inserted.rows.length > 0) {
                await logAction(user, 'Group Deposit Dropped Off', `${groupName} session ${sessionDate} #${session}: $${cash.toFixed(2)} cash checked off as dropped off at the bank on ${depositDate}.`, 'Audit');
            }
        } else {
            const existing = await pool.query(
                'SELECT RecordedBy, AmountDeposited FROM GroupDeposits WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3',
                [groupId, sessionDate, session]
            );
            const deposit = existing.rows[0];
            if (deposit) {
                if (!isAdmin && String(deposit.recordedby || '').toLowerCase() !== String(viewer.employeeemail).toLowerCase()) {
                    return res.status(403).json({ error: 'This deposit was checked off by someone else. Ask a Business Administrator to uncheck it.' });
                }
                await pool.query('DELETE FROM GroupDeposits WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3', [groupId, sessionDate, session]);
                await logAction(user, 'Group Deposit Unchecked', `${groupName} session ${sessionDate} #${session}: unchecked the $${Number(deposit.amountdeposited).toFixed(2)} deposit; the cash shows as held again.`, 'Audit');
            }
        }

        const result = await pool.query(
            `SELECT ${GROUP_DEPOSIT_COLUMNS}, er.DisplayName AS RecordedByName
             FROM GroupDeposits d LEFT JOIN EmployeeRoles er ON LOWER(er.EmployeeEmail) = LOWER(d.RecordedBy)
             WHERE d.GroupId = $1 AND d.SessionDate = $2 AND d.SessionNumber = $3`,
            [groupId, sessionDate, session]
        );
        res.json(result.rows[0] || null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/reports/deposit', async (req, res) => {
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

module.exports = router;
