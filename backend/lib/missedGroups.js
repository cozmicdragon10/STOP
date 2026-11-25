// Missed groups: the group meetings a client was expected at and didn't check in to, for the client's Attendance tab.
//
// There is no roster history before the change log started, so who was expected at a meeting is worked out from what
// the database does have:
// - Each group the client has checked in to: they were in it from their first check-in there to their last.
// - Their current group: from when they were put in it (the change log), or their first check-in there, or (never
//   checked in) their program start date; through today while they are Active.
// - Weeks after a logged status change away from Active (and until a change back) don't count.
// A meeting counts as held when anyone was checked in to it (a closed session). Groups meet weekly, so any group,
// Make-Up, Holiday, or Closure attendance in the same week (Sunday to Saturday, like the calendars) covers the meeting: a make-up at another
// group isn't a miss. A call-in doesn't cover it; the miss is marked as called in instead.

// Attendance types that cover a week's group meeting. Individual sessions and assessments don't stand in for a group.
const COVERING_TYPES = new Set(['Group', 'Make-Up', 'Holiday', 'Closure']);

const ymd = (v) => String(v ?? '').slice(0, 10);

// The Sunday of the week a YYYY-MM-DD date falls in, as YYYY-MM-DD
const weekOf = (day) => {
    const [y, m, d] = ymd(day).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() - t.getUTCDay());
    return t.toISOString().slice(0, 10);
};

// A YYYY-MM-DD date some months later; the 31st becomes the month's last day when the month is shorter
const addMonths = (day, months) => {
    const [y, m, d] = ymd(day).split('-').map(Number);
    const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
};

