// BIP absences. A BIP client may miss their primary group's meetings, with these limits:
// - 2 in a row is allowed. The 3rd in a row is a threshold: one week from that absence to make it up.
// - 6 open absences is the most allowed. The 7th open absence is a threshold: one week from that absence to make it up.
// A make-up is a group check-in at a group other than the primary one, within a week of the absence. An absence that's
// made up is no longer open, so it breaks the streak and stops counting toward the total. An absence a Business
// Administrator excused (BipAbsenceExcuses, by week) isn't counted at all.
// While a threshold is open the client is locked from checking in to their primary group (other groups still allow
// make-ups). If its week passes with no make-up, the client is locked out of every group and is eligible for Program
// Failed (staff confirm that).
// The absences come from lib/missedGroups.js, looking only at the primary group's meetings: a check-in at another group
// doesn't cover the week here, since that's the make-up.

const { findMissedGroups, weekOf } = require('./missedGroups');
const { todayLocal } = require('./dates');
const { logClientChange } = require('./changeLog');

const STREAK_LIMIT = 3;   // the 3rd absence in a row
const TOTAL_LIMIT = 7;    // the 7th open absence
const MAKEUP_DAYS = 7;
// The rules start on this date: absences before it don't count, so no one is locked or failed for older history (the
// Attendance tab still lists those misses). Chosen 2026-11-25, the day the rules went in.
const COUNT_FROM = '2026-11-25';

