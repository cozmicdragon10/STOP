const express = require('express');
const { effectiveRole } = require('../lib/roles');
const { logAction, pool } = require('../db');
const { activeRoleFor, OPEN_GROUP_ADMIN_ROLES } = require('../lib/access');
const { assertCardAllowed } = require('../lib/cardBlock');
const { cardMoveProblem } = require('../lib/cardMove');
const { requireRole } = require('../lib/auth');
const { FORGIVEN_FEE_TYPE, forgivenessEditProblem, forgivenessProblem } = require('../lib/debtForgiveness');
const { dollars, logClientChange } = require('../lib/changeLog');
const { moneyText } = require('../lib/moneyFields');
const { polyVoucherMax, changePolyFeePaid, countPolyFeeFill, splitPolyPaidChange, voucherChangeText } = require('../lib/poly');
const { paymentDetails, paymentMethodProblem, paymentMethodText } = require('../lib/paymentMethods');

const router = express.Router();

router.post('/api/financials/payment', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        await clientDb.query('BEGIN');
        const { client, amount, comments, createdBy, paymentMethod, paymentSubtype, paymentReference, applyToPolyFee } = req.body;
        // Cash, Credit Card, or Other with its kind; Direct Deposit, Tribal and DHS are for Business Administrators only
        const methodProblem = paymentMethodProblem({ method: paymentMethod, subtype: paymentSubtype, role: req.user?.role });
        if (methodProblem) {
            await clientDb.query('ROLLBACK');
            return res.status(methodProblem.startsWith('Only') ? 403 : 400).json({ error: methodProblem });
        }
        const { subtype, reference } = paymentDetails({ method: paymentMethod, subtype: paymentSubtype, reference: paymentReference });
        const methodText = paymentMethodText(paymentMethod, subtype, reference);
        if (!(Number(amount) > 0)) {
            await clientDb.query('ROLLBACK');
            return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
        }

        const clientRes = await clientDb.query('SELECT AccountBalance, PolyFeePaid, PolyFee, PolyFeeVoucher, Phase FROM Clients WHERE ClientId = $1 FOR UPDATE', [client]);
        // Read after the row lock, so a block set a moment ago is seen
        if (paymentMethod === 'Credit Card') await assertCardAllowed(clientDb, client);
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
        const newPolyVoucher = polyAmount > 0 && polyAmount >= polyOwed ? polyVoucherMax(clientRes.rows[0].phase) : Number(clientRes.rows[0].polyfeevoucher || 0);

        // The ledger row(s) this payment saved, printed on its receipt (one, or two when it is split with the poly fee)
        const transactionIds = [];
        if (polyAmount > 0) {
            // The poly fee is tracked separately, so the account balance is unchanged by this row
            const saved = await clientDb.query(
                `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod, EnteredBy, PaymentSubtype, PaymentReference)
                 VALUES ($1, NOW(), 'Payment', $2, 'Poly Fee', $3, $4, $5, $6, $7, $8) RETURNING TransactionId`,
                [client, polyAmount, oldBalance, comment, paymentMethod, createdBy || null, subtype, reference]
            );
            transactionIds.push(saved.rows[0].transactionid);
        }
        if (accountAmount > 0) {
            const saved = await clientDb.query(
                `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod, EnteredBy, PaymentSubtype, PaymentReference)
                 VALUES ($1, NOW(), 'Payment', $2, 'Account Payment', $3, $4, $5, $6, $7, $8) RETURNING TransactionId`,
                [client, accountAmount, newBalance, comment, paymentMethod, createdBy || null, subtype, reference]
            );
            transactionIds.push(saved.rows[0].transactionid);
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

        const split = polyAmount > 0
            ? ` ${dollars(polyAmount)} to the poly fee (paid ${dollars(oldPolyPaid)} → ${dollars(newPolyPaid)})${accountAmount > 0 ? `, ${dollars(accountAmount)} to the account` : ''}.`
            : '';
        const filled = fillsVouchers ? ` Poly fee paid in full: vouchers filled to ${newPolyVoucher}.` : '';
        await logClientChange(clientDb, {
            clientId: client, changedBy: createdBy, changeType: 'Payment',
            oldValue: moneyText('accountbalance', oldBalance), newValue: moneyText('accountbalance', newBalance),
            details: `${dollars(payAmount)} ${methodText} payment (receipt ${transactionIds.join(', ')}).${split}${filled} ${comment}`.trim(),
        });

        await clientDb.query('COMMIT');
        res.status(201).json({ success: true, newBalance, polyFeePaid: newPolyPaid, polyFeeVoucher: newPolyVoucher, polyApplied: polyAmount, accountApplied: accountAmount, transactionIds });
    } catch (error) {
        await clientDb.query('ROLLBACK');
        res.status(error.status || 500).json({ error: error.message });
    } finally {
        clientDb.release();
    }
});

