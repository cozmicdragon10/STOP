const express = require('express');
const { logAction, pool } = require('../db');
const { activeRoleFor } = require('../lib/access');
const { logClientChange } = require('../lib/changeLog');
const { POLY_VOUCHER_MAX, changePolyFeePaid, countPolyFeeFill, splitPolyPaidChange, voucherChangeText } = require('../lib/poly');

const router = express.Router();

router.post('/api/financials/payment', async (req, res) => {
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
router.post('/api/financials/charge', async (req, res) => {
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
            // Poly fee rows store the account balance, which changes only by what PolyFeePaid can't absorb
            const { poly, newBalance, owedOnAccount } = await applyPolyPaidChange(db, tx.client, delta, (toAccount) => shiftBalanceFrom(db, tx, toAccount, null));
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
                details: `Cash Poly Fee payment from ${paidOn}: ${why}. Poly fee paid now $${poly.polyFeePaid.toFixed(2)}.${voucherChangeText(poly)}${owedOnAccountText(owedOnAccount)}${scheduledPolygraphText(scheduledPolygraph)}`,
            });
            await db.query('COMMIT');
            await logAction(user, 'Payment Adjusted', `Client ID ${tx.client}: cash poly fee payment ${tx.transactionid} from ${paidOn} changed from $${oldAmount.toFixed(2)} to $${newAmount.toFixed(2)}: ${why}.${voucherChangeText(poly)}${owedOnAccountText(owedOnAccount)}${scheduledPolygraphText(scheduledPolygraph)}`);
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
            `UPDATE FinancialTransactions SET Amount = $1, PaymentMethod = 'Cash', OriginalAmount = COALESCE(OriginalAmount, $2), AdjustedBy = $3,
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
            details: `Cash ${tx.feetype || 'payment'} from ${paidOn}: ${why}`,
        });

        await db.query('COMMIT');
        await logAction(user, 'Payment Adjusted', `Client ID ${tx.client}: cash payment ${tx.transactionid} from ${paidOn} changed from $${oldAmount.toFixed(2)} to $${newAmount.toFixed(2)}: ${why}`);
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
