const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bipAbsenceStatus } = require('../lib/bipAbsences');

// Group 1 (the primary group) meets every Tuesday, Oct 6 to Nov 17 2026
const tuesdays = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10', '2026-11-17'];
const held = tuesdays.map(date => ({ group: 1, date }));
const base = {
    primaryGroup: 1, held, callIns: [], excusedWeeks: [], currentStatus: 'Active', statusChanges: [],
    assignedOn: null, programStart: '2026-10-01', today: '2026-11-05', attendance: [],
};
// Attended the primary group on these dates
const attended = (...dates) => dates.map(date => ({ group: 1, date, type: 'Group' }));
// A make-up: a check-in at another group
const makeUp = (date, group = 2) => ({ group, date, type: 'Group' });

test('two absences in a row is allowed', () => {
    const s = bipAbsenceStatus({ ...base, attendance: attended('2026-10-06', '2026-10-13'), today: '2026-10-27' });
    assert.equal(s.locked, false);
    assert.equal(s.openCount, 2);
    assert.equal(s.streak, 2);
});

test('the 3rd absence in a row locks check-in at the primary group, with a week to make it up', () => {
    // Misses 10-20, 10-27, 11-03
    const s = bipAbsenceStatus({ ...base, attendance: attended('2026-10-06', '2026-10-13') });
    assert.equal(s.locked, true);
    assert.equal(s.lockReason, 'streak');
    assert.equal(s.nextDeadline, '2026-11-10');
    assert.equal(s.streak, 3);
    assert.equal(s.failEligible, false);
});

test('a make-up at another group within a week clears the absence and the lock', () => {
    const s = bipAbsenceStatus({ ...base, attendance: [...attended('2026-10-06', '2026-10-13'), makeUp('2026-11-04')] });
    assert.equal(s.locked, false);
    assert.equal(s.openCount, 2);
});

test('a make-up after the week has passed does not clear it, and the client is eligible for Program Failed', () => {
    const s = bipAbsenceStatus({ ...base, today: '2026-11-19', attendance: [...attended('2026-10-06', '2026-10-13'), makeUp('2026-11-12')] });
    assert.equal(s.locked, true);
    assert.equal(s.failEligible, true);
    // A missed 3-in-a-row deadline still only locks the primary group
    assert.equal(s.fullLock, false);
});

test('a check-in at another group in the same week does not cover the primary group meeting', () => {
    // Attended group 2 on the 10-20 week, but not group 1: that meeting is missed, then made up by that same check-in
    const s = bipAbsenceStatus({ ...base, attendance: [...attended('2026-10-06', '2026-10-13'), makeUp('2026-10-20')] });
    const oct20 = s.absences.find(a => a.date === '2026-10-20');
    assert.ok(oct20, 'the miss is still there');
    assert.equal(oct20.madeUp, true);
    assert.equal(s.openCount, 2);
});

test('an excused week is not counted, and does not break or add to the streak', () => {
    // Misses 10-20, 10-27 (excused), 11-03, 11-10: the run is 10-20, 11-03, 11-10 = 3 in a row
    const s = bipAbsenceStatus({
        ...base, today: '2026-11-11', excusedWeeks: ['2026-10-25'], attendance: attended('2026-10-06', '2026-10-13'),
    });
    assert.equal(s.locked, true);
    assert.equal(s.lockReason, 'streak');
    assert.equal(s.nextDeadline, '2026-11-17');
    assert.equal(s.absences.find(a => a.date === '2026-10-27').excused, true);
});

test('a made-up absence breaks the streak', () => {
    // 10-20 open, 10-27 made up, 11-03 open: no run of 3
    const s = bipAbsenceStatus({ ...base, attendance: [...attended('2026-10-06', '2026-10-13'), makeUp('2026-10-29')] });
    assert.equal(s.locked, false);
    assert.equal(s.streak, 1);
});

test('six open absences are allowed; the 7th locks the client (total limit)', () => {
    // Alternate weeks: attend every other meeting, so no two misses are in a row
    const weeks = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 8, 1 + 7 * i));
        return d.toISOString().slice(0, 10);
    });
    const alternating = weeks.map(date => ({ group: 1, date }));
    // Attended the even weeks (the first is Sept 1, where the count starts), missed the odd ones
    const attendedEveryOther = weeks.filter((_, i) => i % 2 === 0).map(date => ({ group: 1, date, type: 'Group' }));
    const common = { ...base, primaryGroup: 1, held: alternating, programStart: '2026-08-01', attendance: attendedEveryOther };

    // Misses Sept 8 through Nov 17 are six; the seventh is Dec 1
    const six = bipAbsenceStatus({ ...common, today: '2026-11-23' });
    assert.equal(six.openCount, 6);
    assert.equal(six.locked, false);

    const seven = bipAbsenceStatus({ ...common, today: '2026-12-02' });
    assert.equal(seven.openCount, 7);
    assert.equal(seven.locked, true);
    assert.equal(seven.lockReason, 'total');
    // Still inside the week to make it up: only the primary group is locked
    assert.equal(seven.fullLock, false);

    // The 7th absence (Dec 1) had until Dec 8; after that every group is locked
    const lapsed = bipAbsenceStatus({ ...common, held: alternating.filter(h => h.date <= '2026-12-01'), today: '2026-12-09' });
    assert.equal(lapsed.fullLock, true);
    assert.equal(lapsed.failEligible, true);
    // A make-up within the week would have cleared it
    const madeUp = bipAbsenceStatus({ ...common, held: alternating.filter(h => h.date <= '2026-12-01'), today: '2026-12-09',
        attendance: [...attendedEveryOther, { group: 2, date: '2026-12-03', type: 'Group' }] });
    assert.equal(madeUp.fullLock, false);
    assert.equal(madeUp.locked, false);
});

test('absences before the rules start date do not count', () => {
    // Misses 10-20, 10-27, 11-03 would lock; counting from 10-27 leaves two in a row
    const s = bipAbsenceStatus({ ...base, countFrom: '2026-10-27', attendance: attended('2026-10-06', '2026-10-13') });
    assert.equal(s.locked, false);
    assert.equal(s.openCount, 2);
    assert.deepEqual(s.absences.map(a => a.date), ['2026-11-03', '2026-10-27']);
});

test('a client who is not Active is not locked', () => {
    const s = bipAbsenceStatus({ ...base, currentStatus: 'Inactive', attendance: attended('2026-10-06', '2026-10-13'), statusChanges: [{ date: '2026-10-14', status: 'Inactive' }] });
    assert.equal(s.locked, false);
});
