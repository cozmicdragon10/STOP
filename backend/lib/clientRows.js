// A client row as the roster, every client picker, and an open group sheet use it (routes/clients.js, routes/openGroups.js)
const { ACTIVE_DEBT_LIMIT, ACTIVE_FEE_OVERRIDE, ATTENDED_THIS_MONTH, BIP_CHECKIN_BLOCK, FEE_ALREADY_CHARGED, INDIVIDUAL_THIS_MONTH } = require('./sql');
const { FEDERAL_UNITS_SQL, FEDERAL_UNIT_REFILLS_SQL, LAST_DRUG_TEST_SQL } = require('./federalUnits');

// The day (YYYY-MM-DD) of the client's next scheduled polygraph, today or later; null when none is booked
const NEXT_POLY_SQL = `(SELECT to_char(s.Date, 'YYYY-MM-DD') FROM PolygraphAppointments a JOIN PolygraphSlots s ON s.SlotId = a.SlotId
        WHERE a.Client = c.ClientId AND a.Status = 'Scheduled' AND s.Date >= CURRENT_DATE ORDER BY s.Date, s.Time LIMIT 1)`;

// A client row (where: the WHERE clause on Clients c)
const clientRowsSql = (where) => `
    SELECT
        c.*,
        g.GroupName,
        ig.GroupName AS IndividualGroupName,
        ${FEDERAL_UNITS_SQL('c.ClientId')} AS FederalUnits, ${FEDERAL_UNIT_REFILLS_SQL('c.ClientId')} AS FederalUnitRefills,
        CASE WHEN c.ProgramType = 'Fed Drug Test' THEN ${LAST_DRUG_TEST_SQL('c.ClientId')} END AS LastDrugTest,
        COALESCE(c.ProgramType, g.ProgramType, 'State SO') AS ProgramType,
        (SELECT Date FROM Attendance WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastAttended,
        (SELECT Date FROM PolygraphResults WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastPoly,
        ${NEXT_POLY_SQL} AS NextPoly,
        ${ATTENDED_THIS_MONTH} AS AttendedThisMonth,
        ${FEE_ALREADY_CHARGED} AS FeeAlreadyCharged,
        ${ACTIVE_FEE_OVERRIDE} AS ActiveFeeOverride,
        ${INDIVIDUAL_THIS_MONTH} AS IndividualThisMonth,
        ${ACTIVE_DEBT_LIMIT()} AS MaxOwed,
        ${BIP_CHECKIN_BLOCK} AS BipCheckInBlock
    FROM Clients c
    LEFT JOIN Groups g ON c.GroupId = g.GroupId
    LEFT JOIN Groups ig ON c.IndividualGroupId = ig.GroupId
    ${where}
    ORDER BY c.LastName ASC`;

module.exports = { NEXT_POLY_SQL, clientRowsSql };
