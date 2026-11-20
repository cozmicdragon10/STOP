const { assertCardAllowed } = require('./cardBlock');
const { paymentDetails, paymentMethodProblem, paymentMethodText } = require('./paymentMethods');
const { dateText, dollars, logClientChange } = require('./changeLog');
const { moneyText } = require('./moneyFields');
const { todayLocal } = require('./dates');
const { LAST_POLY_RESULT_SQL, POLY_VOUCHER_EARNING_RESULTS, polyVoucherMax } = require('./poly');
const {
    ACTIVE_DEBT_LIMIT, BIP_CHECKIN_BLOCK, FEE_ONCE_PER_PERIOD_PROGRAMS, FEE_PERIOD_MONTHS, GROUP_ATTENDANCE, INDIVIDUAL_SESSION_TYPES, MONTHLY_FEE_PHASES,
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

// A client's first group check-in of a calendar month needs a balance of $0.00 or better, i.e. owing at most this much
// (stored sign: positive = owes) after any payment taken at check-in. Mirrors FIRST_CHECKIN_MAX_OWED in frontend/src/utils/balance.ts.
const FIRST_CHECKIN_MAX_OWED = 0;

// Which payment rule a client's group check-in follows (mirrors checkInPaymentRule in frontend/src/utils/balance.ts):
//   'none'    BIP clients: no balance requirement
//   'federal' Federal SO, Fed Drug Test and Poly Only clients: no balance requirement, so they can owe any amount, unless
//             a Max Debt Override is set: then a check-in that charges a copay can't leave them owing more than it
//   'each'    Chaperon clients: every attendance is paid the day of it, so the balance after check-in, today's fee
//             included, must be $0.00 or better
//   'first'   everyone else: the first group check-in of the month needs the balance before today's fee at $0.00 or better
const NO_CHECKIN_LIMIT_PROGRAMS = ['BIP'];
const FEDERAL_PAYMENT_PROGRAMS = ['Federal SO', 'Fed Drug Test', 'Poly Only'];
const PAY_EACH_VISIT_PROGRAMS = ['Chaperon'];
const checkInPaymentRule = (programType) =>
    NO_CHECKIN_LIMIT_PROGRAMS.includes(programType) ? 'none'
        : FEDERAL_PAYMENT_PROGRAMS.includes(programType) ? 'federal'
            : PAY_EACH_VISIT_PROGRAMS.includes(programType) ? 'each' : 'first';
// The smallest payment that lets a group or individual check-in through, from the balance before it (stored sign:
// positive = owes) and today's fee; 0 when nothing has to be paid. maxOwed: a Max Debt Override (ClientDebtLimits) lets
// the client owe up to that much instead of FIRST_CHECKIN_MAX_OWED; for federal clients it is the most a charge may
// leave them owing. Mirrors minimumCheckInPayment in frontend/src/utils/balance.ts.
const allowedOwed = (maxOwed) => Math.max(FIRST_CHECKIN_MAX_OWED, Number(maxOwed) || 0);
const minimumCheckInPayment = (rule, balance, fee, attendedThisMonth, maxOwed = 0) => {
    const owed = rule === 'each' || (rule === 'federal' && Number(fee) > 0 && Number(maxOwed) > 0) ? Number(balance || 0) + Number(fee || 0)
        : rule === 'first' && !attendedThisMonth ? Number(balance || 0) : -Infinity;
    return Math.max(0, Math.round((owed - allowedOwed(maxOwed)) * 100) / 100);
};
// How the allowed balance reads in a refusal: "$0.00 or better", or "owing at most $100.00 (Max Debt Override)"
const allowedBalanceText = (maxOwed) => (Number(maxOwed) > 0
    ? `owing at most $${allowedOwed(maxOwed).toFixed(2)} (Max Debt Override)`
    : `${FIRST_CHECKIN_MAX_OWED > 0 ? '-' : ''}$${FIRST_CHECKIN_MAX_OWED.toFixed(2)} or better`);
// Why a check-in was refused for being short; kind: 'group' or 'individual'
const shortPaymentMessage = (rule, name, kind, maxOwed, short) => {
    const limit = allowedBalanceText(maxOwed);
    const more = `(pay at least $${short.toFixed(2)} more)`;
    if (rule === 'federal') return `${name}'s copay would put the account past their Max Debt Override: the balance after check-in, including today's copay, must be ${limit} ${more}.`;
    if (rule === 'each') return `${name}'s chaperon ${kind === 'group' ? 'attendance' : 'session'} must be paid the day of it: the balance after check-in, including today's fee, must be ${limit} ${more}.`;
    return `${name} must pay their existing balance before their first ${kind} ${kind === 'group' ? 'check-in' : 'session'} of the month: the balance must be ${limit} ${more}.`;
};

// A federal client's group fee is their Group Copay (nothing when blank), never the treatment fee: Fed Drug Test clients pay
// it at every drug test, Federal SO clients on their first group attendance of the month. null for everyone else.
// Mirrors federalGroupFee in frontend/src/utils/clients.ts.
const federalGroupFee = (programType, copay, attendedThisMonth) => {
    if (programType === 'Fed Drug Test') return Number(copay || 0);
    if (programType === 'Federal SO') return attendedThisMonth ? 0 : Number(copay || 0);
    return null;
};

// awardNdiVoucher: when set (closing an SO group), a client charged the group fee whose most recent
// polygraph earns vouchers (POLY_VOUCHER_EARNING_RESULTS, or kept in the incentive by override) earns one poly fee voucher, up to their full set (polyVoucherMax).
// sessionNumber: which session of the group that day (1 for the first); a group can meet again after its earlier session was closed
// An Assessment or Individual type is charged its full fee and leaves the monthly fee rules and BIP weeks alone.
// paymentComments: added after the standard text on the payment's ledger row
// sessionTypeId and provider: the price list entry and the counselor of an individual session (Attendance.SessionTypeId, Provider)
// paymentSubtype and paymentReference: an Other payment's kind (Check, DHS, ...) and reference # (lib/paymentMethods.js).
// Who may record which kind is checked by the routes, which know the user's role.
const recordAttendance = async (db, { client, group, date, sessionNumber, paid, groupFee, accountPaid, paymentMethod, paymentSubtype = null, paymentReference = null, voucherUsed, type, comments, createdBy, awardNdiVoucher, feeType = 'Group Fee', paymentComments = '', sessionTypeId = null, provider = null }) => {
    const isIndividualSession = INDIVIDUAL_SESSION_TYPES.includes(type);
    // Money must be real amounts: a payment that isn't a number would skip the first check-in limit and leave the balance NaN
    for (const [label, value] of [['payment', accountPaid], ['fee', groupFee]]) {
        const n = Number(value ?? 0);
        if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error(`The ${label} must be an amount of $0.00 or more.`), { status: 400 });
    }
    // The type has to match where the check-in happens, so a group check-in can't be passed off as an assessment or
    // individual session (which skip the first check-in limit) and a group check-in always has its group: assessments
    // have no group, individual sessions are either standalone or in a counselor's INDIVIDUAL group, and every other
    // check-in is in a group.
    if (type === 'Assessment' && group) throw Object.assign(new Error('An assessment is not checked in to a group.'), { status: 400 });
    if (!isIndividualSession && !group) throw Object.assign(new Error('A group check-in needs its group.'), { status: 400 });
    if (type === 'Individual' && group) {
        const g = await db.query('SELECT UPPER(TRIM(ProgramType)) AS t FROM Groups WHERE GroupId = $1', [group]);
        if (g.rows[0]?.t !== 'INDIVIDUAL') throw Object.assign(new Error('Only an INDIVIDUAL group records individual sessions.'), { status: 400 });
    }
    const clientRes = await db.query('SELECT AccountBalance, ProgramType, Phase, FirstName, LastName, TreatmentFee, GroupCopay FROM Clients WHERE ClientId = $1 FOR UPDATE', [client]);
    if (clientRes.rows.length === 0) {
        throw new Error(`Client ${client} not found.`);
    }

    const sessionDate = date || todayLocal();
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
    // A Max Debt Override in effect today: how much the client may owe and still attend (0 when none)
    const maxOwed = Number((await db.query(`SELECT ${ACTIVE_DEBT_LIMIT('$1::int')} AS maxowed`, [client])).rows[0]?.maxowed || 0);

    // Whether the client already attended a group in the session's month (assessments and individual sessions don't count)
    const attendedThatMonth = group && !isIndividualSession
        ? (await db.query(
            `SELECT 1 FROM Attendance WHERE Client = $1 AND ${GROUP_ATTENDANCE} AND date_trunc('month', Date) = date_trunc('month', $2::date) LIMIT 1`,
            [client, sessionDate]
        )).rows.length > 0
        : false;

    // A group check-in's fee is worked out here from the account, by the same rules as the check-in screen (clientFee in
    // frontend/src/hooks/useGroupCheckIn.ts), so a screen that's out of date or a session on an earlier date can't charge
    // the wrong fee: a monthly-fee client who already attended a group in the session's month, or a Phase 3 or 4 client
    // charged in the period before the session date, pays nothing; federal clients pay their copay (federalGroupFee);
    // otherwise a fee override covering the session date, or the treatment fee. Assessments and individual sessions keep
    // the fee they were priced at.
    let feeNum = Number(groupFee || 0);
    let feeReason = null;
    if (group && !isIndividualSession) {
        const monthName = new Date(`${sessionDate}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const monthly = isMonthlyFeeClient(clientRes.rows[0]);
        const periodMonths = feePeriodMonths(clientRes.rows[0]);
        const chargedOn = periodMonths ? await chargedWithinMonths(db, client, sessionDate, periodMonths) : null;
        const { programtype, groupcopay } = clientRes.rows[0];
        const federalFee = federalGroupFee(programtype, groupcopay, attendedThatMonth);
        if (federalFee !== null) {
            feeNum = federalFee;
            feeReason = programtype === 'Federal SO' && attendedThatMonth ? `copay already charged for ${monthName}`
                : federalFee > 0 ? (programtype === 'Federal SO' ? `copay, first group attendance of ${monthName}` : 'copay for each drug test')
                    : 'no copay on the account';
        } else if (monthly && attendedThatMonth) {
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

        // The check-in's payment rule (checkInPaymentRule): Chaperon attendances are paid the day of them, federal clients
        // can owe any amount unless a Max Debt Override caps it, and other clients' first group check-in of the month
        // needs the balance at FIRST_CHECKIN_MAX_OWED or better (or within a Max Debt Override)
        const rule = checkInPaymentRule(programtype);
        const short = Math.round((minimumCheckInPayment(rule, oldBalance, feeNum, attendedThatMonth, maxOwed) - Number(accountPaid || 0)) * 100) / 100;
        if (short > 0) {
            const { lastname, firstname } = clientRes.rows[0];
            throw new Error(shortPaymentMessage(rule, `${lastname}, ${firstname}`, 'group', maxOwed, short));
        }
    }

    // An individual session in a counselor's INDIVIDUAL group follows the same payment rule, counting the client's first
    // individual session of the month (Chaperon: every one), within any Max Debt Override
    if (group && type === 'Individual') {
        const { programtype, lastname, firstname } = clientRes.rows[0];
        const hadOne = (await db.query(
            `SELECT 1 FROM Attendance WHERE Client = $1 AND Type = 'Individual' AND date_trunc('month', Date) = date_trunc('month', $2::date) LIMIT 1`,
            [client, sessionDate]
        )).rows.length > 0;
        const rule = checkInPaymentRule(programtype);
        const short = Math.round((minimumCheckInPayment(rule, oldBalance, feeNum, hadOne, maxOwed) - Number(accountPaid || 0)) * 100) / 100;
        if (short > 0) throw new Error(shortPaymentMessage(rule, `${lastname}, ${firstname}`, 'individual', maxOwed, short));
    }
    const paidNum = Number(accountPaid || 0);
    const newBalance = oldBalance - paidNum + feeNum;

    // Every payment needs a method (Cash, Credit Card, or Other with its kind). Group check-ins and individual sessions
    // take cards through POST /api/financials/payment, so the payment stands whether or not the attendance is ever recorded.
    if (paidNum > 0) {
        const methodProblem = paymentMethodProblem({ method: paymentMethod, subtype: paymentSubtype, role: 'Business Administrator' });
        if (methodProblem) throw Object.assign(new Error(`${clientRes.rows[0].lastname}, ${clientRes.rows[0].firstname}: ${methodProblem}`), { status: 400 });
    }
    if (paidNum > 0 && paymentMethod === 'Credit Card') await assertCardAllowed(db, client);
    const { subtype, reference } = paidNum > 0 ? paymentDetails({ method: paymentMethod, subtype: paymentSubtype, reference: paymentReference }) : { subtype: null, reference: null };

    const attRes = await db.query(
        `INSERT INTO Attendance (Client, "Group", Date, Paid, GroupFee, AccountPaid, AccountTotal, VoucherUsed, Type, Comments, CreatedBy, PaymentMethod, SessionNumber, SessionTypeId, Provider, PaymentSubtype, PaymentReference)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING AttendanceId;`,
        [client, group || null, sessionDate, paid, feeNum, paidNum, newBalance, voucherUsed, type, comments || null, createdBy, paidNum > 0 ? paymentMethod : null, sessionNum, sessionTypeId, provider, subtype, reference]
    );

    const attendanceId = attRes.rows[0].attendanceid;
    if (paidNum > 0) {
        await db.query(
            `INSERT INTO FinancialTransactions (Client, Date, Type, Amount, FeeType, FinalBalance, Comments, PaymentMethod, AttendanceId, EnteredBy, PaymentSubtype, PaymentReference)
             VALUES ($1, NOW(), 'Payment', $2, $7, $3, $4, $5, $6, $8, $9, $10)`,
            [client, paidNum, newBalance, `Payment applied during ${type} session on ${sessionDate}.${paymentComments ? ` ${paymentComments}` : ''}`, paymentMethod, attendanceId, feeType, createdBy || null, subtype, reference]
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

    // The check-in goes on the client's change log with what it did to the account
    const groupName = group
        ? (await db.query('SELECT GroupName FROM Groups WHERE GroupId = $1', [group])).rows[0]?.groupname || `Group ${group}`
        : null;
    const charged = `fee ${dollars(feeNum)}${feeReason ? ` (${feeReason})` : ''}`;
    const payment = paidNum > 0 ? `paid ${dollars(paidNum)} ${paymentMethodText(paymentMethod, subtype, reference)}` : 'no payment';
    await logClientChange(db, {
        clientId: client, changedBy: createdBy, changeType: 'Attendance Added',
        oldValue: moneyText('accountbalance', oldBalance), newValue: moneyText('accountbalance', newBalance),
        details: `${groupName || type}${groupName && type && type !== 'Group' ? ` (${type})` : ''}${sessionNum > 1 ? ` session ${sessionNum}` : ''} on ${dateText(sessionDate)}: ${charged}, ${payment}.`
            + (newPhase ? ` BIP week now ${newPhase}.` : '')
            + (polyVoucherAwarded ? ' Earned a poly fee voucher.' : '')
            + (comments ? ` ${comments}` : ''),
    });

    // feeCharged and feeReason: what the account was charged and why, for telling the user when it differs from what was sent.
    // bipWeek: a BIP client's week number counting this attendance (null for everyone else)
    return { attendanceId, newBalance, polyVoucherAwarded, feeCharged: feeNum, feeReason, bipWeek: newPhase };
};

// The Individual price on the Admin price list that an INDIVIDUAL group check-in charges: the active Individual entry
// named "Individual", else the first active Individual entry. null when there is none. Mirrors individualPriceFrom in
// frontend/src/utils/clients.ts.
const individualPrice = async (db) => {
    const r = await db.query(
        `SELECT SessionTypeId, Fee FROM SessionTypes WHERE Category = 'Individual' AND Active
         ORDER BY (Name = 'Individual') DESC, SessionTypeId LIMIT 1`
    );
    return r.rows[0] ? { sessionTypeId: r.rows[0].sessiontypeid, fee: Number(r.rows[0].fee) } : null;
};

module.exports = {
    isMonthlyFeeClient, feePeriodMonths, chargedWithinMonths, FIRST_CHECKIN_MAX_OWED, checkInPaymentRule, minimumCheckInPayment, federalGroupFee,
    allowedOwed, allowedBalanceText, FEDERAL_PAYMENT_PROGRAMS,
    recordAttendance, individualPrice,
};
