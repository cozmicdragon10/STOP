// Rules for the Assessments calendar. Pure, so the route and the tests share them.
const { YMD } = require('./sql');

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// The first problem with an assessment time (open or with a client), or null. today is YYYY-MM-DD (local). Times are
// for today or a later date, and the assessor must be an active counselor.
const slotProblem = ({ date, time, today, assessorActive }) => {
    if (!YMD.test(String(date || ''))) return 'Enter the assessment date.';
    if (date < today) return 'An assessment can only be scheduled for today or a later date.';
    if (!HHMM.test(String(time || ''))) return 'Enter the assessment time.';
    if (!assessorActive) return 'Choose an active counselor as the assessor.';
    return null;
};

// A time with a client in it: the client must be active too
const appointmentProblem = (args) => {
    const problem = slotProblem(args);
    if (problem) return problem;
    if (!args.clientActive) return 'Only active clients can be scheduled for an assessment.';
    return null;
};

// A counselor only opens and changes their own times; Office and Business Administrators change any
const ownsSlot = (user, assessor) => user?.role !== 'Counselor' || String(user.displayname || '').trim() === String(assessor || '').trim();

module.exports = { slotProblem, appointmentProblem, ownsSlot };
