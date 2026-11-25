// Group schedules ("Thursdays @ 5:00 PM") and the rules for cancelling or rescheduling one meeting from My Day (upcoming,
// or a past one that was never opened; the server refuses one that has a check-in).
// parseSchedule mirrors frontend/src/utils/schedule.ts (backend/test/sharedRules.test.js checks they match).
const { YMD } = require('./sql');

const SCHEDULE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const CHANGE_ACTIONS = ['Cancelled', 'Rescheduled'];
// Office roles change any group's meetings; a counselor only the groups they lead
const SCHEDULE_ADMIN_ROLES = ['Business Administrator', 'Office Admin'];

// { day: 'Thursday', time: '5:00 PM' }, or blanks when the schedule isn't a weekly day and time (say, By Appointment)
const parseSchedule = (value) => {
    const match = /^\s*([A-Za-z]+?)s?\s*@\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(value || '');
    const day = SCHEDULE_DAYS.find(d => match && d.toLowerCase() === match[1].toLowerCase()) || '';
    const time = match && day ? `${parseInt(match[2], 10)}:${match[3]} ${match[4].toUpperCase()}` : '';
    return { day, time };
};

const weekdayOf = (ymd) => WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
// '5:00 PM' -> '17:00'
const to24h = (time) => {
    const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time || '');
    if (!match) return '';
    const hours = (Number(match[1]) % 12) + (match[3] === 'PM' ? 12 : 0);
    return `${String(hours).padStart(2, '0')}:${match[2]}`;
};
// '17:00' -> '5:00 PM'
const to12h = (time) => {
    const [h, m] = String(time || '').split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
// '2026-12-03' -> 'Thursday, December 3, 2026'
const longDate = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return `${weekdayOf(ymd)}, ${MONTHS[m - 1]} ${d}, ${y}`;
};

const canChangeGroup = (user, groupCounselor) => {
    if (SCHEDULE_ADMIN_ROLES.includes(user?.role)) return true;
    const mine = String(user?.displayname || '').trim().toLowerCase();
    return user?.role === 'Counselor' && mine !== '' && mine === String(groupCounselor || '').trim().toLowerCase();
};

// The first problem with cancelling or rescheduling the meeting on originalDate (past or upcoming), or null. An upcoming
// meeting moves to today or later; a past one to any date. schedule is the group's schedule text; today is YYYY-MM-DD
// (local).
const changeProblem = ({ action, originalDate, newDate, newTime, schedule, today }) => {
    if (!CHANGE_ACTIONS.includes(action)) return 'Choose Cancel or Reschedule.';
    const { day, time } = parseSchedule(schedule);
    if (!day) return 'This group has no weekly day and time, so it has no upcoming meetings to change.';
    if (!YMD.test(String(originalDate || ''))) return 'Choose the meeting date.';
    if (weekdayOf(originalDate) !== day) return `This group meets on ${day}s, not on ${longDate(originalDate)}.`;
    if (action === 'Cancelled') return null;
    if (!YMD.test(String(newDate || ''))) return 'Enter the new date.';
    // A past meeting can be moved to any date (say, the day it was really held); an upcoming one only to today or later
    if (originalDate >= today && newDate < today) return 'The new date must be today or later.';
    if (!HHMM.test(String(newTime || ''))) return 'Enter the new time.';
    if (newDate === originalDate && newTime === to24h(time)) return 'Pick a different date or time to reschedule to.';
    return null;
};

// The case note each client in the group gets
const changeNoteText = ({ action, groupName, originalDate, scheduleTime, newDate, newTime, reason }) => {
    const meeting = `${groupName} on ${longDate(originalDate)}${scheduleTime ? ` at ${scheduleTime}` : ''}`;
    const what = action === 'Cancelled'
        ? `${meeting} was cancelled.`
        : `${meeting} was rescheduled to ${longDate(newDate)} at ${to12h(newTime)}.`;
    const why = String(reason || '').trim();
    return why ? `${what} Reason: ${why}` : what;
};

// Weeks run Sunday to Saturday (like the calendars and the BIP once-a-week rule). The Sunday of a date's week, and the
// day in that week the group meets by its schedule ('' when the schedule has no weekly day).
const addDays = (ymd, days) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};
const weekStartOf = (ymd) => addDays(ymd, -WEEKDAYS.indexOf(weekdayOf(ymd)));
const scheduledDayInWeek = (schedule, ymd) => {
    const { day } = parseSchedule(schedule);
    return day ? addDays(weekStartOf(ymd), WEEKDAYS.indexOf(day)) : '';
};

// Opening a group on date when it isn't its regular day: whether to offer moving that week's meeting there (a Group
// Reschedule note for each client). Offered only when the week's regular meeting hasn't been held, opened, cancelled or
// moved yet, the group has no other session that week, and the user can change the group's meetings. scheduledDate is
// '' when the date is the regular day or the group has no weekly day.
const offDayCheck = ({ schedule, date, today, canChange, alreadyChanged, sessionThisWeek }) => {
    const scheduledDate = scheduledDayInWeek(schedule, date);
    if (!scheduledDate || scheduledDate === date) return { offDay: false };
    const newTime = to24h(parseSchedule(schedule).time);
    const offer = canChange && !alreadyChanged && !sessionThisWeek
        && !changeProblem({ action: 'Rescheduled', originalDate: scheduledDate, newDate: date, newTime, schedule, today });
    return { offDay: true, scheduledDate, newTime, offer };
};

module.exports = {
    SCHEDULE_DAYS, CHANGE_ACTIONS, parseSchedule, weekdayOf, to24h, to12h, longDate, canChangeGroup, changeProblem, changeNoteText,
    weekStartOf, scheduledDayInWeek, offDayCheck,
};
