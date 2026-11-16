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

// Where the assessment is held: required when a time is opened, scheduled or changed (times from before locations were
// added have none, and can still be assigned)
const LOCATION_MAX = 150;
const locationProblem = (location) => {
    const place = String(location ?? '').trim();
    if (!place) return 'Enter the location.';
    if (place.length > LOCATION_MAX) return `Keep the location under ${LOCATION_MAX} characters.`;
    return null;
};

// Rescheduling a client's assessment moves them into one of the same counselor's open times (from today on); their old
// time opens up again. The first problem with that move, or null.
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const moveProblem = ({ from, to, today }) => {
    if (!from || from.status !== 'Scheduled') return 'Only an assessment with a client can be rescheduled.';
    if (!to || to.status !== 'Open') return 'Choose one of the open times. That time already has a client or was cancelled.';
    if (String(from.appointmentid) === String(to.appointmentid)) return 'Choose a different time.';
    if (!sameName(from.assessor, to.assessor)) return `Choose one of ${from.assessor}'s open times.`;
    if (to.apptdate < today) return 'That open time has already passed.';
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

module.exports = { slotProblem, appointmentProblem, locationProblem, moveProblem, ownsSlot, repeatDates, REPEATS, MAX_REPEATS };
