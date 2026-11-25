// SQL fragments and constants shared by the client, group, attendance, and session routes

// Assessments and individual sessions are attendance (Last Attended, attendance history) but never count toward the
// monthly group fee rules, the first check-in of the month, or BIP weeks
const INDIVIDUAL_SESSION_TYPES = ['Assessment', 'Individual'];
const GROUP_ATTENDANCE = `Type NOT IN ('Assessment', 'Individual')`;
// A BIP client's completed BIP assessments: intakes and reinstates done here (not ones begun and still In Progress), and
// intakes done at another provider
// At is when the row was entered (NULL on older attendance rows), used to order an assessment and a discharge on the same day.
const BIP_ASSESSMENTS_FOR = (client) => `
    SELECT a.Date AS Done, a.CreatedOn AS At, st.Kind, 'here' AS Source FROM Attendance a JOIN SessionTypes st ON st.SessionTypeId = a.SessionTypeId
    WHERE a.Client = ${client} AND st.Kind IN ('BIP Intake', 'BIP Reinstate') AND a.AssessmentStatus IS DISTINCT FROM 'In Progress'
    UNION ALL
    SELECT o.AssessmentDate, o.RecordedOn, 'BIP Intake', 'outside' FROM OutsideBipAssessments o WHERE o.ClientId = ${client}`;
// The client's last discharge as a one-row table (Day, Ts); no rows when they have never been discharged
const LAST_DISCHARGE = (client) => `(SELECT d.DischargedOn::date AS Day, d.DischargedOn AS Ts FROM ClientDischarges d
    WHERE d.ClientId = ${client} ORDER BY d.DischargedOn DESC, d.DischargeId DESC LIMIT 1)`;
// Assessment x came after discharge ld: dated after the discharge day, or dated that day and entered after the discharge
const AFTER_DISCHARGE = `(x.Done > ld.Day OR (x.Done = ld.Day AND COALESCE(x.At > ld.Ts, FALSE)))`;
// True when the client's last intake before their last discharge (any discharge type) was done at another provider:
// a BIP Reinstate isn't allowed, and only our own BIP Intake or DV Assessment after the discharge clears them for group.
const NEEDS_OUR_INTAKE = (client) => `EXISTS (
    SELECT 1 FROM ${LAST_DISCHARGE(client)} ld
    WHERE (SELECT x.Source FROM (${BIP_ASSESSMENTS_FOR(client)}) x WHERE x.Kind = 'BIP Intake' AND NOT ${AFTER_DISCHARGE}
           ORDER BY x.Done DESC, x.At DESC NULLS LAST LIMIT 1) = 'outside')`;
// Why a BIP client can't be checked into group yet, or NULL when they can: 'intake' (no BIP Intake or DV Assessment on
// record, here or at another provider), 'our-intake' (see NEEDS_OUR_INTAKE: our own intake is needed after the discharge),
// or 'reinstate' (no BIP reinstate or intake completed since their last discharge). Mirrors bipCheckInBlockMessage in
// frontend/src/utils/bip.ts.
const BIP_CHECKIN_BLOCK = `CASE WHEN c.ProgramType IS DISTINCT FROM 'BIP' THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM (${BIP_ASSESSMENTS_FOR('c.ClientId')}) x WHERE x.Kind = 'BIP Intake') THEN 'intake'
    WHEN ${NEEDS_OUR_INTAKE('c.ClientId')} AND NOT EXISTS (SELECT 1 FROM ${LAST_DISCHARGE('c.ClientId')} ld, (${BIP_ASSESSMENTS_FOR('c.ClientId')}) x
        WHERE x.Kind = 'BIP Intake' AND x.Source = 'here' AND ${AFTER_DISCHARGE}) THEN 'our-intake'
    WHEN EXISTS (SELECT 1 FROM ${LAST_DISCHARGE('c.ClientId')} ld) AND NOT EXISTS (SELECT 1 FROM ${LAST_DISCHARGE('c.ClientId')} ld, (${BIP_ASSESSMENTS_FOR('c.ClientId')}) x
        WHERE ${AFTER_DISCHARGE}) THEN 'reinstate'
    END`;
const bipCheckInBlockMessage = (block, name) => (block === 'intake'
    ? `${name} is a BIP client with no BIP Intake or DV Assessment on record. Complete one on the Assessments tab (or record one done at another provider on the client's Information tab) before group check-in.`
    : block === 'our-intake'
        ? `${name} was discharged after an intake done at another provider. Complete our BIP Intake or DV Assessment on the Assessments tab before group check-in.`
        : `${name} was discharged and reactivated. Complete the BIP Reinstate assessment on the Assessments tab before group check-in.`);

// The date of the client's last BIP intake: a completed BIP Intake or DV Assessment done here, or one recorded from another
// provider (NULL when there is none). A BIP Reinstate is not an intake, so the week count carries on through a reinstate.
const LAST_BIP_INTAKE = (client) => `(SELECT MAX(x.Done) FROM (${BIP_ASSESSMENTS_FOR(client)}) x WHERE x.Kind = 'BIP Intake')`;
// A BIP client's week: the group attendances dated on or after their last BIP intake (all of them when there is none).
// Check-ins add one and deletions take one off (lib/attendance.js, routes/attendance.js); lib/bipWeeks.js recounts it
// from here when the last intake changes.
const BIP_WEEKS = (client) => `(SELECT COUNT(*) FROM Attendance w WHERE w.Client = ${client} AND w.${GROUP_ATTENDANCE}
    AND w.Date >= COALESCE(${LAST_BIP_INTAKE(client)}, '-infinity'::date))`;

