// Counselors' license credentials (EmployeeRoles.Credentials, e.g. "LPC, LADC-MH"), printed after their name on everything
// the system prints: receipts, agent reports, discharge summaries and the printed reports. Mirrors nameWithCredentials in
// frontend/src/utils/credentials.ts.

// A name followed by its credentials, e.g. "Belinda Harris, LPC, LADC-MH"; just the name when there are none
const withCredentials = (name, credentials) => {
    const n = String(name ?? '').trim();
    const c = String(credentials ?? '').trim();
    return n && c ? `${n}, ${c}` : n;
};

// SQL for the credentials of the employee named by nameExpr (a display name, or an account email as covering counselors
// are saved), preferring an active account; NULL when there are none
const CREDENTIALS_SQL = (nameExpr) => `(SELECT NULLIF(TRIM(e.Credentials), '') FROM EmployeeRoles e
            WHERE LOWER(TRIM(e.DisplayName)) = LOWER(TRIM(${nameExpr})) OR LOWER(e.EmployeeEmail) = LOWER(TRIM(${nameExpr}))
            ORDER BY e.Active DESC NULLS LAST LIMIT 1)`;

module.exports = { withCredentials, CREDENTIALS_SQL };
