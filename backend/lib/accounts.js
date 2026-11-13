// Rules for changing an employee account. The account routes are for Business Administrators only (routes/admin.js), as
// on the Admin tab; these rules also hold on their own, so the Business Administrator role can't be handed out or taken
// over (by resetting a password) by anyone else, nobody changes their own role, and the office is never left without
// an active Business Administrator. A DEV account counts as a Business Administrator here, and only a DEV account can
// give out the DEV role or change a DEV account.
const { DEV_ROLE, TOP_ROLE, effectiveRole, isDevRole } = require('./roles');

const EMPLOYEE_ROLES = ['Office Admin', 'Business Administrator', 'Counselor', 'Polygrapher', DEV_ROLE];
const isTop = (role) => effectiveRole(role) === TOP_ROLE;
const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Why the change isn't allowed, or null when it is.
//   actor: the logged-in employee ({ employeeemail, role, isdev }, from the session)
//   target: the account as it is now ({ employeeemail, role, active }), or null for a new account
//   next: what it would become ({ role, active })
//   otherActiveTopRole: how many other active Business Administrator or DEV accounts there are (not counting target)
const accountChangeProblem = ({ actor, target, next, otherActiveTopRole }) => {
    const role = String(next.role || '').trim();
    if (!EMPLOYEE_ROLES.includes(role)) return `Role must be one of: ${EMPLOYEE_ROLES.join(', ')}.`;
    const actorIsDev = actor?.isdev === true || isDevRole(actor?.role);
    if (!actorIsDev) {
        if (isDevRole(target?.role)) return 'Only a DEV account can change a DEV account.';
        if (isDevRole(role)) return 'Only a DEV account can give an account the DEV role.';
    }
    if (!actorIsDev && !isTop(actor?.role)) {
        if (target?.role === TOP_ROLE) return 'Only a Business Administrator can change a Business Administrator account.';
        if (role === TOP_ROLE) return 'Only a Business Administrator can give an account the Business Administrator role.';
    }
    if (target && sameEmail(target.employeeemail, actor?.employeeemail)) {
        if (role !== target.role) return 'You cannot change your own role. Ask another Business Administrator.';
        if (next.active === false) return 'You cannot deactivate your own account.';
    }
    // The office must always have someone who can do the Business-Administrator-only work
    const wasActiveTop = isTop(target?.role) && target.active !== false;
    const staysActiveTop = isTop(role) && next.active !== false;
    if (wasActiveTop && !staysActiveTop && !(otherActiveTopRole > 0)) {
        return 'This is the only active Business Administrator account. Make another account a Business Administrator first.';
    }
    return null;
};

module.exports = { EMPLOYEE_ROLES, accountChangeProblem };