// Custom fee charged to a client's account (Business Administrators only)
// Admin > Transaction Lookup: one ledger row by the ID printed on its receipt, with its client, the check-in it was
// taken at, and any rows tied to it (refunds, disputes). Office Admins and Business Administrators only.
const LOOKUP_COLUMNS = `f.TransactionId, f.Client, f.Date, f.Type, f.Amount, f.FeeType, f.FinalBalance, f.Comments, f.PaymentMethod,
    f.AttendanceId, f.OriginalAmount, f.AdjustedBy, f.AdjustedOn, f.AdjustmentReason, f.RelatedTransactionId, f.DisputeStatus, f.EnteredBy,
    f.PaymentSubtype, f.PaymentReference`;
router.get('/api/transactions/:id', async (req, res) => {
    try {
        if (!OPEN_GROUP_ADMIN_ROLES.includes(req.user?.role)) {
            return res.status(403).json({ error: 'Only Office Admins and Business Administrators can look up transactions.' });
        }
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0 || id > 2147483647) return res.status(400).json({ error: 'Enter the transaction ID number from the receipt.' });
        const found = await pool.query(
            `SELECT ${LOOKUP_COLUMNS}, c.FirstName, c.LastName, c.DocNumber, c.DocType, c.ProgramType,
                    a.Date AS AttendanceDate, a.Type AS AttendanceType, g.GroupName
             FROM FinancialTransactions f
             LEFT JOIN Clients c ON c.ClientId = f.Client
             LEFT JOIN Attendance a ON a.AttendanceId = f.AttendanceId
             LEFT JOIN Groups g ON g.GroupId = a."Group"
             WHERE f.TransactionId = $1`, [id]);
        if (!found.rows[0]) return res.status(404).json({ error: `No transaction has the ID ${id}.` });
        const tx = found.rows[0];
        const related = await pool.query(
            `SELECT ${LOOKUP_COLUMNS} FROM FinancialTransactions f
             WHERE f.TransactionId <> $1 AND (f.RelatedTransactionId = $1 OR f.TransactionId = $2
                OR (f.AttendanceId IS NOT NULL AND f.AttendanceId = $3))
             ORDER BY f.Date, f.TransactionId`, [id, tx.relatedtransactionid, tx.attendanceid]);
        res.json({ ...tx, related: related.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/financials/charge', async (req, res) => {
    const clientDb = await pool.connect();
    try {
        const { client, amount, comments, createdBy } = req.body;
        const roleRes = await clientDb.query(
            'SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE',
            [createdBy]
        );
        if (effectiveRole(roleRes.rows[0]?.role) !== 'Business Administrator') {
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
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, EnteredBy)
             VALUES ($1, NOW(), 'Charge', $2, 'Custom Fee', $3, $4, $5)`,
            [client, chargeAmount, newBalance, comments.trim(), createdBy]
        );

        await clientDb.query('UPDATE Clients SET AccountBalance = $1 WHERE ClientId = $2', [newBalance, client]);
        await logClientChange(clientDb, {
            clientId: client, changedBy: createdBy, changeType: 'Custom Fee',
            oldValue: moneyText('accountbalance', oldBalance), newValue: moneyText('accountbalance', newBalance),
            details: `${dollars(chargeAmount)} custom fee charged: ${comments.trim()}`,
        });

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

// Forgives some or all of what a client owes (Business Administrators, and DEV who signs in as one). Saved as an
// Adjustment row, so it lowers the balance without counting as money received (lib/debtForgiveness.js).
router.post('/api/clients/:id/forgive-debt', requireRole('Business Administrator'), async (req, res) => {
    const clientId = Number(req.params.id);
    if (!Number.isInteger(clientId) || clientId <= 0) return res.status(400).json({ error: 'Unknown client.' });
    const { amount, reason, expectedOwed } = req.body || {};
    const user = req.user.employeeemail;
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const found = await db.query('SELECT AccountBalance FROM Clients WHERE ClientId = $1 FOR UPDATE', [clientId]);
        if (!found.rows[0]) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Client not found.' });
        }
        const before = Number(found.rows[0].accountbalance || 0);
        const problem = forgivenessProblem({ amount, reason, owed: before, expectedOwed });
        if (problem) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: problem, owed: Math.max(0, before) });
        }
        const forgiven = Math.round(Number(amount) * 100) / 100;
        const why = String(reason).trim();
        const after = Math.round((before - forgiven) * 100) / 100;

        await db.query('UPDATE Clients SET AccountBalance = $1 WHERE ClientId = $2', [after, clientId]);
        const saved = await db.query(
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, EnteredBy)
             VALUES ($1, NOW(), 'Adjustment', $2, $3, $4, $5, $6) RETURNING TransactionId`,
            [clientId, forgiven, FORGIVEN_FEE_TYPE, after, why, user]
        );
        await logClientChange(db, {
            clientId, changedBy: user, changeType: FORGIVEN_FEE_TYPE,
            oldValue: moneyText('accountbalance', before), newValue: moneyText('accountbalance', after),
            details: `${dollars(forgiven)} of debt forgiven: ${why}`,
        });
        await db.query('COMMIT');
        await logAction(user, 'Debt Forgiven', `Client ID ${clientId}: forgave $${forgiven.toFixed(2)} (owed $${before.toFixed(2)}, now $${after.toFixed(2)}): ${why}`);
        res.status(201).json({ success: true, newBalance: after, forgiven, transactionId: saved.rows[0].transactionid });
    } catch (error) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        db.release();
    }
});

