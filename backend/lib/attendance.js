const { LAST_POLY_RESULT_SQL, POLY_VOUCHER_EARNING_RESULTS, polyVoucherMax } = require('./poly');
const {
    BIP_CHECKIN_BLOCK, FEE_ONCE_PER_PERIOD_PROGRAMS, FEE_PERIOD_MONTHS, GROUP_ATTENDANCE, INDIVIDUAL_SESSION_TYPES, MONTHLY_FEE_PHASES,
    bipCheckInBlockMessage,
} = require('./sql');

// Writes one attendance row, its ledger entry, and the client's balance.
// Takes the caller's transaction client so batch check-ins stay all-or-nothing.
// State SO and Voluntary SO Phase 1 (weekly) and Phase 2 (monthly) clients are charged the treatment fee once per calendar month,
// on their first attendance. Mirrors isMonthlyFeeClient in frontend/src/utils/soPhases.ts.
const isMonthlyFeeClient = (row) => FEE_ONCE_PER_PERIOD_PROGRAMS.includes(row.programtype) && MONTHLY_FEE_PHASES.includes(row.phase);
// State SO and Voluntary SO Phase 3 (quarterly) and Phase 4 (semi-annual) clients are charged once per this many months,
// rolling from their last charged group attendance; null for everyone else. Mirrors feePeriodMonths in frontend/src/utils/soPhases.ts.
const feePeriodMonths = (row) => (FEE_ONCE_PER_PERIOD_PROGRAMS.includes(row.programtype) && FEE_PERIOD_MONTHS[row.phase]) || null;
// The client's most recent charged group attendance in the given months up to and including date (YYYY-MM-DD), or null
const chargedWithinMonths = async (db, client, date, months) => {
    const r = await db.query(
        `SELECT to_char(Date, 'MM/DD/YYYY') AS Day FROM Attendance
         WHERE Client = $1 AND ${GROUP_ATTENDANCE} AND GroupFee > 0 AND Date <= $2::date AND Date > $2::date - make_interval(months => $3)
         ORDER BY Date DESC LIMIT 1`,
        [client, date, months]
    );
    return r.rows[0]?.day ?? null;
};

// A client's first group check-in of a calendar month needs a balance of -$180.00 or better, i.e. owing at most this much
// (stored sign: positive = owes) after any payment taken at check-in. BIP clients are exempt. Mirrors FIRST_CHECKIN_MAX_OWED in frontend/src/utils/balance.ts.
const FIRST_CHECKIN_MAX_OWED = 180;

