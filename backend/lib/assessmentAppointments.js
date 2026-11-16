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

// How a new time can repeat: weekdays (Monday to Friday), weekly, or every 2 weeks, up to an end date
const REPEATS = ['none', 'weekdays', 'weekly', 'biweekly'];
const MAX_REPEATS = 100;
const STEP_DAYS = { weekdays: 1, weekly: 7, biweekly: 14 };
const addDays = (ymd, days) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};
const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

// The dates a new time falls on, from start through until: { dates } or { error }. No repeat gives just the start date.
const repeatDates = (start, repeat, until) => {
    if (!repeat || repeat === 'none') return { dates: [start] };
    if (!REPEATS.includes(repeat)) return { error: 'Choose how often it repeats.' };
    if (!YMD.test(String(until || ''))) return { error: 'Enter the date the repeats end.' };
    if (until < start) return { error: 'The repeat end date is before the first date.' };
    const dates = [];
    for (let d = start; d <= until; d = addDays(d, STEP_DAYS[repeat])) {
        if (repeat === 'weekdays' && (weekday(d) === 0 || weekday(d) === 6)) continue;
        dates.push(d);
        if (dates.length > MAX_REPEATS) return { error: `That repeats more than ${MAX_REPEATS} times. Pick an earlier end date.` };
    }
    if (!dates.length) return { error: 'No weekdays fall between those dates.' };
    return { dates };
};

module.exports = { slotProblem, appointmentProblem, ownsSlot, repeatDates, REPEATS, MAX_REPEATS };
