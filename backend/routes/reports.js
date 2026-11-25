const express = require('express');
const { logAction, pool } = require('../db');
const { activeRoleFor, openGroupViewer } = require('../lib/access');
const { requireRole } = require('../lib/auth');
const { groupNameFor } = require('../lib/changeLog');
const { YMD } = require('../lib/sql');
const { withResponsible, closedSessionsSql, OPEN_GROUP_ADMIN_ROLES } = require('../lib/cashResponsibility');
// Money someone holds until it's dropped off at the bank: cash, and checks / money orders / cashier's checks
const { HELD_PAYMENT_SQL } = require('../lib/paymentMethods');
const { lastHandoffJoin, groupKeySql, paymentKeySql } = require('../lib/moneyOnHand');

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
             WHERE "Group" = $1 AND Date = $2 AND SessionNumber = $3 AND ${HELD_PAYMENT_SQL()}`,
            [groupId, sessionDate, session]
        );
        const result = await pool.query(
            `INSERT INTO GroupDeposits (GroupId, SessionDate, SessionNumber, AmountDeposited, DepositDate, Notes, RecordedBy)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (GroupId, SessionDate, SessionNumber) DO UPDATE SET AmountDeposited = EXCLUDED.AmountDeposited,
                 DepositDate = EXCLUDED.DepositDate, Notes = EXCLUDED.Notes, RecordedBy = EXCLUDED.RecordedBy, RecordedOn = CURRENT_TIMESTAMP
                 -- A session on a Money on Hand bank deposit is corrected there (checked against the bank, or voided)
                 WHERE GroupDeposits.BankDepositId IS NULL
             RETURNING GroupId, to_char(SessionDate, 'YYYY-MM-DD') AS SessionDate, SessionNumber, AmountDeposited,
                 to_char(DepositDate, 'YYYY-MM-DD') AS DepositDate, Notes, RecordedBy, RecordedOn`,
            [groupId, sessionDate, session, amount.toFixed(2), depositDate, String(notes || '').trim() || null, user]
        );
        if (result.rows.length === 0) {
            return res.status(409).json({ error: 'This session\'s cash is on a bank deposit made on Money on Hand. Check that deposit against the bank there, or void it.' });
        }
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
            'DELETE FROM GroupDeposits WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3 AND BankDepositId IS NULL RETURNING AmountDeposited',
            [groupId, sessionDate, Number(sessionNumber) || 1]
        );
        if (removed.rows.length === 0) {
            const onBank = await pool.query('SELECT 1 FROM GroupDeposits WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3 AND BankDepositId IS NOT NULL',
                [groupId, sessionDate, Number(sessionNumber) || 1]);
            if (onBank.rows.length) return res.status(409).json({ error: 'This session\'s cash is on a bank deposit made on Money on Hand. Void that deposit there to take it off.' });
            return res.status(404).json({ error: 'No deposit is recorded for that session.' });
        }
        await logAction(user, 'Group Deposit Removed', `${await groupNameFor(groupId)} session ${sessionDate} #${Number(sessionNumber) || 1}: removed the $${Number(removed.rows[0].amountdeposited).toFixed(2)} deposit.`, 'Audit');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- GROUP CASH DEPOSIT REPORT ---