// True when the client already has an attendance row in the current calendar month.
// Used for the State SO Phase 1 rule: the treatment fee is charged once per month.
const ATTENDED_THIS_MONTH = `EXISTS (SELECT 1 FROM Attendance a WHERE a.Client = c.ClientId AND a.${GROUP_ATTENDANCE} AND date_trunc('month', a.Date) = date_trunc('month', CURRENT_DATE))`;
// True when the client already had an individual session this calendar month (the individual first-of-the-month rule)
const INDIVIDUAL_THIS_MONTH = `EXISTS (SELECT 1 FROM Attendance a WHERE a.Client = c.ClientId AND a.Type = 'Individual' AND date_trunc('month', a.Date) = date_trunc('month', CURRENT_DATE))`;
// The most a client may owe and still attend under an unexpired Max Debt Override (ClientDebtLimits), or NULL (none: $0.00)
const ACTIVE_DEBT_LIMIT = (client = 'c.ClientId') => `(SELECT d.MaxOwed FROM ClientDebtLimits d
    WHERE d.ClientId = ${client} AND d.ExpirationDate >= CURRENT_DATE ORDER BY d.CreatedOn DESC, d.DebtLimitId DESC LIMIT 1)`;

// State SO and Voluntary SO clients pay the treatment fee once per period: Phase 1 and 2 once per calendar month (on their
// first group attendance), Phase 3 and 4 once per this many months, rolling from their last charged group attendance.
// Mirrors frontend/src/utils/soPhases.ts.
const MONTHLY_FEE_PHASES = ['Phase 1 - Weekly', 'Phase 2 - Monthly'];
const FEE_PERIOD_MONTHS = { 'Phase 3 - Quarterly': 3, 'Phase 4 - Semi Anual': 6 };
const FEE_ONCE_PER_PERIOD_PROGRAMS = ['State SO', 'Voluntary SO'];
const sqlList = (values) => values.map(v => `'${v}'`).join(', ');
// True when a group check-in today would charge no treatment fee because this period's was already charged
const FEE_ALREADY_CHARGED = `CASE
    WHEN c.ProgramType NOT IN (${sqlList(FEE_ONCE_PER_PERIOD_PROGRAMS)}) THEN FALSE
    WHEN c.Phase IN (${sqlList(MONTHLY_FEE_PHASES)}) THEN ${ATTENDED_THIS_MONTH}
    WHEN c.Phase IN (${sqlList(Object.keys(FEE_PERIOD_MONTHS))}) THEN EXISTS (
        SELECT 1 FROM Attendance a WHERE a.Client = c.ClientId AND a.${GROUP_ATTENDANCE} AND a.GroupFee > 0 AND a.Date <= CURRENT_DATE
          AND a.Date > CURRENT_DATE - make_interval(months => CASE c.Phase ${Object.entries(FEE_PERIOD_MONTHS).map(([p, m]) => `WHEN '${p}' THEN ${m}`).join(' ')} END))
    ELSE FALSE END`;

const ACTIVE_FEE_OVERRIDE =`(SELECT o.ReducedFee FROM TemporaryFeeOverrides o WHERE o.ClientId = c.ClientId AND o.ExpirationDate >= CURRENT_DATE ORDER BY o.CreatedOn DESC LIMIT 1)`;

// A check-in that takes a payment writes one ledger row, the payment (lib/attendance.js recordAttendance); its fee is on
// the attendance row only. For ledger row f joined to its attendance a, this is that fee, or NULL for any other row
// (charges, account payments, refunds and disputes), so the fee is counted exactly once.
const SESSION_FEE_SQL = `CASE WHEN f.Type = 'Payment' AND f.RelatedTransactionId IS NULL AND f.Comments LIKE 'Payment applied during %'
    AND a.GroupFee > 0 THEN a.GroupFee END`;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Discharge types a Business Administrator can pick; each becomes the client's program status (Inactive is a pause, not
// a discharge). routes/clients.js and the frontend's utils/clients.ts keep the same list; test/sharedRules.test.js checks.
const DISCHARGE_STATUSES = ['Completed', 'Deceased', 'Discharged Supervision', 'Program Failed', 'Revoked', 'Transferred', 'Terminated'];

module.exports = {
    DISCHARGE_STATUSES, INDIVIDUAL_SESSION_TYPES, GROUP_ATTENDANCE, LAST_BIP_INTAKE, BIP_WEEKS, NEEDS_OUR_INTAKE, BIP_CHECKIN_BLOCK, bipCheckInBlockMessage, ATTENDED_THIS_MONTH,
    INDIVIDUAL_THIS_MONTH, ACTIVE_DEBT_LIMIT,
    MONTHLY_FEE_PHASES, FEE_PERIOD_MONTHS, FEE_ONCE_PER_PERIOD_PROGRAMS, FEE_ALREADY_CHARGED, ACTIVE_FEE_OVERRIDE, SESSION_FEE_SQL, YMD,
};
