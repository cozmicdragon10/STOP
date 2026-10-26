// SQL fragments and constants shared by the client, group, attendance, and session routes

// Assessments and individual sessions are attendance (Last Attended, attendance history) but never count toward the
// monthly group fee rules, the first check-in of the month, or BIP weeks
const INDIVIDUAL_SESSION_TYPES = ['Assessment', 'Individual'];
const GROUP_ATTENDANCE = `Type NOT IN ('Assessment', 'Individual')`;
// A BIP client's completed BIP assessments: intakes and reinstates done here, and intakes done at another provider
// At is when the row was entered (NULL on older attendance rows), used to order an assessment and a discharge on the same day.
const BIP_ASSESSMENTS_FOR = (client) => `
    SELECT a.Date AS Done, a.CreatedOn AS At, st.Kind, 'here' AS Source FROM Attendance a JOIN SessionTypes st ON st.SessionTypeId = a.SessionTypeId
    WHERE a.Client = ${client} AND st.Kind IN ('BIP Intake', 'BIP Reinstate')
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
    ? `${name} is a BIP client with no BIP Intake or DV Assessment on record. Complete one on the Assessments & Individuals tab (or record one done at another provider on the client's Information tab) before group check-in.`
    : block === 'our-intake'
        ? `${name} was discharged after an intake done at another provider. Complete our BIP Intake or DV Assessment on the Assessments & Individuals tab before group check-in.`
        : `${name} was discharged and reactivated. Complete the BIP Reinstate assessment on the Assessments & Individuals tab before group check-in.`);

// True when the client already has an attendance row in the current calendar month.
// Used for the State SO Phase 1 rule: the treatment fee is charged once per month.
const ATTENDED_THIS_MONTH = `EXISTS (SELECT 1 FROM Attendance a WHERE a.Client = c.ClientId AND a.${GROUP_ATTENDANCE} AND date_trunc('month', a.Date) = date_trunc('month', CURRENT_DATE))`;

const ACTIVE_FEE_OVERRIDE = `(SELECT o.ReducedFee FROM TemporaryFeeOverrides o WHERE o.ClientId = c.ClientId AND o.ExpirationDate >= CURRENT_DATE ORDER BY o.CreatedOn DESC LIMIT 1)`;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

module.exports = { INDIVIDUAL_SESSION_TYPES, GROUP_ATTENDANCE, NEEDS_OUR_INTAKE, BIP_CHECKIN_BLOCK, bipCheckInBlockMessage, ATTENDED_THIS_MONTH, ACTIVE_FEE_OVERRIDE, YMD };
