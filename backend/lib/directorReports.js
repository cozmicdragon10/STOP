// SQL for the director's reports (routes/directorReports.js): accounts receivable aging, census, and discharge outcomes.

// Aging buckets, newest first: [key, label, lowest age in days]. A client's balance is matched to their most recent
// charges first (payments are taken to have paid the oldest charges), so what's left owing is dated by the charges it
// came from. Balance beyond every charge on record (set by the old system's import or a hand edit) counts as over a year.
const AGING_BUCKETS = [
    ['current', '0–30 days', 0],
    ['d31', '31–60 days', 31],
    ['d61', '61–90 days', 61],
    ['d91', '91–180 days', 91],
    ['d181', '181–365 days', 181],
    ['over365', 'Over 1 year', 366],
];

const bucketColumns = AGING_BUCKETS.map(([key, , low], i) => {
    const next = AGING_BUCKETS[i + 1];
    const age = '(CURRENT_DATE - x.Day)';
    const range = next ? `${age} >= ${low} AND ${age} < ${next[2]}` : `${age} >= ${low}`;
    const sum = `COALESCE(SUM(x.Part) FILTER (WHERE ${range}), 0)`;
    return key === 'over365'
        ? `${sum} + o.Balance - COALESCE(SUM(x.Part), 0) AS ${key}`
        : `${sum} AS ${key}`;
}).join(',\n           ');

// One row per client who owes money, with the balance split into the aging buckets
const AGING_SQL = `
    WITH owing AS (
        SELECT ClientId, AccountBalance AS Balance FROM Clients WHERE AccountBalance > 0
    ), charges AS (
        -- Check-in fees come from attendance; the ledger's check-in Charge rows repeat them
        SELECT a.Client AS ClientId, a.Date AS Day, a.GroupFee AS Amount, a.AttendanceId AS SortId
        FROM Attendance a JOIN owing o ON o.ClientId = a.Client
        WHERE a.GroupFee > 0
        UNION ALL
        SELECT f.Client, f.Date::date, f.Amount, -f.TransactionId
        FROM FinancialTransactions f JOIN owing o ON o.ClientId = f.Client
        WHERE f.Type = 'Charge' AND f.AttendanceId IS NULL AND f.Amount > 0
    ), running AS (
        SELECT ClientId, Day, Amount,
               SUM(Amount) OVER (PARTITION BY ClientId ORDER BY Day DESC, SortId DESC ROWS UNBOUNDED PRECEDING) AS Through
        FROM charges
    ), x AS (
        -- The unpaid part of each recent charge: charges are used up newest first until the balance is reached
        SELECT r.ClientId, r.Day, LEAST(r.Amount, o.Balance - (r.Through - r.Amount)) AS Part
        FROM running r JOIN owing o ON o.ClientId = r.ClientId
        WHERE r.Through - r.Amount < o.Balance
    )
    SELECT o.ClientId, o.Balance, c.FirstName, c.LastName, c.DOCNumber, c.DocType,
           COALESCE(c.ProgramType, 'Unknown') AS ProgramType, COALESCE(c.ProgramStatus, 'Unknown') AS ProgramStatus,
           to_char(c.LastDateAttended, 'YYYY-MM-DD') AS LastAttended,
           (SELECT to_char(MAX(f.Date), 'YYYY-MM-DD') FROM FinancialTransactions f WHERE f.Client = o.ClientId AND f.Type = 'Payment') AS LastPayment,
           ${bucketColumns}
    FROM owing o
    JOIN Clients c ON c.ClientId = o.ClientId
    LEFT JOIN x ON x.ClientId = o.ClientId
    GROUP BY o.ClientId, o.Balance, c.ClientId
    ORDER BY o.Balance DESC, c.LastName, c.FirstName`;

// Each client's program, start, and the day they left (NULL while Active): the latest discharge record for a discharged
// client, otherwise the last day attended (clients discharged in the old system mostly have no discharge record).
// Estimated is true when the day comes from attendance rather than a discharge record.
const CLIENT_SPANS_SQL = `
    SELECT c.ClientId, COALESCE(c.ProgramType, 'Unknown') AS ProgramType, c.ProgramStatus, c.ProgramStartDate AS Started,
           CASE WHEN c.ProgramStatus = 'Active' THEN NULL
                ELSE COALESCE(CASE WHEN c.ProgramStatus <> 'Inactive' THEN d.Day END, c.LastDateAttended, c.ProgramStartDate) END AS Ended,
           (c.ProgramStatus <> 'Active' AND (c.ProgramStatus = 'Inactive' OR d.Day IS NULL)) AS Estimated
    FROM Clients c
    LEFT JOIN LATERAL (SELECT MAX(x.DischargedOn)::date AS Day FROM ClientDischarges x WHERE x.ClientId = c.ClientId) d ON TRUE`;

