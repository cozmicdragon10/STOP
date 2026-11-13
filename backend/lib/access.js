const { pool } = require('../db');
const { DEV_ROLE, effectiveRole } = require('./roles');

// Who may see and change an open check-in: Business Administrators, Office Admins, the group's counselor
// (Groups.Counselor holds the employee's display name), and the employee who opened it (CreatedBy).
// DEV is listed for SQL that compares stored roles (lib/cashResponsibility.js, reports); in JavaScript a DEV account's
// role is already read as Business Administrator.
const OPEN_GROUP_ADMIN_ROLES = ['Business Administrator', 'Office Admin', DEV_ROLE];
const openGroupViewer = async (email) => {
    const r = await pool.query('SELECT EmployeeEmail, DisplayName, Role FROM EmployeeRoles WHERE LOWER(EmployeeEmail) = LOWER($1) AND Active = TRUE', [email || '']);
    const viewer = r.rows[0];
    return viewer ? { ...viewer, role: effectiveRole(viewer.role) } : null;
};

const activeRoleFor = async (email) => {
    const roleRes = await pool.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [email]);
    return effectiveRole(roleRes.rows[0]?.role) || null;
};

module.exports = { OPEN_GROUP_ADMIN_ROLES, openGroupViewer, activeRoleFor };
