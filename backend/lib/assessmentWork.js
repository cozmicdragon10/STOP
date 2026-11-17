// Rules for an assessment being worked on (routes/sessions.js). An assessment is scheduled (an open session), then begun:
// the payment for its fee and any past due balance is taken first, and the attendance is recorded on the begin date, In
// Progress. The counselor adds notes while it stays open (days or weeks: more sessions, waiting on results or other
// providers), then completes it. There is no refund once it is begun. Mirrors frontend/src/utils/assessmentWork.ts.

// Roles (as the session reads them: a DEV account is a Business Administrator) that see and work on every assessment
const ASSESSMENT_ADMIN_ROLES = ['Business Administrator', 'Office Admin'];
// Roles that add notes to an assessment and complete it
const ASSESSMENT_WORK_ROLES = ['Counselor', ...ASSESSMENT_ADMIN_ROLES];
// Kinds of assessment that need a second box checked to complete: intake paperwork, or the reinstatement contract
const PAPERWORK_KINDS = ['BIP Intake', 'BIP Reinstate'];

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const cents = (n) => Math.round(Number(n || 0) * 100) / 100;

// Admins work on every assessment; a counselor on the ones they are the counselor (Provider) on
const worksOnAssessment = (viewer, row) => {
    if (!viewer || !ASSESSMENT_WORK_ROLES.includes(viewer.role)) return false;
    if (ASSESSMENT_ADMIN_ROLES.includes(viewer.role)) return true;
    return !!viewer.displayname && sameName(row?.provider, viewer.displayname);
};

// What has to be paid to begin: the fee and any past due balance (stored sign: positive = owes), less any credit
const amountDueToBegin = (balance, fee) => Math.max(0, cents(Number(balance || 0) + Number(fee || 0)));

// Why the payment can't begin the assessment, or null
const beginPaymentProblem = ({ balance, fee, payment, paymentConfirmed, clientName = 'The client', typeName = 'assessment' }) => {
    const due = amountDueToBegin(balance, fee);
    if (cents(payment) + 0.005 < due) {
        return `${clientName} needs to pay $${due.toFixed(2)} (the ${typeName}${Number(balance || 0) > 0 ? ' and the past due balance' : ''}) before the assessment can begin.`;
    }
    if (paymentConfirmed !== true) return 'Check off that the payment was received.';
    return null;
};

const paperworkLabel = (kind) => (kind === 'BIP Reinstate' ? 'BIP Reinstatement Contract signed' : 'Intake paperwork completed');

// Why the assessment can't be completed, or null
const completeProblem = ({ kind, paperworkCompleted }) => {
    if (PAPERWORK_KINDS.includes(kind) && paperworkCompleted !== true) {
        return kind === 'BIP Reinstate' ? 'Check off that the BIP Reinstatement Contract is signed.' : 'Check off that the intake paperwork is completed.';
    }
    return null;
};

const NOTE_MAX = 4000;
const noteProblem = (text) => {
    const t = String(text || '').trim();
    if (!t) return 'Type the note first.';
    if (t.length > NOTE_MAX) return `Notes can be up to ${NOTE_MAX} characters.`;
    return null;
};

module.exports = {
    ASSESSMENT_ADMIN_ROLES, ASSESSMENT_WORK_ROLES, PAPERWORK_KINDS, NOTE_MAX,
    worksOnAssessment, amountDueToBegin, beginPaymentProblem, paperworkLabel, completeProblem, noteProblem,
};