const ymd = (v) => String(v ?? '').slice(0, 10);
const addDays = (day, days) => {
    const [y, m, d] = ymd(day).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * Pure: the client's BIP absence state as of `today`.
 * @param {object} p
 * @param {number|null} p.primaryGroup  Clients.GroupId
 * @param {{group: number|null, date: string, type: string}[]} p.attendance  all of the client's attendance
 * @param {{group: number, date: string}[]} p.held  closed meetings (any group; only the primary group's are used)
 * @param {{date: string, reason?: string|null}[]} p.callIns
 * @param {string[]} p.excusedWeeks  WeekOf values (YYYY-MM-DD) a Business Administrator excused
 * @param {string} p.currentStatus
 * @param {{date: string, status: string}[]} p.statusChanges
 * @param {string|null} p.assignedOn
 * @param {string|null} p.programStart
 * @param {string} p.today
 */
function bipAbsenceStatus({ primaryGroup, attendance = [], held = [], callIns = [], excusedWeeks = [], currentStatus, statusChanges = [], assignedOn = null, programStart = null, today, countFrom = null }) {
    const excused = new Set(excusedWeeks.map(ymd));
    // Group check-ins at other groups, and any Make-Up row, are make-ups: they don't cover the primary group's week
    const makeUpDates = attendance
        .filter(a => (a.type === 'Group' && a.group !== primaryGroup) || a.type === 'Make-Up')
        .map(a => ymd(a.date));
    const primaryAttendance = attendance.filter(a => a.type !== 'Make-Up' && !(a.type === 'Group' && a.group !== primaryGroup));

    // Oldest first
    const misses = findMissedGroups({
        attendance: primaryAttendance,
        held: held.filter(h => h.group === primaryGroup),
        callIns,
        currentGroup: primaryGroup,
        assignedOn,
        programStart,
        currentStatus,
        statusChanges,
        today,
    }).slice().reverse()
        // Only absences on or after countFrom count (earlier history is shown on the account but never locks or fails anyone)
        .filter(m => !countFrom || ymd(m.date) >= ymd(countFrom));

    const items = misses.map(m => {
        const date = ymd(m.date);
        const week = weekOf(date);
        const deadline = addDays(date, MAKEUP_DAYS);
        const isExcused = excused.has(week);
        const madeUp = makeUpDates.some(d => d >= date && d <= deadline);
        return {
            date, week, calledIn: !!m.calledIn, callInReason: m.callInReason || null,
            excused: isExcused, madeUp, open: !isExcused && !madeUp,
            deadline, threshold: null, failed: false, run: 0,
        };
    });
    const byWeek = new Map(items.map(i => [i.week, i]));

    // Streak: walk the meeting weeks in order; an open absence adds to the run, anything else (attended, made up) ends it.
    // Excused weeks are left out entirely.
    const meetingWeeks = new Set([...byWeek.keys(), ...primaryAttendance
        .filter(a => a.type === 'Group' && a.group === primaryGroup).map(a => weekOf(a.date))]);
    let run = 0;
    for (const week of [...meetingWeeks].sort()) {
        if (excused.has(week)) continue;
        const item = byWeek.get(week);
        if (item && item.open) {
            run += 1;
            item.run = run;
        } else {
            run = 0;
        }
    }

    // Thresholds: a 3rd-in-a-row absence, or an open absence from the 7th on
    const open = items.filter(i => i.open);
    open.forEach((item, index) => {
        if (item.run >= STREAK_LIMIT) item.threshold = 'streak';
        else if (index >= TOTAL_LIMIT - 1) item.threshold = 'total';
        if (item.threshold) item.failed = item.deadline < today;
    });
    const thresholds = items.filter(i => i.threshold);
    const active = currentStatus === 'Active';
    const locked = active && thresholds.length > 0;
    const lockReason = locked ? (thresholds.some(t => t.threshold === 'streak') ? 'streak' : 'total') : null;
    const nextDeadline = locked ? thresholds.map(t => t.deadline).sort()[0] : null;
    // The run at the newest absence, if it's still open (the streak the client is on now)
    const newest = items[items.length - 1];
    const streak = newest && newest.open ? newest.run : 0;

    return {
        locked,
        // Locked from all groups (make-ups too): the week to make up a 3rd-in-a-row or 7th absence passed without one
        fullLock: locked && thresholds.some(t => t.failed),
        lockReason,
        nextDeadline,
        failEligible: locked && thresholds.some(t => t.failed),
        openCount: open.length,
        streak,
        // Newest first, for the account
        absences: items.slice().reverse().map(({ run: _run, ...rest }) => rest),
    };
}

// The lock's message at check-in
const bipAbsenceBlockMessage = (reason, name, deadline, fullLock = false) => (fullLock
    ? `${name} ${reason === 'streak' ? 'missed 3 group meetings in a row' : 'has 7 open absences'} and the week to make one up has passed. They can't check in to any group; a Business Administrator can excuse an absence or discharge them.`
    : reason === 'streak'
    ? `${name} has missed 3 group meetings in a row. Make up the absence at a different group by ${deadline}. Check-in at their primary group is blocked until then.`
    : `${name} has 7 open absences. Make up one at a different group by ${deadline}. Check-in at their primary group is blocked until then.`);

// Loads what bipAbsenceStatus needs for one client from the database, then works it out
async function bipAbsenceStatusFor(db, clientId, today = todayLocal(), { countFrom = COUNT_FROM } = {}) {
    const clientRes = await db.query(
        `SELECT c.GroupId, c.ProgramStatus, c.ProgramType, c.FirstName, c.LastName, to_char(c.ProgramStartDate, 'YYYY-MM-DD') AS ProgramStart, g.GroupName
         FROM Clients c LEFT JOIN Groups g ON g.GroupId = c.GroupId WHERE c.ClientId = $1`,
        [clientId]
    );
    const client = clientRes.rows[0];
    if (!client || client.programtype !== 'BIP' || !client.groupid) {
        return { applies: false, locked: false, fullLock: false, absences: [], openCount: 0, streak: 0, failEligible: false, lockReason: null, nextDeadline: null };
    }
    const [attRes, heldRes, callRes, logRes, excuseRes] = await Promise.all([
        db.query(`SELECT "Group" AS group, to_char(Date, 'YYYY-MM-DD') AS date, Type AS type FROM Attendance WHERE Client = $1`, [clientId]),
        db.query(`SELECT DISTINCT "Group" AS group, to_char(Date, 'YYYY-MM-DD') AS date FROM Attendance WHERE Type = 'Group' AND "Group" = $1`, [client.groupid]),
        db.query(
            `SELECT to_char(COALESCE(CallInDate, Date::date, CreatedOn::date), 'YYYY-MM-DD') AS date, CallInReason AS reason
             FROM EventLog WHERE Client = $1 AND Type IN ('Call-In', 'Group Call-In')`,
            [clientId]
        ),
        db.query(
            `SELECT ChangeType, NewValue, to_char(ChangedOn, 'YYYY-MM-DD') AS date FROM ClientChangeLog
             WHERE ClientId = $1 AND ChangeType IN ('Group', 'Program Status') ORDER BY ChangedOn, ChangeId`,
            [clientId]
        ),
        db.query(`SELECT to_char(WeekOf, 'YYYY-MM-DD') AS week FROM BipAbsenceExcuses WHERE ClientId = $1`, [clientId]),
    ]);
    const assigned = [...logRes.rows].reverse().find(r => r.changetype === 'Group' && r.newvalue === client.groupname);
    const status = bipAbsenceStatus({
        primaryGroup: client.groupid,
        attendance: attRes.rows,
        held: heldRes.rows,
        callIns: callRes.rows,
        excusedWeeks: excuseRes.rows.map(r => r.week),
        currentStatus: client.programstatus,
        statusChanges: logRes.rows.filter(r => r.changetype === 'Program Status').map(r => ({ date: r.date, status: r.newvalue })),
        assignedOn: assigned?.date || null,
        programStart: client.programstart,
        today,
        countFrom,
    });
    return { applies: true, clientName: `${client.lastname}, ${client.firstname}`, groupId: client.groupid, groupName: client.groupname, ...status };
}

// Records an excuse for the week of an absence (Business Administrators and DEV). The absence must be one this client has.
async function excuseAbsence(db, { clientId, date, reason, excusedBy, today = todayLocal() }) {
    const text = String(reason || '').trim();
    if (!text) throw Object.assign(new Error('Enter the reason for the excuse.'), { status: 400 });
    const state = await bipAbsenceStatusFor(db, clientId, today);
    if (!state.applies) throw Object.assign(new Error('Absences are only tracked for BIP clients with a primary group.'), { status: 400 });
    const week = weekOf(ymd(date));
    const absence = state.absences.find(a => a.week === week);
    if (!absence) throw Object.assign(new Error('No missed group meeting that week to excuse.'), { status: 400 });
    if (absence.excused) throw Object.assign(new Error('That absence is already excused.'), { status: 400 });
    await db.query(
        `INSERT INTO BipAbsenceExcuses (ClientId, WeekOf, Reason, ExcusedBy) VALUES ($1, $2, $3, $4)`,
        [clientId, week, text, excusedBy]
    );
    await logClientChange(db, { clientId, changedBy: excusedBy, changeType: 'Absence Excused', newValue: absence.date, details: `Absence on ${absence.date} excused: ${text}` });
    return { week, absenceDate: absence.date };
}

module.exports = { bipAbsenceStatus, bipAbsenceStatusFor, bipAbsenceBlockMessage, excuseAbsence, STREAK_LIMIT, TOTAL_LIMIT, MAKEUP_DAYS };
