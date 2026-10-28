const express = require('express');
const { logAction, pool } = require('../db');
const { recordAttendance } = require('../lib/attendance');
const { requireRole } = require('../lib/auth');
const { coveringCounselorFor } = require('../lib/cashResponsibility');
const { logClientChange } = require('../lib/changeLog');
const { INDIVIDUAL_SESSION_TYPES } = require('../lib/sql');

const router = express.Router();

// SO group program types, as stored on Groups
const SO_GROUP_TYPES = ['SO', 'FED SO'];

router.post('/api/attendance', async (req, res) => {
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
    const { group, date, sessionNumber, type, createdBy, coveredBy, entries } = req.body;
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
        const groupRes = await clientDb.query('SELECT ProgramType FROM Groups WHERE GroupId = $1', [group]);
        const isSoGroup = SO_GROUP_TYPES.includes(String(groupRes.rows[0]?.programtype || '').trim().toUpperCase());
        const results = [];
        for (const entry of entries) {
            const { attendanceId, newBalance, polyVoucherAwarded, feeCharged, feeReason } = await recordAttendance(clientDb, {
                ...entry, group, date, sessionNumber: sessionNum, type: type || 'Group', createdBy, paid: true, awardNdiVoucher: isSoGroup
            });
            // The fee is worked out from the account when saving; a sheet shown with a different fee is reported back
            const feeSent = Math.round(Number(entry.groupFee || 0) * 100) / 100;
            const feeChange = feeCharged !== feeSent ? { feeSent, feeCharged, feeReason } : null;
            results.push({ client: entry.client, attendanceId, newBalance, polyVoucherAwarded, feeChange });
        }
        // Closing the group clears its saved open sheet for this session. Who opened it is kept on the attendance rows
        // so the closed group stays visible to them; a group closed without being opened first was opened by the closer.
        // The covering counselor (lib/cashResponsibility.js) is kept too: the closer's pick if they are an
        // administrator, otherwise whatever was saved with the open sheet.
        const openedRes = await clientDb.query(
            'DELETE FROM OpenGroupSessions WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3 RETURNING CreatedBy, CoveredBy',
            [group, date, sessionNum]
        );
        const openedBy = openedRes.rows[0]?.createdby || createdBy;
        const covering = await coveringCounselorFor(createdBy, coveredBy, openedRes.rows[0]?.coveredby ?? null);
        await clientDb.query(
            'UPDATE Attendance SET OpenedBy = $1, CoveredBy = $2 WHERE AttendanceId = ANY($3::int[])',
            [openedBy, covering, results.map(r => r.attendanceId)]
        );
        const names = await clientDb.query('SELECT ClientId, LastName || \', \' || FirstName AS Name FROM Clients WHERE ClientId = ANY($1::int[])', [clientIds]);
        const nameOf = Object.fromEntries(names.rows.map(r => [r.clientid, r.name]));
        const feeChanges = results.filter(r => r.feeChange).map(r => ({ client: r.client, name: nameOf[Number(r.client)], ...r.feeChange }));
        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, count: results.length, results, polyVouchersAwarded: results.filter(r => r.polyVoucherAwarded).length, feeChanges });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(error.status || 500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

// Check-ins that count for Last Date Attended when it's worked out again after a deletion
const LAST_DATE_ATTENDED_TYPES = ['Group', 'Individual', 'Assessment'];

// Takes an entry's effect on the balance (positive: it raised what the client owes) back off the balance stored on every
// ledger and attendance row recorded after it. at is when the entry was recorded; afterAttendanceId orders check-ins
// saved before Attendance.CreatedOn existed, and is only given when the entry itself is one of those.
const takeBackFromLaterRows = async (db, clientId, effect, at, afterAttendanceId = null) => {
    if (!effect) return;
    await db.query(
        'UPDATE FinancialTransactions SET FinalBalance = FinalBalance - $1 WHERE Client = $2 AND FinalBalance IS NOT NULL AND Date > $3',
        [effect, clientId, at]
    );
    await db.query(
        `UPDATE Attendance SET AccountTotal = AccountTotal - $1
         WHERE Client = $2 AND (CreatedOn > $3 OR (CreatedOn IS NULL AND $4::int IS NOT NULL AND AttendanceId > $4))`,
        [effect, clientId, at, afterAttendanceId]
    );
};

// Deletes a check-in (Business Administrators only) and undoes what it did: its charge and payment come off the ledger
// (with any refund or dispute on that payment, and the payment's cash drop-off check-off), the client's balance and the
// balance on every later ledger and attendance row move back, Last Date Attended falls back to the latest Group,
// Individual, or Assessment check-in left, a BIP client's week count goes down by one, and a poly fee voucher the
// check-in earned is taken back. Closed groups and the Group Income Report are built from
// attendance, so they follow on their own.
router.delete('/api/attendance/:id', requireRole('Business Administrator'), async (req, res) => {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
        return res.status(400).json({ error: 'A reason is required to delete attendance.' });
    }
    const user = req.user.employeeemail;
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const attRes = await db.query(
            `SELECT a.*, a."Group" AS GroupId, to_char(a.Date, 'YYYY-MM-DD') AS Day, g.GroupName, st.Name AS SessionTypeName
             FROM Attendance a LEFT JOIN Groups g ON g.GroupId = a."Group" LEFT JOIN SessionTypes st ON st.SessionTypeId = a.SessionTypeId
             WHERE a.AttendanceId = $1 FOR UPDATE OF a`,
            [req.params.id]
        );
        const att = attRes.rows[0];
        if (!att) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'That attendance no longer exists.' });
        }
        const clientRes = await db.query('SELECT AccountBalance, ProgramType, Phase FROM Clients WHERE ClientId = $1 FOR UPDATE', [att.client]);
        const client = clientRes.rows[0];

        // The check-in's ledger rows, and refunds and disputes on its payment
        const ledger = (await db.query(
            `SELECT * FROM FinancialTransactions
             WHERE AttendanceId = $1 OR RelatedTransactionId IN (SELECT TransactionId FROM FinancialTransactions WHERE AttendanceId = $1)
             ORDER BY Date, TransactionId`,
            [att.attendanceid]
        )).rows;
        // Check-ins saved before ledger rows were linked to them: the one payment or charge whose comment matches
        const legacy = async (type, comments) => {
            const r = await db.query(
                'SELECT * FROM FinancialTransactions WHERE Client = $1 AND Type = $2 AND Comments = $3 AND AttendanceId IS NULL',
                [att.client, type, comments]
            );
            return r.rows.length === 1 ? r.rows[0] : null;
        };
        if (money(att.accountpaid) > 0 && !ledger.some(f => f.type === 'Payment')) {
            const row = await legacy('Payment', `Payment applied during ${att.type} session on ${att.day}.`);
            if (row) ledger.push(row);
        } else if (money(att.groupfee) > 0 && !ledger.some(f => f.type === 'Charge')) {
            const row = await legacy('Charge', `${att.type} fee assessed on ${att.day}.`);
            if (row) ledger.push(row);
        }
        const payment = ledger.find(f => f.type === 'Payment' && !f.relatedtransactionid);
        const checkInRow = payment || ledger.find(f => f.type === 'Charge');

        // Effects on the balance (positive: owes more): the check-in itself, then each refund or dispute step after it
        const checkInEffect = money(money(att.groupfee) - (payment ? money(payment.amount) : money(att.accountpaid)));
        const reversals = ledger.filter(f => f.relatedtransactionid).map(f => ({
            at: f.date,
            effect: f.type === 'Dispute Won' ? -money(f.amount) : ['Refund', 'Dispute'].includes(f.type) ? money(f.amount) : 0,
        }));
        const totalEffect = money(checkInEffect + reversals.reduce((t, r) => t + r.effect, 0));

        // A poly fee voucher the check-in earned comes back off, unless the client has other attendance later that month
        // (a later day, or later the same day). One already used for a polygraph can't be taken back.
        let voucher = null;
        if (att.polyvoucherawarded) {
            const laterRes = await db.query(
                `SELECT 1 FROM Attendance
                 WHERE Client = $1 AND AttendanceId <> $2 AND date_trunc('month', Date) = date_trunc('month', $3::date)
                   AND (Date > $3::date OR (Date = $3::date AND COALESCE(CreatedOn > $4, AttendanceId > $2)))
                 LIMIT 1`,
                [att.client, att.attendanceid, att.day, att.createdon]
            );
            if (laterRes.rows.length > 0) {
                voucher = 'kept';
            } else {
                const voucherRes = await db.query(
                    'UPDATE Clients SET PolyFeeVoucher = PolyFeeVoucher - 1 WHERE ClientId = $1 AND PolyFeeVoucher > 0 RETURNING PolyFeeVoucher',
                    [att.client]
                );
                voucher = voucherRes.rows.length > 0 ? 'removed' : 'used';
            }
        }

        const ledgerIds = ledger.map(f => f.transactionid);
        await db.query('DELETE FROM CashPaymentDeposits WHERE TransactionId = ANY($1::int[])', [ledgerIds]);
        await db.query('DELETE FROM FinancialTransactions WHERE TransactionId = ANY($1::int[])', [ledgerIds]);
        await db.query('DELETE FROM Attendance WHERE AttendanceId = $1', [att.attendanceid]);

        // When the check-in was recorded: its CreatedOn, else its ledger row, else the end of the session day
        const checkInAt = att.createdon || checkInRow?.date || `${att.day} 23:59:59`;
        await takeBackFromLaterRows(db, att.client, checkInEffect, checkInAt, att.createdon ? null : att.attendanceid);
        for (const r of reversals) await takeBackFromLaterRows(db, att.client, r.effect, r.at);

        // BIP clients count one week per group attendance. Last Date Attended becomes the most recent Group, Individual,
        // or Assessment check-in left on the account (none: cleared).
        const isBipWeek = client.programtype === 'BIP' && att.groupid && !INDIVIDUAL_SESSION_TYPES.includes(att.type);
        const updated = await db.query(
            `UPDATE Clients SET AccountBalance = AccountBalance - $1,
                 Phase = CASE WHEN $3::boolean AND TRIM(Phase) ~ '^\\d+$' THEN GREATEST(TRIM(Phase)::int - 1, 0)::text ELSE Phase END,
                 LastDateAttended = (SELECT MAX(Date) FROM Attendance WHERE Client = $2 AND Type = ANY($4::text[]))
             WHERE ClientId = $2
             RETURNING AccountBalance, Phase, PolyFeeVoucher, LastDateAttended,
                 (SELECT MAX(Date) FROM Attendance WHERE Client = $2) AS LastAttended`,
            [totalEffect, att.client, Boolean(isBipWeek), LAST_DATE_ATTENDED_TYPES]
        );

        const what = att.groupid ? att.groupname || `Group ${att.groupid}` :`${att.type}${att.sessiontypename ? ` - ${att.sessiontypename}` : ''}`;
        const session = att.sessionnumber > 1 ? ` (session ${att.sessionnumber})` : '';
        const paid = money(att.accountpaid) > 0 ? `paid $${money(att.accountpaid).toFixed(2)}${att.paymentmethod ? ` ${att.paymentmethod}` : ''}` : 'no payment';
        const voucherText = {
            removed: ' The poly fee voucher it earned was removed.',
            kept: ' The poly fee voucher it earned was kept (attended again later that month).',
            used: ' The poly fee voucher it earned was already used, so none was removed.',
        }[voucher] ?? '';
        const details = `${what} on ${att.day}${session}: fee $${money(att.groupfee).toFixed(2)}, ${paid}.${voucherText} ${reason}`;
        await logClientChange(db, { clientId: att.client, changedBy: user, changeType: 'Attendance Deleted', oldValue: `${what} ${att.day}`, details });
        await db.query('COMMIT');
        await logAction(user, 'Attendance Deleted', `Client ID ${att.client}, attendance ${att.attendanceid}: ${details}`);

        const row = updated.rows[0];
        res.json({
            success: true,
            newBalance: Number(row.accountbalance),
            phase: row.phase,
            polyFeeVoucher: row.polyfeevoucher,
            voucher,
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