// Closed group sessions that took cash (or have a deposit), with whether the cash was dropped off at the bank, who holds
// it now (Holder: after any hand-offs, lib/moneyOnHand.js) and its bank deposit. Business Administrators see every
// session; everyone else sees the sessions whose cash they were responsible for (lib/cashResponsibility.js) or hold now.
// Drop-offs are made on Money on Hand (routes/moneyOnHand.js).
const GROUP_DEPOSIT_COLUMNS = `d.AmountDeposited, to_char(d.DepositDate, 'YYYY-MM-DD') AS DepositDate, d.Notes, d.RecordedBy, d.RecordedOn`;
// A deposit row's bank deposit (b), if it went through Money on Hand
const BANK_DEPOSIT_COLUMNS = `d.BankDepositId, b.SlipNumber, (b.VerifiedOn IS NOT NULL) AS BankChecked`;

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
                    ${GROUP_DEPOSIT_COLUMNS}, er.DisplayName AS RecordedByName, ${BANK_DEPOSIT_COLUMNS},
                    COALESCE(h.Holder, s.Responsible) AS Holder, COALESCE(eh.DisplayName, h.Holder, s.ResponsibleName, s.Responsible) AS HolderName
             FROM (${withResponsible(closedSessionsSql('a.Date BETWEEN $1 AND $2'), '$5')}) s
             LEFT JOIN GroupDeposits d ON d.GroupId = s.GroupId AND d.SessionDate = s.Date AND d.SessionNumber = s.SessionNumber
             LEFT JOIN BankDeposits b ON b.BankDepositId = d.BankDepositId
             ${lastHandoffJoin(groupKeySql('s.GroupId', 's.Date', 's.SessionNumber'))}
             LEFT JOIN EmployeeRoles eh ON LOWER(eh.EmployeeEmail) = LOWER(h.Holder)
             LEFT JOIN EmployeeRoles eo ON LOWER(eo.EmployeeEmail) = LOWER(s.OpenedBy)
             LEFT JOIN EmployeeRoles er ON LOWER(er.EmployeeEmail) = LOWER(d.RecordedBy)
             WHERE (s.Cash > 0 OR d.DepositId IS NOT NULL)
               AND ($3::boolean OR LOWER(s.Responsible) = LOWER($4) OR LOWER(h.Holder) = LOWER($4))
             ORDER BY s.GroupName, s.Date DESC, s.SessionNumber DESC`,
            [from, to, viewer.role === 'Business Administrator', viewer.employeeemail, OPEN_GROUP_ADMIN_ROLES]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- USER CASH DEPOSIT REPORT ---
// Cash payments taken outside a group session (no check-in, or an assessment or individual session check-in), with
// whether the cash was dropped off at the bank. The employee who entered the payment holds the cash until they hand it
// off (Holder, lib/moneyOnHand.js). Business Administrators see every payment; everyone else sees the ones they entered
// or hold now. Drop-offs are made on Money on Hand (routes/moneyOnHand.js).
const userCashSql = (where) => `
    SELECT f.TransactionId, f.Date AS PaidOn, f.Amount, f.FeeType, f.Comments, f.EnteredBy, ee.DisplayName AS EnteredByName,
           f.PaymentMethod, f.PaymentSubtype, f.PaymentReference,
           c.ClientId, c.FirstName, c.LastName, c.DOCNumber, c.DocType,
           to_char(d.DepositDate, 'YYYY-MM-DD') AS DepositDate, d.RecordedBy, er.DisplayName AS RecordedByName, d.RecordedOn,
           ${BANK_DEPOSIT_COLUMNS}, COALESCE(h.Holder, f.EnteredBy) AS Holder, COALESCE(eh.DisplayName, h.Holder, ee.DisplayName, f.EnteredBy) AS HolderName
    FROM FinancialTransactions f
    LEFT JOIN Attendance a ON a.AttendanceId = f.AttendanceId
    LEFT JOIN Clients c ON c.ClientId = f.Client
    LEFT JOIN CashPaymentDeposits d ON d.TransactionId = f.TransactionId
    LEFT JOIN BankDeposits b ON b.BankDepositId = d.BankDepositId
    ${lastHandoffJoin(paymentKeySql('f.TransactionId'))}
    LEFT JOIN EmployeeRoles eh ON LOWER(eh.EmployeeEmail) = LOWER(h.Holder)
    LEFT JOIN EmployeeRoles ee ON LOWER(ee.EmployeeEmail) = LOWER(f.EnteredBy)
    LEFT JOIN EmployeeRoles er ON LOWER(er.EmployeeEmail) = LOWER(d.RecordedBy)
    WHERE f.Type = 'Payment' AND ${HELD_PAYMENT_SQL('f.')} AND a."Group" IS NULL AND ${where}`;

router.get('/api/reports/user-cash-deposits', async (req, res) => {
    try {
        const { from, to, user } = req.query;
        if (!YMD.test(String(from || '')) || !YMD.test(String(to || ''))) {
            return res.status(400).json({ error: 'A start and end date (YYYY-MM-DD) are required.' });
        }
        const viewer = await openGroupViewer(user);
        if (!viewer) return res.json([]);
        const result = await pool.query(
            `${userCashSql(`f.Date >= $1::date AND f.Date < $2::date + 1 AND ($3::boolean OR LOWER(f.EnteredBy) = LOWER($4) OR LOWER(h.Holder) = LOWER($4))`)}
             ORDER BY f.Date DESC, f.TransactionId DESC`,
            [from, to, viewer.role === 'Business Administrator', viewer.employeeemail]
        );
        res.json(result.rows);
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
                        f.Type AS Detail, f.Amount, f.PaymentMethod, f.FeeType, f.Comments, NULL::varchar AS EditedBy, NULL::timestamp AS EditedOn,
                        f.PaymentSubtype, f.PaymentReference
                 FROM FinancialTransactions f
                 WHERE f.Type IN ('Payment', 'Refund', 'Dispute', 'Dispute Won') AND NOT f.Imported AND f.Date >= $1::date AND f.Date < $2::date + 1
                 UNION ALL
                 SELECT 'Note', n.NoteId, n.Client, n.Date, n."User",
                        n.Category, NULL, NULL, NULL, n.Comments, n.EditedBy, n.EditedOn, NULL, NULL
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
//   ledger      FinancialTransactions by month, type, fee type, method, whether the row belongs to a check-in, and
//               whether it came from the old system (Imported, import/importLedger.js).
//               Charge rows tied to a check-in repeat the check-in's fee, so the page counts fees from attendance instead.
//   attendance  check-in fees (Attendance.GroupFee) by month and type, and assessments a DHS invoice or voucher covers.
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
                        COALESCE(f.PaymentMethod, '') AS PaymentMethod, (f.AttendanceId IS NOT NULL) AS AtCheckIn, f.Imported,
                        COUNT(*)::int AS Count, COALESCE(SUM(f.Amount), 0) AS Amount
                 FROM FinancialTransactions f
                 WHERE f.Date >= $1::date AND f.Date < $2::date + 1
                 GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 1, 2, 3, 4`,
                [from, to]
            ),
            pool.query(
                `SELECT to_char(a.Date, 'YYYY-MM') AS Month, COALESCE(a.Type, 'Group') AS Type, COALESCE(a.FundedBy, '') AS FundedBy,
                        COUNT(*)::int AS Count, COALESCE(SUM(a.GroupFee), 0) AS Fees, COALESCE(SUM(a.FundedPrice), 0) AS FundedPrice
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
                              COALESCE(SUM(a.AccountPaid) FILTER (WHERE ${HELD_PAYMENT_SQL('a.')}), 0) AS Cash
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
                 WHERE f.Type = 'Payment' AND ${HELD_PAYMENT_SQL('f.')} AND a."Group" IS NULL
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
