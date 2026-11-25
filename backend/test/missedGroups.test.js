const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findMissedGroups, weekOf, addMonths, phaseEveryMonths } = require('../lib/missedGroups');

// Group 1 meets every Tuesday in October and November 2026
const tuesdays = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10', '2026-11-17'];
const held = tuesdays.map(date => ({ group: 1, date }));
const base = {
    held, callIns: [], currentGroup: 1, assignedOn: null, programStart: '2026-10-01', currentStatus: 'Active',
    statusChanges: [], today: '2026-11-19',
};
const att = (date, type = 'Group', group = 1) => ({ group: type === 'Group' ? group : null, date, type });
const dates = (missed) => missed.map(m => m.date);

test('weeks run Sunday to Saturday', () => {
    assert.equal(weekOf('2026-11-15'), '2026-11-15');
    assert.equal(weekOf('2026-11-21'), '2026-11-15');
    assert.equal(weekOf('2026-11-22'), '2026-11-22');
    // Across a month
    assert.equal(weekOf('2026-12-02'), '2026-11-29');
});

test('an active client misses the meetings they did not check in to, through today, newest first', () => {
    const missed = findMissedGroups({ ...base, attendance: [att('2026-10-06'), att('2026-10-20'), att('2026-11-03')] });
    assert.deepEqual(dates(missed), ['2026-11-17', '2026-11-10', '2026-10-27', '2026-10-13']);
    assert.equal(missed[0].calledIn, false);
});

test('meetings before the client was put in the group do not count', () => {
    const missed = findMissedGroups({ ...base, assignedOn: '2026-11-01', attendance: [att('2026-11-10')] });
    assert.deepEqual(dates(missed), ['2026-11-17', '2026-11-03']);
});

test('a client who never checked in is counted from their program start', () => {
    const missed = findMissedGroups({ ...base, programStart: '2026-11-05', attendance: [] });
    assert.deepEqual(dates(missed), ['2026-11-17', '2026-11-10']);
});

test('a make-up, holiday, or check-in at another group that week covers the meeting', () => {
    const missed = findMissedGroups({
        ...base,
        attendance: [att('2026-10-06'), att('2026-10-15', 'Make-Up'), att('2026-10-22', 'Group', 2), att('2026-10-27', 'Holiday'), att('2026-11-03')],
        currentStatus: 'Inactive',
    });
    assert.deepEqual(dates(missed), []);
});

test('individual sessions and assessments do not cover a group meeting', () => {
    const missed = findMissedGroups({ ...base, today: '2026-10-20', attendance: [att('2026-10-06'), att('2026-10-14', 'Individual'), att('2026-10-20')] });
    assert.deepEqual(dates(missed), ['2026-10-13']);
});

test('a call-in that week marks the miss as called in, with its reason', () => {
    const missed = findMissedGroups({
        ...base, today: '2026-10-27',
        attendance: [att('2026-10-06'), att('2026-10-27')],
        callIns: [{ date: '2026-10-12', reason: 'Work conflict' }],
    });
    assert.deepEqual(missed.map(m => [m.date, m.calledIn, m.callInReason]), [['2026-10-20', false, null], ['2026-10-13', true, 'Work conflict']]);
});

test('weeks while the client was not Active do not count; misses before the status change do', () => {
    const missed = findMissedGroups({
        ...base,
        attendance: [att('2026-10-06')],
        currentStatus: 'Active',
        statusChanges: [{ date: '2026-10-22', status: 'Inactive' }, { date: '2026-11-09', status: 'Active' }],
    });
    assert.deepEqual(dates(missed), ['2026-11-17', '2026-11-10', '2026-10-20', '2026-10-13']);
});

test('an inactive client is counted up to when they were taken off Active, not after', () => {
    const missed = findMissedGroups({
        ...base,
        attendance: [att('2026-10-06')],
        currentStatus: 'Inactive',
        statusChanges: [{ date: '2026-10-28', status: 'Inactive' }],
    });
    assert.deepEqual(dates(missed), ['2026-10-27', '2026-10-20', '2026-10-13']);
});