const addDays = (day, days) => {
    const [y, m, d] = ymd(day).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

// Phase 2 clients come to group once a month, Phase 3 once a quarter, Phase 4 every six months; null means weekly
const PHASE_EVERY_MONTHS = { 'Phase 2 - Monthly': 1, 'Phase 3 - Quarterly': 3, 'Phase 4 - Semi Anual': 6 };
const phaseEveryMonths = (phase) => PHASE_EVERY_MONTHS[phase] || null;

// Whether the status log says the client was not Active on a day. Before the first logged change nothing is known, so
// the day isn't excluded (the check-ins themselves show when they were coming).
const notActiveOn = (day, statusChanges) => {
    let status = null;
    for (const c of statusChanges) {
        if (ymd(c.date) <= day) status = c.status;
        else break;
    }
    return status !== null && status !== 'Active';
};

/**
 * @param {object} p
 * @param {{group: number|null, date: string, type: string}[]} p.attendance  the client's attendance (any type)
 * @param {{group: number, date: string}[]} p.held  closed group meetings of the groups involved
 * @param {{date: string, reason?: string|null}[]} p.callIns  the client's own call-ins, by the date they were for
 * @param {number|null} p.currentGroup  Clients.GroupId
 * @param {string|null} p.assignedOn  when the client was last put in their current group (change log), if known
 * @param {string|null} p.programStart
 * @param {string} p.currentStatus
 * @param {{date: string, status: string}[]} p.statusChanges  logged Program Status changes (new status), oldest first
 * @param {string} p.today  YYYY-MM-DD
 * @param {number|null} [p.everyMonths]  Phase 2/3/4 clients come once a month / quarter / half year (phaseEveryMonths)
 * @param {string|null} [p.phaseSince]  when they moved into that phase (change log); unknown means the whole history
 * @returns {{group: number, date: string, calledIn: boolean, callInReason: string|null, everyMonths?: number}[]} newest
 *   first; a miss with everyMonths is a month / quarter / half year that went by with no group check-in, dated when it ran out
 */
function findMissedGroups({ attendance, held, callIns = [], currentGroup, assignedOn, programStart, currentStatus, statusChanges = [], today, everyMonths = null, phaseSince = null }) {
    const since = everyMonths && phaseSince ? ymd(phaseSince) : null;
    // Weeks from when the client moved to a monthly/quarterly/semi-annual phase are counted by period instead
    const periodic = (day) => !!everyMonths && (!since || day >= since);
    const changes = [...statusChanges].map(c => ({ ...c, date: ymd(c.date) })).sort((a, b) => a.date.localeCompare(b.date));

    // When the client was expected in each group: [start, end]
    const stretches = new Map();
    for (const a of attendance) {
        if (a.type !== 'Group' || !a.group) continue;
        const day = ymd(a.date);
        const s = stretches.get(a.group);
        if (!s) stretches.set(a.group, { start: day, end: day });
        else {
            if (day < s.start) s.start = day;
            if (day > s.end) s.end = day;
        }
    }
    if (currentGroup) {
        const attended = stretches.get(currentGroup);
        const assigned = assignedOn ? ymd(assignedOn) : null;
        let start = attended?.start || assigned || (programStart ? ymd(programStart) : null);
        if (attended && assigned && assigned < start) start = assigned;
        let end = attended?.end || null;
        if (currentStatus === 'Active') end = today;
        else {
            // Stopped coming before being taken off Active: the weeks up to the status change count
            const left = [...changes].reverse().find(c => c.status !== 'Active');
            if (left && (!end || left.date > end)) end = left.date;
        }
        if (start && end && start <= end) stretches.set(currentGroup, { start, end: end > today ? today : end });
        else if (!attended) stretches.delete(currentGroup);
    }

    const coveredWeeks = new Set(attendance.filter(a => COVERING_TYPES.has(a.type)).map(a => weekOf(a.date)));
    const callInByWeek = new Map();
    for (const c of callIns) {
        const week = weekOf(c.date);
        if (!callInByWeek.has(week)) callInByWeek.set(week, c.reason || null);
    }
    for (const a of attendance) {
        if (a.type === 'Call-In' && !callInByWeek.has(weekOf(a.date))) callInByWeek.set(weekOf(a.date), null);
    }

    const seen = new Set();
    const missed = [];
    for (const h of held) {
        const day = ymd(h.date);
        const s = stretches.get(h.group);
        if (!s || day < s.start || day > s.end || periodic(day)) continue;
        const key = `${h.group}|${day}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (notActiveOn(day, changes)) continue;
        const week = weekOf(day);
        if (coveredWeeks.has(week)) continue;
        const calledIn = callInByWeek.has(week);
        missed.push({ group: h.group, week, date: day, calledIn, callInReason: calledIn ? callInByWeek.get(week) : null });
    }

    // While moving between groups two groups' stretches can overlap; a missed week counts once, for the group the client
    // last checked in to before it (or their current group)
    const groupChecks = attendance.filter(a => a.type === 'Group' && a.group).map(a => ({ group: a.group, date: ymd(a.date) }))
        .sort((a, b) => a.date.localeCompare(b.date));
    const groupBefore = (day) => {
        let g = null;
        for (const a of groupChecks) {
            if (a.date <= day) g = a.group;
            else break;
        }
        return g;
    };
    const byWeek = new Map();
    for (const m of missed) {
        const kept = byWeek.get(m.week);
        if (!kept) { byWeek.set(m.week, m); continue; }
        const preferred = groupBefore(m.date) ?? currentGroup;
        if (m.group === preferred && kept.group !== preferred) byWeek.set(m.week, m);
    }
    const result = [...byWeek.values()].map(({ week: _week, ...m }) => m);

    // Monthly / quarterly / semi-annual clients: each calendar month, quarter (Jan-Mar, ...) or half year (Jan-Jun,
    // Jul-Dec) that ended with no group check-in in it is one miss, dated its last day
    const current = currentGroup ? stretches.get(currentGroup) : null;
    if (everyMonths && current) {
        const checks = attendance.filter(a => COVERING_TYPES.has(a.type)).map(a => ymd(a.date));
        const start = since && since > current.start ? since : current.start;
        const [sy, sm] = start.split('-').map(Number);
        // The period the start falls in
        let periodStart = `${sy}-${String(Math.floor((sm - 1) / everyMonths) * everyMonths + 1).padStart(2, '0')}-01`;
        for (;;) {
            const next = addMonths(periodStart, everyMonths);
            const periodEnd = addDays(next, -1);
            // Only periods that are over, and not past when the client left the group
            if (periodEnd >= today || periodEnd > current.end) break;
            if (!checks.some(d => d >= periodStart && d <= periodEnd) && !notActiveOn(periodEnd, changes)) {
                const call = callIns.find(c => ymd(c.date) >= periodStart && ymd(c.date) <= periodEnd);
                result.push({ group: currentGroup, date: periodEnd, calledIn: !!call, callInReason: call?.reason || null, everyMonths });
            }
            periodStart = next;
        }
    }
    return result.sort((a, b) => b.date.localeCompare(a.date) || a.group - b.group);
}

module.exports = { findMissedGroups, weekOf, addMonths, phaseEveryMonths, COVERING_TYPES };
