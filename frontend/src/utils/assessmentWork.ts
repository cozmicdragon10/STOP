// Assessments being worked on. Mirrors backend/lib/assessmentWork.js (the server applies the same rules).

// Roles that see and work on every assessment (a DEV account signs in as a Business Administrator)
export const ASSESSMENT_ADMIN_ROLES = ['Business Administrator', 'Office Admin'];
// Roles that add notes to an assessment and complete it
export const ASSESSMENT_WORK_ROLES = ['Counselor', ...ASSESSMENT_ADMIN_ROLES];
// Kinds that need a second box checked to complete
export const PAPERWORK_KINDS = ['BIP Intake', 'BIP Reinstate'];
export const NOTE_MAX = 4000;
// An assessment open longer than this many days is flagged on the In Progress list
export const LONG_OPEN_DAYS = 30;

const cents = (n: number) => Math.round(n * 100) / 100;
const sameName = (a?: string | null, b?: string | null) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Admins work on every assessment; a counselor on the ones they are the counselor on
export const worksOnAssessment = (viewer: { role?: string; displayname?: string } | null | undefined, row: { provider?: string | null }) => {
  if (!viewer?.role || !ASSESSMENT_WORK_ROLES.includes(viewer.role)) return false;
  if (ASSESSMENT_ADMIN_ROLES.includes(viewer.role)) return true;
  return !!viewer.displayname && sameName(row.provider, viewer.displayname);
};

// What has to be paid to begin: the fee and any past due balance (stored sign: positive = owes), less any credit
export const amountDueToBegin = (balance: number | string | null | undefined, fee: number) => Math.max(0, cents(Number(balance || 0) + (Number.isFinite(fee) ? fee : 0)));

export const paperworkLabel = (kind?: string | null) => (kind === 'BIP Reinstate' ? 'BIP Reinstatement Contract signed' : 'Intake paperwork completed');

// "Begun today", "Open 1 day", "Open 12 days"
export const daysOpenText = (days: number) => (days <= 0 ? 'Begun today' : days === 1 ? 'Open 1 day' : `Open ${days} days`);