test('an old group counts only between the first and last check-in there', () => {
    const missed = findMissedGroups({
        ...base,
        held: [...held, { group: 2, date: '2026-09-01' }, { group: 2, date: '2026-09-08' }, { group: 2, date: '2026-09-15' }, { group: 2, date: '2026-09-22' }],
        attendance: [att('2026-09-08', 'Group', 2), att('2026-09-22', 'Group', 2), ...tuesdays.map(d => att(d))],
    });
    assert.deepEqual(missed.map(m => [m.group, m.date]), [[2, '2026-09-15']]);
});

test('a missed week counts once when moving between groups, for the group last attended', () => {
    const missed = findMissedGroups({
        ...base,
        held: [...held, { group: 2, date: '2026-10-07' }, { group: 2, date: '2026-10-14' }, { group: 2, date: '2026-10-21' }],
        attendance: [att('2026-10-07', 'Group', 2), att('2026-10-21', 'Group', 2), att('2026-10-06'), att('2026-10-27')],
        today: '2026-10-27',
    });
    assert.deepEqual(missed.map(m => [m.group, m.date]), [[2, '2026-10-14']]);
});

test('months are added keeping the day, or the month end when shorter', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
    assert.equal(phaseEveryMonths('Phase 3 - Quarterly'), 3);
    assert.equal(phaseEveryMonths('Phase 1 - Weekly'), null);
});

test('a monthly client misses each calendar month with no group check-in', () => {
    const missed = findMissedGroups({
        ...base, held: [], everyMonths: 1,
        attendance: [att('2026-06-10'), att('2026-07-31'), att('2026-09-02')],
        callIns: [{ date: '2026-10-25', reason: 'Work conflict' }],
    });
    // June, July, September attended; August and October missed (October called in); November isn't over yet
    assert.deepEqual(missed.map(m => [m.date, m.calledIn, m.callInReason, m.everyMonths]),
        [['2026-10-31', true, 'Work conflict', 1], ['2026-08-31', false, null, 1]]);
});

test('a quarterly client misses each calendar quarter with no group check-in', () => {
    const missed = findMissedGroups({
        ...base, held: [], everyMonths: 3, today: '2027-01-05',
        attendance: [att('2026-02-10'), att('2026-06-30')],
    });
    assert.deepEqual(dates(missed), ['2026-12-31', '2026-09-30']);
});

test('weekly misses count until the client moved to a monthly phase, then by month', () => {
    const missed = findMissedGroups({
        ...base, everyMonths: 1, phaseSince: '2026-10-25',
        attendance: [att('2026-10-06'), att('2026-10-20')],
    });
    // Weekly: 10-13 missed. Monthly from 10-25: last check-in 10-20, due 11-20 (after today)
    assert.deepEqual(dates(missed), ['2026-10-13']);
});

test('a meeting closed in two session numbers is one miss', () => {
    const missed = findMissedGroups({ ...base, held: [...held, { group: 1, date: '2026-11-17' }], attendance: [att('2026-11-10')] });
    assert.deepEqual(dates(missed), ['2026-11-17']);
});

test('a make-up on the Sunday before a Monday group covers it (weeks start on Sunday)', () => {
    // Group 3 meets on Mondays; the client made it up on Sunday, November 8, the start of Monday the 9th's week
    const mondays = { ...base, currentGroup: 3, held: [{ group: 3, date: '2026-11-02' }, { group: 3, date: '2026-11-09' }, { group: 3, date: '2026-11-16' }] };
    const missed = findMissedGroups({ ...mondays, attendance: [att('2026-11-02', 'Group', 3), att('2026-11-08', 'Make-Up'), att('2026-11-16', 'Group', 3)] });
    assert.deepEqual(dates(missed), []);
    // A make-up on Saturday the 7th belongs to the week before, so it doesn't cover Monday the 9th
    const late = findMissedGroups({ ...mondays, attendance: [att('2026-11-02', 'Group', 3), att('2026-11-07', 'Make-Up'), att('2026-11-16', 'Group', 3)] });
    assert.deepEqual(dates(late), ['2026-11-09']);
});
