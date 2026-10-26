const { pool } = require('../db');

// Who may see and change an open check-in: Business Administrators, Office Admins, the group's counselor
// (Groups.Counselor holds the employee's display name), and the employee who opened it (CreatedBy)
const OPEN_GROUP_ADMIN_ROLES = ['Business Administrator', 'Office Admin'];
const openGroupViewer = async (email) => {
    const r = await pool.query('SELECT EmployeeEmail, DisplayName, Role FROM EmployeeRoles WHERE LOWER(EmployeeEmail) = LOWER($1) AND Active = TRUE', [email || '']);
    return r.rows[0] || null;
};

const activeRoleFor = async (email) => {
    const roleRes = await pool.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [email]);
    return roleRes.rows[0]?.role || null;
};

module.exports = { OPEN_GROUP_ADMIN_ROLES, openGroupViewer, activeRoleFor };
