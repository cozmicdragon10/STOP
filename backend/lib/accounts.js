// Rules for changing an employee account. The account routes are for Business Administrators only (routes/admin.js), as
// on the Admin tab; these rules also hold on their own, so the Business Administrator role can't be handed out or taken
// over (by resetting a password) by anyone else, nobody changes their own role, and the office is never left without
// an active Business Administrator.
const EMPLOYEE_ROLES = ['Office Admin', 'Business Administrator', 'Counselor', 'Polygrapher'];
const TOP_ROLE = 'Business Administrator';
const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Why the change isn't allowed, or null when it is.
//   actor: the logged-in employee ({ employeeemail, role }, from the session)
//   target: the account as it is now ({ employeeemail, role, active }), or null for a new account
//   next: what it would become ({ role, active })
//   otherActiveTopRole: how many other active Business Administrators there are (not counting target)
const accountChangeProblem = ({ actor, target, next, otherActiveTopRole }) => {
    const role = String(next.role || '').trim();
    if (!EMPLOYEE_ROLES.includes(role)) return `Role must be one of: ${EMPLOYEE_ROLES.join(', ')}.`;
    const actorIsTop = actor?.role === TOP_ROLE;
    if (!actorIsTop) {
        if (target?.role === TOP_ROLE) return 'Only a Business Administrator can change a Business Administrator account.';
        if (role === TOP_ROLE) return 'Only a Business Administrator can give an account the Business Administrator role.';
    }
    if (target && sameEmail(target.employeeemail, actor?.employeeemail)) {
        if (role !== target.role) return 'You cannot change your own role. Ask another Business Administrator.';
        if (next.active === false) return 'You cannot deactivate your own account.';
    }
    // The office must always have someone who can do the Business-Administrator-only work
    const wasActiveTop = target?.role === TOP_ROLE && target.active !== false;
    const staysActiveTop = role === TOP_ROLE && next.active !== false;
    if (wasActiveTop && !staysActiveTop && !(otherActiveTopRole > 0)) {
        return 'This is the only active Business Administrator account. Make another account a Business Administrator first.';
    }
    return null;
};

module.exports = { EMPLOYEE_ROLES, accountChangeProblem };