// Changes the amount of a forgiveness, or undoes it (amount 0: the client owes it again, e.g. it was put on the wrong
// client). Business Administrators and DEV. Like a cash payment adjustment, the row keeps its first amount and who
// corrected it and why, and the difference moves the client's balance and the balance stored on this and every later
// ledger and attendance row.
router.put('/api/financials/:id/forgiveness', requireRole('Business Administrator'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) return res.status(400).json({ error: 'Unknown ledger entry.' });
    const { amount, reason, expectedAmount } = req.body || {};
    const user = req.user.employeeemail;
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const found = await db.query('SELECT Client FROM FinancialTransactions WHERE TransactionId = $1', [id]);
        if (!found.rows[0]) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'That ledger entry no longer exists.' });
        }
        // The client row first, as every money change does, then the entry itself
        const clientRes = await db.query('SELECT AccountBalance FROM Clients WHERE ClientId = $1 FOR UPDATE', [found.rows[0].client]);
        const tx = (await db.query('SELECT * FROM FinancialTransactions WHERE TransactionId = $1 FOR UPDATE', [id])).rows[0];
        if (tx.type !== 'Adjustment' || tx.feetype !== FORGIVEN_FEE_TYPE) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: 'Only a debt forgiveness can be changed or undone here.' });
        }
        const before = Number(clientRes.rows[0].accountbalance || 0);
        const oldAmount = Number(tx.amount);
        const problem = forgivenessEditProblem({ oldAmount, newAmount: amount, expectedAmount, owed: before, reason });
        if (problem) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: problem, amount: oldAmount });
        }
        const newAmount = Math.round(Number(amount) * 100) / 100;
        const why = String(reason).trim();
        // Forgiving more lowers what the client owes (stored sign: positive = owes)
        const delta = Math.round((newAmount - oldAmount) * 100) / 100;
        const after = await shiftBalanceFrom(db, tx, delta, null);
        await db.query(
            `UPDATE FinancialTransactions SET Amount = $1, OriginalAmount = COALESCE(OriginalAmount, $2), AdjustedBy = $3,
                 AdjustedOn = NOW(), AdjustmentReason = $4
             WHERE TransactionId = $5`,
            [newAmount, oldAmount, user, why, id]
        );
        const forgivenOn = new Date(tx.date).toLocaleDateString('en-US');
        const what = newAmount === 0
            ? `Debt forgiveness of ${dollars(oldAmount)} from ${forgivenOn} undone: the client owes it again`
            : `Debt forgiveness from ${forgivenOn} changed from ${dollars(oldAmount)} to ${dollars(newAmount)}`;
        await logClientChange(db, {
            clientId: tx.client, changedBy: user, changeType: newAmount === 0 ? 'Debt Forgiveness Undone' : 'Debt Forgiveness Changed',
            oldValue: moneyText('accountbalance', before), newValue: moneyText('accountbalance', after),
            details: `${what}. ${why}`,
        });
        await db.query('COMMIT');
        await logAction(user, newAmount === 0 ? 'Debt Forgiveness Undone' : 'Debt Forgiveness Changed',
            `Client ID ${tx.client}, entry ${id}: ${what} (owed $${before.toFixed(2)}, now $${after.toFixed(2)}): ${why}`);
        res.json({ success: true, newBalance: after, amount: newAmount, undone: newAmount === 0 });
    } catch (error) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally {
        db.release();
    }
});

