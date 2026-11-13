// The DEV role: a developer account. It can do everything a Business Administrator can, and also sees the DEV menu.
// The server's role checks compare against 'Business Administrator', so a DEV account's role is read through
// effectiveRole wherever it is checked; isDev (from the account's stored role) opens the DEV menu and its routes.
const DEV_ROLE = 'DEV';
const TOP_ROLE = 'Business Administrator';

const isDevRole = (role) => role === DEV_ROLE;
const effectiveRole = (role) => (isDevRole(role) ? TOP_ROLE : role ?? null);

module.exports = { DEV_ROLE, TOP_ROLE, isDevRole, effectiveRole };
