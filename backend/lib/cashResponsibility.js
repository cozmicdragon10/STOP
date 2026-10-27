const { pool } = require('../db');
const { OPEN_GROUP_ADMIN_ROLES } = require('./access');

// Who is responsible for a closed group session's cash:
//   1. the covering counselor, when the office picked one at check-in;
//   2. otherwise, when an Office Admin or Business Administrator opened the session, the group's usual counselor
//      (Groups.Counselor holds a display name), so the office can check a group in for its counselor;
//   3. otherwise whoever opened it, so a counselor covering another's group holds that cash.
// If the group's counselor has no active account, the opener stays responsible.

// Wraps a query of closed sessions (columns GroupId, Counselor, OpenedBy, CoveredBy) and adds Responsible (an email)
// and ResponsibleName. OpenGroupAdminRoles is bound as $adminRolesParam.
const withResponsible = (sessionsSql, adminRolesParam) => `
    SELECT s.*,
           r.Responsible,
           er.DisplayName AS ResponsibleName
    FROM (${sessionsSql}) s
    LEFT JOIN EmployeeRoles eo ON LOWER(eo.EmployeeEmail) = LOWER(s.OpenedBy)
    LEFT JOIN LATERAL (
        SELECT EmployeeEmail FROM EmployeeRoles
        WHERE Active = TRUE AND LOWER(TRIM(DisplayName)) = LOWER(TRIM(s.Counselor))
        ORDER BY EmployeeEmail LIMIT 1
    ) ec ON TRUE
    CROSS JOIN LATERAL (
        SELECT COALESCE(
            NULLIF(TRIM(s.CoveredBy), ''),
            CASE WHEN eo.Role = ANY(${adminRolesParam}::text[]) THEN ec.EmployeeEmail END,
            s.OpenedBy
        ) AS Responsible
    ) r
    LEFT JOIN EmployeeRoles er ON LOWER(er.EmployeeEmail) = LOWER(r.Responsible)`;

// The covering counselor to save with a check-in. Only an Office Admin or Business Administrator can pick one, and it
// must be an active employee. Returns the email to store (null for none), or throws with a message for the user.
// keep is the value already saved on the open check-in, kept when someone else saves or closes it.
const coveringCounselorFor = async (requesterEmail, coveredBy, keep = null) => {
    const roleRes = await pool.query('SELECT Role FROM EmployeeRoles WHERE LOWER(EmployeeEmail) = LOWER($1) AND Active = TRUE', [requesterEmail || '']);
    if (!OPEN_GROUP_ADMIN_ROLES.includes(roleRes.rows[0]?.role)) return keep;
    const email = String(coveredBy || '').trim();
    if (!email) return null;
    const emp = await pool.query('SELECT EmployeeEmail FROM EmployeeRoles WHERE LOWER(EmployeeEmail) = LOWER($1) AND Active = TRUE', [email]);
    if (!emp.rows[0]) {
        const err = new Error('The covering counselor must be an active employee.');
        err.status = 400;
        throw err;
    }
    return emp.rows[0].employeeemail;
};

module.exports = { withResponsible, coveringCounselorFor, OPEN_GROUP_ADMIN_ROLES };