// Ledger row types that take money back off a payment (the client owes it again), and the one that puts it back
const PAYMENT_REVERSAL_TYPES = ['Refund', 'Dispute'];

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

// Moves the client's balance by a change to what was paid on payment tx (positive: paid more, so owes less), along with
// the balance stored on tx and every later ledger and attendance row. attendanceId is the check-in tx was taken at, if any.
// Returns the new account balance.
const shiftBalanceFrom = async (db, tx, paidChange, attendanceId) => {
    // Compared in SQL so the stored timestamp keeps its full precision
    await db.query(
        `UPDATE FinancialTransactions SET FinalBalance = FinalBalance - $1
         WHERE Client = $2 AND FinalBalance IS NOT NULL
           AND (TransactionId = $3 OR (Date, TransactionId) > (SELECT Date, TransactionId FROM FinancialTransactions WHERE TransactionId = $3))`,
        [paidChange, tx.client, tx.transactionid]
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
        [paidChange, tx.client, attendanceId || null, tx.transactionid]
    );
    const balRes = await db.query(
        'UPDATE Clients SET AccountBalance = AccountBalance - $1 WHERE ClientId = $2 RETURNING AccountBalance',
        [paidChange, tx.client]
    );
    return Number(balRes.rows[0].accountbalance);
};

// A change to a poly fee payment: PolyFeePaid moves (never below $0), and any part it can't absorb is owed on the account
// (splitPolyPaidChange). moveBalance applies that part to the account and returns the new balance.
const applyPolyPaidChange = async (db, clientId, paidChange, moveBalance) => {
    const paidRes = await db.query('SELECT PolyFeePaid FROM Clients WHERE ClientId = $1', [clientId]);
    const { polyDelta, toAccount } = splitPolyPaidChange(Number(paidRes.rows[0]?.polyfeepaid || 0), paidChange);
    const poly = await changePolyFeePaid(db, clientId, polyDelta);
    const newBalance = toAccount !== 0 ? await moveBalance(toAccount) : null;
    // Positive: how much more the client now owes on the account
    const owedOnAccount = Math.round(-toAccount * 100) / 100;
    return { poly, newBalance, owedOnAccount };
};

