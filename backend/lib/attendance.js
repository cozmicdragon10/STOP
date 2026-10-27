const { LAST_POLY_RESULT_SQL, POLY_VOUCHER_EARNING_RESULTS, POLY_VOUCHER_MAX } = require('./poly');
const { BIP_CHECKIN_BLOCK, GROUP_ATTENDANCE, INDIVIDUAL_SESSION_TYPES, bipCheckInBlockMessage } = require('./sql');

// Writes one attendance row, its ledger entry, and the client's balance.
// Takes the caller's transaction client so batch check-ins stay all-or-nothing.
// State SO and Voluntary SO Phase 1 (weekly) and Phase 2 (monthly) clients are charged the treatment fee once per calendar month,
// on their first attendance. Mirrors isMonthlyFeeClient in frontend/src/utils/soPhases.ts.
const isMonthlyFeeClient = (row) => (row.programtype === 'State SO' || row.programtype === 'Voluntary SO')
    && (row.phase === 'Phase 1 - Weekly' || row.phase === 'Phase 2 - Monthly');

// A client's first group check-in of a calendar month needs a balance of -$180.00 or better, i.e. owing at most this much
// (stored sign: positive = owes) after any payment taken at check-in. BIP clients are exempt. Mirrors FIRST_CHECKIN_MAX_OWED in frontend/src/utils/balance.ts.
const FIRST_CHECKIN_MAX_OWED = 180;

// awardNdiVoucher: when set (closing an SO group), a client charged the group fee whose most recent
// polygraph earns vouchers (POLY_VOUCHER_EARNING_RESULTS, or kept in the incentive by override) earns one poly fee voucher, up to POLY_VOUCHER_MAX.
// sessionNumber: which session of the group that day (1 for the first); a group can meet again after its earlier session was closed
// An Assessment or Individual type is charged its full fee and leaves the monthly fee rules and BIP weeks alone.
// paymentComments: added after the standard text on the payment's ledger row
const recordAttendance = async (db, { client, group, date, sessionNumber, paid, groupFee, accountPaid, paymentMethod, voucherUsed, type, comments, createdBy, awardNdiVoucher, feeType = 'Group Fee', paymentComments = '' }) => {
    const isIndividualSession = INDIVIDUAL_SESSION_TYPES.includes(type);
    const clientRes = await db.query('SELECT AccountBalance, ProgramType, Phase, FirstName, LastName FROM Clients WHERE ClientId = $1 FOR UPDATE', [client]);
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

    // First group check-in of the calendar month: after any payment taken now, the client may owe at most FIRST_CHECKIN_MAX_OWED.
    // BIP clients are exempt.
    if (group && clientRes.rows[0].programtype !== 'BIP') {
        const monthRes = await db.query(
            `SELECT 1 FROM Attendance WHERE Client = $1 AND ${GROUP_ATTENDANCE} AND date_trunc('month', Date) = date_trunc('month', $2::date) LIMIT 1`,
            [client, sessionDate]
        );
        const owedAfterPayment = oldBalance - Number(accountPaid || 0);
        if (monthRes.rows.length === 0 && owedAfterPayment > FIRST_CHECKIN_MAX_OWED) {
            const { lastname, firstname } = clientRes.rows[0];
            throw new Error(`${lastname}, ${firstname} must pay their existing balance before their first group check-in of the month: `
                + `the balance must be -$${FIRST_CHECKIN_MAX_OWED.toFixed(2)} or better (pay at least $${(owedAfterPayment - FIRST_CHECKIN_MAX_OWED).toFixed(2)} more).`);
        }
    }

    let feeNum = Number(groupFee || 0);
    if (!isIndividualSession && isMonthlyFeeClient(clientRes.rows[0]) && feeNum > 0) {
        const priorRes = await db.query(
            `SELECT 1 FROM Attendance WHERE Client = $1 AND ${GROUP_ATTENDANCE} AND date_trunc('month', Date) = date_trunc('month', $2::date) LIMIT 1`,
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

    await db.query(
        'UPDATE Clients SET AccountBalance = $1, LastDateAttended = $2, Phase = COALESCE($3, Phase) WHERE ClientId = $4',
        [newBalance, sessionDate, newPhase, client]
    );

    let polyVoucherAwarded = false;
    if (awardNdiVoucher && feeNum > 0) {
        const polyRes = await db.query(LAST_POLY_RESULT_SQL('$1'), [client]);
        const lastPoly = polyRes.rows[0];
        if (lastPoly && (POLY_VOUCHER_EARNING_RESULTS.includes(lastPoly.results) || lastPoly.incentivecontinued)) {
            const voucherRes = await db.query(
                'UPDATE Clients SET PolyFeeVoucher = PolyFeeVoucher + 1 WHERE ClientId = $1 AND PolyFeeVoucher < $2 RETURNING PolyFeeVoucher',
                [client, POLY_VOUCHER_MAX]
            );
            polyVoucherAwarded = voucherRes.rows.length > 0;
        }
    }

    return { attendanceId, newBalance, polyVoucherAwarded };
};

module.exports = { isMonthlyFeeClient, FIRST_CHECKIN_MAX_OWED, recordAttendance };
