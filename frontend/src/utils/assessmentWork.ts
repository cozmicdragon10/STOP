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

// A Business Administrator can begin an assessment without paying its fee up front when one of these will pay for it:
// the fee is still charged to the client's account, and only a past due balance has to be paid first
export const FUNDING_SOURCES = ['DHS Voucher', 'Invoice'] as const;
export type FundingSource = typeof FUNDING_SOURCES[number];
export const FUNDING_ROLE = 'Business Administrator';

// What has to be paid to begin: the fee and any past due balance (stored sign: positive = owes), less any credit.
// With a funding source the fee goes on the account unpaid, so only the past due balance is due. maxOwed: a Max Debt Override lets
// the client begin owing up to that much afterwards.
export const amountDueToBegin = (balance: number | string | null | undefined, fee: number, fundedBy: string | null = null, maxOwed: number | string | null | undefined = 0) =>
  Math.max(0, cents(Number(balance || 0) + (fundedBy || !Number.isFinite(fee) ? 0 : fee) - Math.max(0, Number(maxOwed) || 0)));

export const paperworkLabel = (kind?: string | null) => (kind === 'BIP Reinstate' ? 'BIP Reinstatement Contract signed' : 'Intake paperwork completed');

// "Begun today", "Open 1 day", "Open 12 days"
export const daysOpenText = (days: number) => (days <= 0 ? 'Begun today' : days === 1 ? 'Open 1 day' : `Open ${days} days`);