const owedOnAccountText = (owed) => (owed > 0 ? ` $${owed.toFixed(2)} more than was paid on the poly fee is owed on the account balance.` : '');

// Corrects the amount of a cash payment (Business Administrators only). For an account payment the difference moves the
// client's balance and the balance stored on this and every later ledger and attendance row, and a payment taken at
// check-in also updates that attendance row's AccountPaid, which the group income report and its cash deposits use.
// For a poly fee payment the difference moves PolyFeePaid instead, and the vouchers follow (see changePolyFeePaid); a
// decrease PolyFeePaid can't absorb (it never goes below $0) moves the balance like an account payment would.
router.put('/api/financials/:id/adjust', async (req, res) => {
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
        // Cash and Other payments (check, money order, ...) are adjusted here and keep their method. Payments saved before the
        // method was recorded were all cash; adjusting one records it as Cash. Credit card payments are corrected with a
        // refund or dispute instead.
        if (tx.type !== 'Payment' || (tx.paymentmethod && !['Cash', 'Other'].includes(tx.paymentmethod))) {
            await db.query('ROLLBACK');
            return res.status(400).json({ error: 'Only cash and other (check, money order, ...) payments can be adjusted.' });
        }
        const methodLabel = paymentMethodText(tx.paymentmethod || 'Cash', tx.paymentsubtype, tx.paymentreference);
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
            // Poly fee rows store the account balance, which changes only by what PolyFeePaid can't absorb
            const { poly, newBalance, owedOnAccount } = await applyPolyPaidChange(db, tx.client, delta, (toAccount) => shiftBalanceFrom(db, tx, toAccount, null));
            const scheduledPolygraph = await scheduledPolygraphFor(db, tx.client);
            await db.query(
                `UPDATE FinancialTransactions SET Amount = $1, PaymentMethod = COALESCE(PaymentMethod, 'Cash'), OriginalAmount = COALESCE(OriginalAmount, $2), AdjustedBy = $3,
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
                details: `${methodLabel} Poly Fee payment from ${paidOn}: ${why}. Poly fee paid now $${poly.polyFeePaid.toFixed(2)}.${voucherChangeText(poly)}${owedOnAccountText(owedOnAccount)}${scheduledPolygraphText(scheduledPolygraph)}`,
            });
            await db.query('COMMIT');
            await logAction(user, 'Payment Adjusted', `Client ID ${tx.client}: ${methodLabel} poly fee payment ${tx.transactionid} from ${paidOn} changed from $${oldAmount.toFixed(2)} to $${newAmount.toFixed(2)}: ${why}.${voucherChangeText(poly)}${owedOnAccountText(owedOnAccount)}${scheduledPolygraphText(scheduledPolygraph)}`);
            return res.json({
                success: true, newBalance: newBalance ?? Number(clientRes.rows[0].accountbalance), attendanceUpdated: false,
                ...poly, owedOnAccount, scheduledPolygraph,
            });
        }

        const attendanceId = await checkInFor(db, tx);
        const newBalance = await shiftBalanceFrom(db, tx, delta, attendanceId);
        if (attendanceId) {
            await db.query(
                `UPDATE Attendance SET AccountPaid = $1, PaymentMethod = COALESCE(PaymentMethod, 'Cash') WHERE AttendanceId = $2`,
                [newAmount, attendanceId]
            );
        }
        await db.query(
            `UPDATE FinancialTransactions SET Amount = $1, PaymentMethod = COALESCE(PaymentMethod, 'Cash'), OriginalAmount = COALESCE(OriginalAmount, $2), AdjustedBy = $3,
                 AdjustedOn = NOW(), AdjustmentReason = $4, AttendanceId = COALESCE(AttendanceId, $5)
             WHERE TransactionId = $6`,
            [newAmount, oldAmount, user, why, attendanceId || null, tx.transactionid]
        );
        await logClientChange(db, {
            clientId: tx.client,
            changedBy: user,
            changeType: 'Payment Adjusted',
            oldValue: `$${oldAmount.toFixed(2)}`,
            newValue: `$${newAmount.toFixed(2)}`,
            details: `${methodLabel} ${tx.feetype || 'payment'} from ${paidOn}: ${why}`,
        });

        await db.query('COMMIT');
        await logAction(user, 'Payment Adjusted', `Client ID ${tx.client}: ${methodLabel} payment ${tx.transactionid} from ${paidOn} changed from $${oldAmount.toFixed(2)} to $${newAmount.toFixed(2)}: ${why}`);
        res.json({ success: true, newBalance, attendanceUpdated: Boolean(attendanceId) });
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
// On a poly fee payment, what PolyFeePaid can't absorb (it never goes below $0) is owed on the account instead.
const CARD_ACTIONS = ['refund', 'dispute', 'dispute-won', 'dispute-lost'];
// Moves a credit card payment to another client's account (lib/cardMove.js has who and which payments). Used when the
// wrong client was checked in and charged: the ledger row moves to the client who paid, with both balances updated, so
// there is still one card charge. Both client rows are locked, lowest id first.
router.post('/api/financials/:id/move-to-client', async (req, res) => {
    const { fromClient, toClient, reason } = req.body || {};
    const user = req.user;
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const tx = (await db.query('SELECT * FROM FinancialTransactions WHERE TransactionId = $1 FOR UPDATE', [req.params.id])).rows[0];
        const relatedCount = tx
            ? Number((await db.query('SELECT COUNT(*) AS n FROM FinancialTransactions WHERE RelatedTransactionId = $1', [tx.transactionid])).rows[0].n)
            : 0;
        const problem = cardMoveProblem({ tx, relatedCount, fromClient, toClient, user });
        if (problem) {
            await db.query('ROLLBACK');
            return res.status(problem.startsWith('Only the person') ? 403 : 400).json({ error: problem });
        }
        const locked = await db.query(
            'SELECT ClientId, FirstName, LastName, AccountBalance FROM Clients WHERE ClientId = ANY($1::int[]) ORDER BY ClientId FOR UPDATE',
            [[Number(tx.client), Number(toClient)]]
        );
        const from = locked.rows.find(r => Number(r.clientid) === Number(tx.client));
        const to = locked.rows.find(r => Number(r.clientid) === Number(toClient));
        if (!from || !to) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'That client no longer exists.' });
        }
        await assertCardAllowed(db, to.clientid);

        const amount = Number(tx.amount);
        const cents = (n) => Math.round(n * 100) / 100;
        // Stored sign: positive = owes. The first client owes the payment again; the second has it.
        const fromOld = Number(from.accountbalance || 0);
        const toOld = Number(to.accountbalance || 0);
        const fromNew = cents(fromOld + amount);
        const toNew = cents(toOld - amount);
        const fromName = `${from.lastname}, ${from.firstname}`;
        const toName = `${to.lastname}, ${to.firstname}`;
        const why = String(reason || '').trim() || 'Wrong client checked in';
        const paidOn = new Date(tx.date).toLocaleDateString('en-US');

        await db.query('UPDATE Clients SET AccountBalance = $1 WHERE ClientId = $2', [fromNew, from.clientid]);
        await db.query('UPDATE Clients SET AccountBalance = $1 WHERE ClientId = $2', [toNew, to.clientid]);
        await db.query(
            `UPDATE FinancialTransactions SET Client = $1, FinalBalance = $2,
                 Comments = TRIM(COALESCE(Comments, '') || ' ' || $3)
             WHERE TransactionId = $4`,
            [to.clientid, toNew, `Moved from ${fromName} by ${user.employeeemail}: ${why}.`, tx.transactionid]
        );
        await logClientChange(db, {
            clientId: from.clientid, changedBy: user.employeeemail, changeType: 'Payment Moved',
            oldValue: moneyText('accountbalance', fromOld), newValue: moneyText('accountbalance', fromNew),
            details: `${dollars(amount)} Credit Card payment from ${paidOn} (receipt ${tx.transactionid}) moved to ${toName}: ${why}.`,
        });
        await logClientChange(db, {
            clientId: to.clientid, changedBy: user.employeeemail, changeType: 'Payment Moved',
            oldValue: moneyText('accountbalance', toOld), newValue: moneyText('accountbalance', toNew),
            details: `${dollars(amount)} Credit Card payment from ${paidOn} (receipt ${tx.transactionid}) moved here from ${fromName}: ${why}.`,
        });
        await db.query('COMMIT');
        await logAction(user.employeeemail, 'Payment Moved', `Card payment ${tx.transactionid} (${dollars(amount)}) moved from client ID ${from.clientid} to client ID ${to.clientid}: ${why}`);
        res.json({ success: true, fromBalance: fromNew, toBalance: toNew });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(err.status || 500).json({ error: err.message });
    } finally {
        db.release();
    }
});

router.post('/api/financials/:id/card-action', async (req, res) => {
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
        let owedOnAccount = 0;
        const attendanceId = isPoly ? null : await checkInFor(db, tx);
        if (rowType) {
            if (isPoly) {
                // The refund or dispute row records today's balance, so earlier rows aren't rewritten
                const change = await applyPolyPaidChange(db, tx.client, paidChange, async (toAccount) => {
                    const balRes = await db.query(
                        'UPDATE Clients SET AccountBalance = AccountBalance - $1 WHERE ClientId = $2 RETURNING AccountBalance',
                        [toAccount, tx.client]
                    );
                    return Number(balRes.rows[0].accountbalance);
                });
                poly = change.poly;
                owedOnAccount = change.owedOnAccount;
                if (change.newBalance !== null) newBalance = change.newBalance;
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
                `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod, AttendanceId, RelatedTransactionId, EnteredBy)
                 VALUES ($1, NOW(), $2, $3, $4, $5, $6, 'Credit Card', $7, $8, $9)`,
                [tx.client, rowType, rowAmount, tx.feetype, newBalance,
                    `${label} on the $${Number(tx.amount).toFixed(2)} credit card payment from ${paidOn}: ${why} (${user})`,
                    attendanceId, tx.transactionid, user || null]
            );
        }
        const status = { dispute: 'Open', 'dispute-won': 'Won', 'dispute-lost': 'Lost' }[action] ?? tx.disputestatus ?? null;
        await db.query(
            'UPDATE FinancialTransactions SET DisputeStatus = $1, AttendanceId = COALESCE(AttendanceId, $2) WHERE TransactionId = $3',
            [status, attendanceId, tx.transactionid]
        );

        const scheduledPolygraph = isPoly && rowType ? await scheduledPolygraphFor(db, tx.client) : null;
        const details = `${label}${rowType ? ` of $${rowAmount.toFixed(2)}` : ''} on the $${Number(tx.amount).toFixed(2)} credit card ${tx.feetype || 'payment'} from ${paidOn}: ${why}.`
            + (poly ? ` Poly fee paid now $${poly.polyFeePaid.toFixed(2)}.${voucherChangeText(poly)}${owedOnAccountText(owedOnAccount)}` : '')
            + scheduledPolygraphText(scheduledPolygraph);
        await logClientChange(db, {
            clientId: tx.client,
            changedBy: user,
            changeType: action === 'refund' ? 'Payment Refunded' : 'Payment Disputed',
            details,
        });

        await db.query('COMMIT');
        await logAction(user, action === 'refund' ? 'Payment Refunded' : 'Payment Disputed', `Client ID ${tx.client}, payment ${tx.transactionid}: ${details}`);
        res.json({ success: true, newBalance, attendanceUpdated: Boolean(attendanceId && rowType), ...(poly || {}), owedOnAccount, scheduledPolygraph });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

module.exports = router;
