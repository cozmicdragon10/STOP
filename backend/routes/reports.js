const express = require('express');
const { logAction, pool } = require('../db');
const { activeRoleFor, openGroupViewer } = require('../lib/access');
const { requireRole } = require('../lib/auth');
const { groupNameFor } = require('../lib/changeLog');
const { YMD } = require('../lib/sql');
const { withResponsible, OPEN_GROUP_ADMIN_ROLES } = require('../lib/cashResponsibility');

const router = express.Router();
// The Group Income report is for Business Administrators only
const businessOnly = requireRole('Business Administrator');

// Every attendance row in the date range (YYYY-MM-DD, inclusive) with its group and client; the page totals them per group
router.get('/api/reports/groups', businessOnly, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))) {
            return res.status(400).json({ error: 'A start and end date (YYYY-MM-DD) are required.' });
        }
        const result = await pool.query(
            `SELECT a.AttendanceId, a."Group" AS GroupId, COALESCE(g.GroupName, 'No Group') AS GroupName, g.Counselor,
                    to_char(a.Date, 'YYYY-MM-DD') AS Date, a.SessionNumber, a.Type, a.GroupFee, a.AccountPaid, a.PaymentMethod, a.VoucherUsed,
                    c.ClientId, c.FirstName, c.LastName, c.DOCNumber, c.DocType, c.DocType
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
router.get('/api/reports/group-deposits', businessOnly, async (req, res) => {
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

// --- USER CASH DEPOSIT REPORT ---
// Cash payments taken outside a group session (no check-in, or an assessment or individual session check-in), with
// whether the cash was dropped off at the bank. The employee who entered the payment holds the cash. Business
// Administrators see every payment; everyone else sees the ones they entered.
const userCashSql = (where) => `
    SELECT f.TransactionId, f.Date AS PaidOn, f.Amount, f.FeeType, f.Comments, f.EnteredBy, ee.DisplayName AS EnteredByName,
           c.ClientId, c.FirstName, c.LastName, c.DOCNumber, c.DocType,
           to_char(d.DepositDate, 'YYYY-MM-DD') AS DepositDate, d.RecordedBy, er.DisplayName AS RecordedByName, d.RecordedOn
    FROM FinancialTransactions f
    LEFT JOIN Attendance a ON a.AttendanceId = f.AttendanceId
    LEFT JOIN Clients c ON c.ClientId = f.Client
    LEFT JOIN CashPaymentDeposits d ON d.TransactionId = f.TransactionId
    LEFT JOIN EmployeeRoles ee ON LOWER(ee.EmployeeEmail) = LOWER(f.EnteredBy)
    LEFT JOIN EmployeeRoles er ON LOWER(er.EmployeeEmail) = LOWER(d.RecordedBy)
    WHERE f.Type = 'Payment' AND f.PaymentMethod = 'Cash' AND a."Group" IS NULL AND ${where}`;

router.get('/api/reports/user-cash-deposits', async (req, res) => {
    try {
        const { from, to, user } = req.query;
        if (!YMD.test(String(from || '')) || !YMD.test(String(to || ''))) {
            return res.status(400).json({ error: 'A start and end date (YYYY-MM-DD) are required.' });
        }
        const viewer = await openGroupViewer(user);
        if (!viewer) return res.json([]);
        const result = await pool.query(
            `${userCashSql(`f.Date >= $1::date AND f.Date < $2::date + 1 AND ($3::boolean OR LOWER(f.EnteredBy) = LOWER($4))`)}
             ORDER BY f.Date DESC, f.TransactionId DESC`,
            [from, to, viewer.role === 'Business Administrator', viewer.employeeemail]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Checks a cash payment off as dropped off at the bank, or unchecks it. The employee who entered the payment or a
// Business Administrator can check it off; only a Business Administrator or the employee who checked it off can uncheck it.
router.put('/api/reports/user-cash-deposits', async (req, res) => {
    try {
        const { transactionId, droppedOff, depositDate, user } = req.body;
        const viewer = await openGroupViewer(user);
        if (!viewer) return res.status(403).json({ error: 'Only active employees can check off deposits.' });
        const isAdmin = viewer.role === 'Business Administrator';
        const found = await pool.query(userCashSql('f.TransactionId = $1'), [transactionId]);
        const payment = found.rows[0];
        if (!payment) return res.status(404).json({ error: 'That cash payment was not found.' });
        if (!isAdmin && String(payment.enteredby || '').toLowerCase() !== String(viewer.employeeemail).toLowerCase()) {
            return res.status(403).json({ error: 'You can only check off cash payments you took.' });
        }
        const what = `$${Number(payment.amount).toFixed(2)} cash payment from ${payment.lastname}, ${payment.firstname} (payment ${transactionId})`;

        if (droppedOff) {
            if (!YMD.test(String(depositDate || ''))) {
                return res.status(400).json({ error: 'Enter the date the deposit was dropped off.' });
            }
            const inserted = await pool.query(
                `INSERT INTO CashPaymentDeposits (TransactionId, DepositDate, RecordedBy) VALUES ($1, $2, $3)
                 ON CONFLICT (TransactionId) DO NOTHING RETURNING TransactionId`,
                [transactionId, depositDate, viewer.employeeemail]
            );
            if (inserted.rows.length > 0) {
                await logAction(user, 'Cash Payment Dropped Off', `${what} checked off as dropped off at the bank on ${depositDate}.`, 'Audit');
            }
        } else if (payment.depositdate) {
            if (!isAdmin && String(payment.recordedby || '').toLowerCase() !== String(viewer.employeeemail).toLowerCase()) {
                return res.status(403).json({ error: 'This deposit was checked off by someone else. Ask a Business Administrator to uncheck it.' });
            }
            await pool.query('DELETE FROM CashPaymentDeposits WHERE TransactionId = $1', [transactionId]);
            await logAction(user, 'Cash Payment Deposit Unchecked', `${what}: unchecked; the cash shows as held again.`, 'Audit');
        }

        const result = await pool.query(userCashSql('f.TransactionId = $1'), [transactionId]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- USER ACTIVITY REPORT ---
// Payments (and the refunds and disputes against them) and client notes entered in the date range (YYYY-MM-DD,
// inclusive), newest first, with who entered them. Business Administrators and Office Admins only; the page filters.
router.get('/api/reports/user-activity', async (req, res) => {
    try {
        const { from, to, user } = req.query;
        if (!YMD.test(String(from || '')) || !YMD.test(String(to || ''))) {
            return res.status(400).json({ error: 'A start and end date (YYYY-MM-DD) are required.' });
        }
        if (!OPEN_GROUP_ADMIN_ROLES.includes(await activeRoleFor(user))) {
            return res.status(403).json({ error: 'Only Business Administrators and Office Admins can see the user activity report.' });
        }
        const result = await pool.query(
            `SELECT x.*, c.FirstName, c.LastName, c.DOCNumber, c.DocType, e.DisplayName AS EnteredByName, ed.DisplayName AS EditedByName
             FROM (
                 SELECT 'Payment' AS Kind, f.TransactionId AS Id, f.Client, f.Date AS EnteredOn, f.EnteredBy,
                        f.Type AS Detail, f.Amount, f.PaymentMethod, f.FeeType, f.Comments, NULL::varchar AS EditedBy, NULL::timestamp AS EditedOn
                 FROM FinancialTransactions f
                 WHERE f.Type IN ('Payment', 'Refund', 'Dispute', 'Dispute Won') AND f.Date >= $1::date AND f.Date < $2::date + 1
                 UNION ALL
                 SELECT 'Note', n.NoteId, n.Client, n.Date, n."User",
                        n.Category, NULL, NULL, NULL, n.Comments, n.EditedBy, n.EditedOn
                 FROM Notes n
                 WHERE n.Date >= $1::date AND n.Date < $2::date + 1
             ) x
             LEFT JOIN Clients c ON c.ClientId = x.Client
             LEFT JOIN EmployeeRoles e ON LOWER(e.EmployeeEmail) = LOWER(x.EnteredBy)
             LEFT JOIN EmployeeRoles ed ON LOWER(ed.EmployeeEmail) = LOWER(x.EditedBy)
             ORDER BY x.EnteredOn DESC, x.Id DESC`,
            [from, to]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- FINANCIAL SUMMARY REPORT ---
// Every money total for the company over a date range (YYYY-MM-DD, inclusive), by month, plus what clients owe today.
// Business Administrators only. The page (utils/financialReport.ts) adds the pieces up:
//   ledger      FinancialTransactions by month, type, fee type, method, and whether the row belongs to a check-in.
//               Charge rows tied to a check-in repeat the check-in's fee, so the page counts fees from attendance instead.
//   attendance  check-in fees (Attendance.GroupFee) by month and type, and assessments a DHS invoice or voucher covers.
//               ImportedPaid is what was paid at check-ins imported from the old system (no CreatedBy), which have no
//               ledger rows (import/importAttendance.js), so the page adds it to what was collected.
//   cash        cash taken at group sessions and outside them, and how much of it is checked off as deposited
//   balances    every client's account balance today, by program status (not limited to the range). Poly fees are left
//               out: they are paid ahead toward the next polygraph, not owed.
router.get('/api/reports/financial-summary', businessOnly, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!YMD.test(String(from || '')) || !YMD.test(String(to || '')) || from > to) {
            return res.status(400).json({ error: 'A start and end date (YYYY-MM-DD) are required.' });
        }
        const [ledger, attendance, groupCash, userCash, balances] = await Promise.all([
            pool.query(
                `SELECT to_char(f.Date, 'YYYY-MM') AS Month, f.Type, COALESCE(f.FeeType, '') AS FeeType,
                        COALESCE(f.PaymentMethod, '') AS PaymentMethod, (f.AttendanceId IS NOT NULL) AS AtCheckIn,
                        COUNT(*)::int AS Count, COALESCE(SUM(f.Amount), 0) AS Amount
                 FROM FinancialTransactions f
                 WHERE f.Date >= $1::date AND f.Date < $2::date + 1
                 GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4`,
                [from, to]
            ),
            pool.query(
                `SELECT to_char(a.Date, 'YYYY-MM') AS Month, COALESCE(a.Type, 'Group') AS Type, COALESCE(a.FundedBy, '') AS FundedBy,
                        COUNT(*)::int AS Count, COALESCE(SUM(a.GroupFee), 0) AS Fees, COALESCE(SUM(a.FundedPrice), 0) AS FundedPrice,
                        COALESCE(SUM(a.AccountPaid) FILTER (WHERE a.CreatedBy IS NULL), 0) AS ImportedPaid
                 FROM Attendance a
                 WHERE a.Date BETWEEN $1 AND $2
                 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
                [from, to]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS Sessions, COALESCE(SUM(s.Cash), 0) AS Cash,
                        COALESCE(SUM(d.AmountDeposited), 0) AS Deposited,
                        COALESCE(SUM(s.Cash) FILTER (WHERE d.DepositId IS NULL), 0) AS Held,
                        COUNT(*) FILTER (WHERE d.DepositId IS NULL)::int AS HeldCount
                 FROM (SELECT a."Group" AS GroupId, a.Date, a.SessionNumber,
                              COALESCE(SUM(a.AccountPaid) FILTER (WHERE a.PaymentMethod = 'Cash'), 0) AS Cash
                       FROM Attendance a
                       WHERE a."Group" IS NOT NULL AND a.Date BETWEEN $1 AND $2
                       GROUP BY 1, 2, 3) s
                 LEFT JOIN GroupDeposits d ON d.GroupId = s.GroupId AND d.SessionDate = s.Date AND d.SessionNumber = s.SessionNumber
                 WHERE s.Cash > 0 OR d.DepositId IS NOT NULL`,
                [from, to]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS Payments, COALESCE(SUM(f.Amount), 0) AS Cash,
                        COALESCE(SUM(f.Amount) FILTER (WHERE d.TransactionId IS NOT NULL), 0) AS Deposited,
                        COALESCE(SUM(f.Amount) FILTER (WHERE d.TransactionId IS NULL), 0) AS Held,
                        COUNT(*) FILTER (WHERE d.TransactionId IS NULL)::int AS HeldCount
                 FROM FinancialTransactions f
                 LEFT JOIN Attendance a ON a.AttendanceId = f.AttendanceId
                 LEFT JOIN CashPaymentDeposits d ON d.TransactionId = f.TransactionId
                 WHERE f.Type = 'Payment' AND f.PaymentMethod = 'Cash' AND a."Group" IS NULL
                   AND f.Date >= $1::date AND f.Date < $2::date + 1`,
                [from, to]
            ),
            pool.query(
                `SELECT COALESCE(c.ProgramStatus, 'Unknown') AS ProgramStatus, COUNT(*)::int AS Clients,
                        COUNT(*) FILTER (WHERE c.AccountBalance > 0)::int AS Owing,
                        COALESCE(SUM(c.AccountBalance) FILTER (WHERE c.AccountBalance > 0), 0) AS Owed,
                        COUNT(*) FILTER (WHERE c.AccountBalance < 0)::int AS InCredit,
                        COALESCE(-SUM(c.AccountBalance) FILTER (WHERE c.AccountBalance < 0), 0) AS Credit
                 FROM Clients c
                 GROUP BY 1 ORDER BY 1`
            ),
        ]);
        res.json({
            ledger: ledger.rows,
            attendance: attendance.rows,
            groupCash: groupCash.rows[0],
            userCash: userCash.rows[0],
            balances: balances.rows,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