// awardNdiVoucher: when set (closing an SO group), a client charged the group fee whose most recent
// polygraph earns vouchers (POLY_VOUCHER_EARNING_RESULTS, or kept in the incentive by override) earns one poly fee voucher, up to their full set (polyVoucherMax).
// sessionNumber: which session of the group that day (1 for the first); a group can meet again after its earlier session was closed
// An Assessment or Individual type is charged its full fee and leaves the monthly fee rules and BIP weeks alone.
// paymentComments: added after the standard text on the payment's ledger row
const recordAttendance = async (db, { client, group, date, sessionNumber, paid, groupFee, accountPaid, paymentMethod, voucherUsed, type, comments, createdBy, awardNdiVoucher, feeType = 'Group Fee', paymentComments = '' }) => {
    const isIndividualSession = INDIVIDUAL_SESSION_TYPES.includes(type);
    const clientRes = await db.query('SELECT AccountBalance, ProgramType, Phase, FirstName, LastName, TreatmentFee FROM Clients WHERE ClientId = $1 FOR UPDATE', [client]);
    if (clientRes.rows.length === 0) {
        throw new Error(`Client ${client} not found.`);
    }

    const sessionDate = date || new Date().toISOString().split('T')[0];
    const sessionNum = Number(sessionNumber) > 0 ? Math.floor(Number(sessionNumber)) : 1;

    // A BIP client needs a completed BIP intake (and a BIP reinstate after any discharge) before group check-in
    if (group && !isIndividualSession && clientRes.rows[0].programtype === 'BIP') {
        const blockRes = await db.query(`SELECT ${BIP_CHECKIN_BLOCK} AS block FROM Clients c WHERE c.ClientId = $1`, [client]);
        const block = blockRes.rows[0]?.block;
        if (block) throw new Error(bipCheckInBlockMessage(block, `${clientRes.rows[0].lastname}, ${clientRes.rows[0].firstname}`));
    }

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

    // Whether the client already attended a group in the session's month (assessments and individual sessions don't count)
    const attendedThatMonth = group && !isIndividualSession
        ? (await db.query(
            `SELECT 1 FROM Attendance WHERE Client = $1 AND ${GROUP_ATTENDANCE} AND date_trunc('month', Date) = date_trunc('month', $2::date) LIMIT 1`,
            [client, sessionDate]
        )).rows.length > 0
        : false;

    // First group check-in of the calendar month: after any payment taken now, the client may owe at most FIRST_CHECKIN_MAX_OWED.
    // BIP clients are exempt.
    if (group && !isIndividualSession && clientRes.rows[0].programtype !== 'BIP') {
        const owedAfterPayment = oldBalance - Number(accountPaid || 0);
        if (!attendedThatMonth && owedAfterPayment > FIRST_CHECKIN_MAX_OWED) {
            const { lastname, firstname } = clientRes.rows[0];
            throw new Error(`${lastname}, ${firstname} must pay their existing balance before their first group check-in of the month: `
                + `the balance must be -$${FIRST_CHECKIN_MAX_OWED.toFixed(2)} or better (pay at least $${(owedAfterPayment - FIRST_CHECKIN_MAX_OWED).toFixed(2)} more).`);
        }
    }

    // A group check-in's fee is worked out here from the account, by the same rules as the check-in screen (clientFee in
    // frontend/src/hooks/useGroupCheckIn.ts), so a screen that's out of date or a session on an earlier date can't charge
    // the wrong fee: a monthly-fee client who already attended a group in the session's month, or a Phase 3 or 4 client
    // charged in the period before the session date, pays nothing; otherwise a fee override covering the session date,
    // or the treatment fee. Assessments and individual sessions keep the fee they were priced at.
    let feeNum = Number(groupFee || 0);
    let feeReason = null;
    if (group && !isIndividualSession) {
        const monthName = new Date(`${sessionDate}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const monthly = isMonthlyFeeClient(clientRes.rows[0]);
        const periodMonths = feePeriodMonths(clientRes.rows[0]);
        const chargedOn = periodMonths ? await chargedWithinMonths(db, client, sessionDate, periodMonths) : null;
        if (monthly && attendedThatMonth) {
            feeNum = 0;
            feeReason = `already charged for ${monthName}`;
        } else if (chargedOn) {
            feeNum = 0;
            feeReason = `already charged on ${chargedOn}; charged once every ${periodMonths} months`;
        } else {
            const overrideRes = await db.query(
                `SELECT ReducedFee FROM TemporaryFeeOverrides
                 WHERE ClientId = $1 AND CreatedOn::date <= $2::date AND ExpirationDate >= $2::date
                 ORDER BY CreatedOn DESC LIMIT 1`,
                [client, sessionDate]
            );
            if (overrideRes.rows.length > 0) {
                feeNum = Number(overrideRes.rows[0].reducedfee) || 0;
                feeReason = 'the fee override for that date';
            } else {
                feeNum = Number(clientRes.rows[0].treatmentfee) || 0;
                feeReason = monthly ? `first group attendance of ${monthName}`
                    : periodMonths ? `no group fee charged in the ${periodMonths} months before`
                        : 'the treatment fee on the account';
            }
        }
        feeNum = Math.round(feeNum * 100) / 100;
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
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod, AttendanceId, EnteredBy)
             VALUES ($1, NOW(), 'Payment', $2, $7, $3, $4, $5, $6, $8)`,
            [client, paidNum, newBalance, `Payment applied during ${type} session on ${sessionDate}.${paymentComments ? ` ${paymentComments}` : ''}`, paymentMethod, attendanceId, feeType, createdBy || null]
        );
    } else if (feeNum > 0) {
        await db.query(
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, AttendanceId, EnteredBy)
             VALUES ($1, NOW(), 'Charge', $2, $6, $3, $4, $5, $7)`,
            [client, feeNum, newBalance, `${type} fee assessed on ${sessionDate}.`, attendanceId, feeType, createdBy || null]
        );
    }

    // BIP clients count weeks attended: every attendance adds one to the week number stored in Phase.
    // A non-numeric value (left over from before BIP used week numbers) counts as week 0.
    const { programtype, phase } = clientRes.rows[0];
    const newPhase = programtype === 'BIP' && !isIndividualSession
        ? String((/^\d+$/.test(String(phase ?? '').trim()) ? Number(phase) : 0) + 1)
        : null;

    // Last Date Attended only moves forward: a missed check-in added for an earlier session leaves a later one in place
    await db.query(
        'UPDATE Clients SET AccountBalance = $1, LastDateAttended = GREATEST(LastDateAttended, $2::date), Phase = COALESCE($3, Phase) WHERE ClientId = $4',
        [newBalance, sessionDate, newPhase, client]
    );

    let polyVoucherAwarded = false;
    if (awardNdiVoucher && feeNum > 0) {
        const polyRes = await db.query(LAST_POLY_RESULT_SQL('$1'), [client]);
        const lastPoly = polyRes.rows[0];
        if (lastPoly && (POLY_VOUCHER_EARNING_RESULTS.includes(lastPoly.results) || lastPoly.incentivecontinued)) {
            const voucherRes = await db.query(
                'UPDATE Clients SET PolyFeeVoucher = PolyFeeVoucher + 1 WHERE ClientId = $1 AND PolyFeeVoucher < $2 RETURNING PolyFeeVoucher',
                [client, polyVoucherMax(phase)]
            );
            polyVoucherAwarded = voucherRes.rows.length > 0;
            // Deleting this attendance takes the voucher back (routes/attendance.js)
            if (polyVoucherAwarded) await db.query('UPDATE Attendance SET PolyVoucherAwarded = TRUE WHERE AttendanceId = $1', [attendanceId]);
        }
    }

    // feeCharged and feeReason: what the account was charged and why, for telling the user when it differs from what was sent
    return { attendanceId, newBalance, polyVoucherAwarded, feeCharged: feeNum, feeReason };
};

module.exports = { isMonthlyFeeClient, feePeriodMonths, chargedWithinMonths, FIRST_CHECKIN_MAX_OWED, recordAttendance };