// Per month (YYYY-MM) and program: clients enrolled at month end (or today, for this month), intakes, discharges,
// clients going inactive, and distinct clients who attended anything that month. $1 and $2 are dates in the first and
// last months.
const CENSUS_SQL = `
    WITH spans AS (${CLIENT_SPANS_SQL}),
    months AS (
        SELECT m::date AS MonthStart, LEAST((m + INTERVAL '1 month - 1 day')::date, CURRENT_DATE) AS MonthEnd
        FROM generate_series(date_trunc('month', $1::date), date_trunc('month', $2::date), INTERVAL '1 month') m
    ), programs AS (SELECT DISTINCT ProgramType FROM spans),
    seen AS (
        SELECT date_trunc('month', a.Date)::date AS MonthStart, COALESCE(c.ProgramType, 'Unknown') AS ProgramType,
               COUNT(DISTINCT a.Client)::int AS Seen
        FROM Attendance a JOIN Clients c ON c.ClientId = a.Client
        WHERE a.Date >= date_trunc('month', $1::date) AND a.Date < date_trunc('month', $2::date) + INTERVAL '1 month'
        GROUP BY 1, 2
    )
    SELECT to_char(m.MonthStart, 'YYYY-MM') AS Month, p.ProgramType,
           (SELECT COUNT(*) FROM spans s WHERE s.ProgramType = p.ProgramType AND s.Started <= m.MonthEnd
                AND (s.Ended IS NULL OR s.Ended > m.MonthEnd))::int AS Enrolled,
           (SELECT COUNT(*) FROM spans s WHERE s.ProgramType = p.ProgramType AND s.Started BETWEEN m.MonthStart AND m.MonthEnd)::int AS Intakes,
           (SELECT COUNT(*) FROM spans s WHERE s.ProgramType = p.ProgramType AND s.ProgramStatus <> 'Inactive'
                AND s.Ended BETWEEN m.MonthStart AND m.MonthEnd)::int AS Discharged,
           (SELECT COUNT(*) FROM spans s WHERE s.ProgramType = p.ProgramType AND s.ProgramStatus = 'Inactive'
                AND s.Ended BETWEEN m.MonthStart AND m.MonthEnd)::int AS WentInactive,
           COALESCE(sn.Seen, 0) AS Seen
    FROM months m CROSS JOIN programs p
    LEFT JOIN seen sn ON sn.MonthStart = m.MonthStart AND sn.ProgramType = p.ProgramType
    ORDER BY 1, 2`;

// Discharges in the date range by month, program, type, and subcategory, with time in the program (days from start to
// discharge). Every discharge record counts (a client discharged twice counts twice); discharged clients with no
// record count once, on their last day attended, marked Estimated.
const OUTCOMES_SQL = `
    WITH exits AS (
        SELECT d.DischargedOn::date AS Day, COALESCE(c.ProgramType, 'Unknown') AS ProgramType, d.DischargeType AS Type,
               COALESCE(d.Subcategory, '') AS Subcategory, c.ProgramStartDate AS Started, FALSE AS Estimated
        FROM ClientDischarges d JOIN Clients c ON c.ClientId = d.ClientId
        UNION ALL
        SELECT s.Ended, s.ProgramType, s.ProgramStatus, '', s.Started, TRUE
        FROM (${CLIENT_SPANS_SQL}) s
        WHERE s.ProgramStatus = ANY($3) AND s.Estimated
    )
    SELECT to_char(Day, 'YYYY-MM') AS Month, ProgramType, Type, Subcategory, Estimated, COUNT(*)::int AS Count,
           COALESCE(SUM(Day - Started) FILTER (WHERE Started IS NOT NULL AND Day >= Started), 0)::int AS TotalDays,
           COUNT(*) FILTER (WHERE Started IS NOT NULL AND Day >= Started)::int AS WithDays
    FROM exits
    WHERE Day BETWEEN $1 AND $2
    GROUP BY 1, 2, 3, 4, 5
    ORDER BY 1, 2, 3, 4`;

module.exports = { AGING_BUCKETS, AGING_SQL, CENSUS_SQL, OUTCOMES_SQL };
