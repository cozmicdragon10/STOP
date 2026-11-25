// Undoing a check-in: deleting one attendance and everything it did to the account (routes/attendance.js DELETE, and
// reopening a closed group in routes/openGroups.js). Runs inside the caller's transaction.
const { chargedWithinMonths, feePeriodMonths, isMonthlyFeeClient } = require('./attendance');
const { countsAsBipWeek, recountBipWeek } = require('./bipWeeks');
const { logClientChange } = require('./changeLog');
const { returnSessionUnits } = require('./federalUnits');
const { paymentMethodText } = require('./paymentMethods');
const { INDIVIDUAL_SESSION_TYPES } = require('./sql');

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

// Check-ins that count for Last Date Attended when it's worked out again after a deletion
const LAST_DATE_ATTENDED_TYPES = ['Group', 'Individual', 'Assessment'];

// Takes an entry's effect on the balance (positive: it raised what the client owes) back off the balance stored on every
// ledger and attendance row recorded after it. at is when the entry was recorded, as full-precision text (TIMESTAMP_TEXT):
// a JavaScript Date keeps only milliseconds, so rows recorded in the same instant would count as later. afterAttendanceId
// orders check-ins saved before Attendance.CreatedOn existed, and is only given when the entry itself is one of those.
const takeBackFromLaterRows = async (db, clientId, effect, at, afterAttendanceId = null) => {
    if (!effect) return;
    await db.query(
        'UPDATE FinancialTransactions SET FinalBalance = FinalBalance - $1 WHERE Client = $2 AND FinalBalance IS NOT NULL AND Date > $3::timestamp',
        [effect, clientId, at]
    );
    await db.query(
        `UPDATE Attendance SET AccountTotal = AccountTotal - $1
         WHERE Client = $2 AND (CreatedOn > $3::timestamp OR (CreatedOn IS NULL AND $4::int IS NOT NULL AND AttendanceId > $4))`,
        [effect, clientId, at, afterAttendanceId]
    );
};
// A timestamp column as text with its microseconds, for takeBackFromLaterRows
const TIMESTAMP_TEXT = (column) => `to_char(${column}, 'YYYY-MM-DD HH24:MI:SS.US')`;

// Deletes a check-in and undoes what it did: its charge and payment come off the ledger (with any refund or dispute on
// that payment, and the payment's cash drop-off check-off), the client's balance and the balance on every later ledger and
// attendance row move back, Last Date Attended falls back to the latest Group, Individual, or Assessment check-in left, a
// BIP client's week count goes down by one (when the check-in counted toward it: lib/bipWeeks.js), Federal SO units come
// back, a monthly or period treatment fee it carried moves to the check-in that is now the period's first, and a poly fee
// voucher the check-in earned is taken back. Closed groups and the Group Income Report are built from attendance, so
// they follow on their own. reason ends the change log entry.
// Returns null when the attendance doesn't exist, otherwise { att (the deleted row), client (balance, phase, vouchers and
// last dates after), voucher ('removed' | 'kept' | 'used' | null), feeMoved, ledgerIds, details (the change log text) }.
const undoAttendance = async (db, { attendanceId, user, reason }) => {
    const attRes = await db.query(
        `SELECT a.*, a."Group" AS GroupId, to_char(a.Date, 'YYYY-MM-DD') AS Day, ${TIMESTAMP_TEXT('a.CreatedOn')} AS CreatedAt,
                g.GroupName, st.Name AS SessionTypeName, st.Kind AS SessionKind
         FROM Attendance a LEFT JOIN Groups g ON g.GroupId = a."Group" LEFT JOIN SessionTypes st ON st.SessionTypeId = a.SessionTypeId
         WHERE a.AttendanceId = $1 FOR UPDATE OF a`,
        [attendanceId]
    );
    const att = attRes.rows[0];
    if (!att) return null;
    const clientRes = await db.query('SELECT AccountBalance, ProgramType, Phase FROM Clients WHERE ClientId = $1 FOR UPDATE', [att.client]);
    const client = clientRes.rows[0];

    // The check-in's ledger rows, and refunds and disputes on its payment
    const ledger = (await db.query(
        `SELECT *, ${TIMESTAMP_TEXT('Date')} AS At FROM FinancialTransactions
         WHERE AttendanceId = $1 OR RelatedTransactionId IN (SELECT TransactionId FROM FinancialTransactions WHERE AttendanceId = $1)
         ORDER BY Date, TransactionId`,
        [att.attendanceid]
    )).rows;
    // Check-ins saved before ledger rows were linked to them: the one payment or charge whose comment matches
    const legacy = async (type, comments) => {
        const r = await db.query(
            `SELECT *, ${TIMESTAMP_TEXT('Date')} AS At FROM FinancialTransactions WHERE Client = $1 AND Type = $2 AND Comments = $3 AND AttendanceId IS NULL`,
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
        at: f.at,
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
    // Federal SO units the session used go back to the client
    const unitsText = await returnSessionUnits(db, { att, changedBy: user });

    // When the check-in was recorded: its CreatedOn, else its ledger row, else the end of the session day
    const checkInAt = att.createdat || checkInRow?.at || `${att.day} 23:59:59`;
    await takeBackFromLaterRows(db, att.client, checkInEffect, checkInAt, att.createdon ? null : att.attendanceid);
    for (const r of reversals) await takeBackFromLaterRows(db, att.client, r.effect, r.at);

    const what = att.groupid ? att.groupname || `Group ${att.groupid}` : `${att.type}${att.sessiontypename ? ` - ${att.sessiontypename}` : ''}`;

    // The treatment fee for the period moves when the deleted check-in was the one charged it, to the check-in that is
    // now the period's first: for a monthly-fee client, the earliest group check-in left that month (when none of them
    // is charged); for Phase 3 and 4, the earliest uncharged group check-in from the deleted one's date to the end of
    // its period that has no other charged check-in in the period before it. That check-in is charged the same fee as
    // of when it was recorded, so its balance and every later one go up by it (its payment row's balance too, or a
    // Charge row is added when it has none).
    let feeMoved = null;
    const deletedFee = money(att.groupfee);
    const periodMonths = feePeriodMonths(client);
    let next = null;
    if (att.groupid && !INDIVIDUAL_SESSION_TYPES.includes(att.type) && deletedFee > 0 && (isMonthlyFeeClient(client) || periodMonths)) {
        const inPeriod = periodMonths
            ? 'a.Date >= $2::date AND a.Date < $2::date + make_interval(months => $4) AND a.GroupFee = 0'
            : `date_trunc('month', a.Date) = date_trunc('month', $2::date)`;
        const rows = (await db.query(
            `SELECT a.*, a."Group" AS GroupId, to_char(a.Date, 'YYYY-MM-DD') AS Day, ${TIMESTAMP_TEXT('a.CreatedOn')} AS CreatedAt, g.GroupName
             FROM Attendance a LEFT JOIN Groups g ON g.GroupId = a."Group"
             WHERE a.Client = $1 AND a.Type <> ALL($3::text[]) AND ${inPeriod}
             ORDER BY a.Date, a.CreatedOn NULLS FIRST, a.AttendanceId`,
            [att.client, att.day, INDIVIDUAL_SESSION_TYPES, ...(periodMonths ? [periodMonths] : [])]
        )).rows;
        if (periodMonths) {
            for (const r of rows) {
                if (!(await chargedWithinMonths(db, att.client, r.day, periodMonths))) {
                    next = r;
                    break;
                }
            }
        } else if (rows.length > 0 && !rows.some(r => money(r.groupfee) > 0)) {
            next = rows[0];
        }
        if (next) {
            const nextWhat = next.groupid ? next.groupname || `Group ${next.groupid}` : next.type;
            const updatedNext = await db.query(
                'UPDATE Attendance SET GroupFee = $1, AccountTotal = AccountTotal + $1 WHERE AttendanceId = $2 RETURNING AccountTotal',
                [deletedFee, next.attendanceid]
            );
            const nextPayment = await db.query(
                `UPDATE FinancialTransactions SET FinalBalance = FinalBalance + $1
                 WHERE AttendanceId = $2 AND Type = 'Payment' AND RelatedTransactionId IS NULL RETURNING ${TIMESTAMP_TEXT('Date')} AS At`,
                [deletedFee, next.attendanceid]
            );
            const nextAt = next.createdat || nextPayment.rows[0]?.at || `${next.day} 23:59:59`;
            if (nextPayment.rows.length === 0) {
                await db.query(
                    `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, AttendanceId, EnteredBy)
                     VALUES ($1, $2::timestamp, 'Charge', $3, 'Group Fee', $4, $5, $6, $7)`,
                    [att.client, nextAt, deletedFee, updatedNext.rows[0].accounttotal,
                        `${next.type} fee assessed on ${next.day}. Moved from the deleted ${what} check-in on ${att.day}.`, next.attendanceid, user]
                );
            }
            await takeBackFromLaterRows(db, att.client, -deletedFee, nextAt, next.createdon ? null : next.attendanceid);
            feeMoved = { amount: deletedFee, to: `${nextWhat} on ${next.day}` };
        }
    }
    // What the client's balance goes down by: the deleted check-in's effect, less a fee moved to another check-in
    const balanceTakenBack = money(totalEffect - (feeMoved?.amount ?? 0));

    // BIP clients count one week per group attendance since their last intake (lib/bipWeeks.js): deleting one takes a
    // week off, but one from before the last intake never added a week, so it leaves the week alone. Deleting a
    // completed BIP intake counts the week again from the intake before it. Last Date Attended becomes the most
    // recent Group, Individual, or Assessment check-in left on the account (none: cleared).
    const isBip = client.programtype === 'BIP';
    const isBipWeek = isBip && !INDIVIDUAL_SESSION_TYPES.includes(att.type) && await countsAsBipWeek(db, att.client, att.day);
    if (isBip && att.sessionkind === 'BIP Intake' && att.assessmentstatus !== 'In Progress') {
        await recountBipWeek(db, { clientId: att.client, changedBy: user, why: `the intake on ${att.day} was deleted.` });
    }
    const updated = await db.query(
        `UPDATE Clients SET AccountBalance = AccountBalance - $1,
             Phase = CASE WHEN $3::boolean AND TRIM(Phase) ~ '^\\d+$' THEN GREATEST(TRIM(Phase)::int - 1, 0)::text ELSE Phase END,
             LastDateAttended = (SELECT MAX(Date) FROM Attendance WHERE Client = $2 AND Type = ANY($4::text[]))
         WHERE ClientId = $2
         RETURNING AccountBalance, Phase, PolyFeeVoucher, LastDateAttended,
             (SELECT MAX(Date) FROM Attendance WHERE Client = $2) AS LastAttended`,
        [balanceTakenBack, att.client, Boolean(isBipWeek), LAST_DATE_ATTENDED_TYPES]
    );

    const session = att.sessionnumber > 1 ? ` (session ${att.sessionnumber})` : '';
    const paid = money(att.accountpaid) > 0 ? `paid $${money(att.accountpaid).toFixed(2)}${att.paymentmethod ? ` ${paymentMethodText(att.paymentmethod, att.paymentsubtype, att.paymentreference)}` : ''}` : 'no payment';
    const voucherText = {
        removed: ' The poly fee voucher it earned was removed.',
        kept: ' The poly fee voucher it earned was kept (attended again later that month).',
        used: ' The poly fee voucher it earned was already used, so none was removed.',
    }[voucher] ?? '';
    const feeMovedText = feeMoved ? ` The $${feeMoved.amount.toFixed(2)} treatment fee moved to ${feeMoved.to}.` : '';
    const details = `${what} on ${att.day}${session}: fee $${money(att.groupfee).toFixed(2)}, ${paid}.${feeMovedText}${voucherText}${unitsText} ${reason}`;
    await logClientChange(db, { clientId: att.client, changedBy: user, changeType: 'Attendance Deleted', oldValue: `${what} ${att.day}`, details });
    return { att, client: updated.rows[0], voucher, feeMoved, ledgerIds, details };
};

module.exports = { undoAttendance, takeBackFromLaterRows, TIMESTAMP_TEXT };
