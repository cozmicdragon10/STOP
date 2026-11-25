const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSchedule, weekdayOf, to24h, to12h, longDate, canChangeGroup, changeProblem, changeNoteText } = require('../lib/groupSchedule');

const today = '2026-11-16'; // a Monday
// 2026-11-19 and 2026-11-26 are Thursdays
const base = { schedule: 'Thursdays @ 5:00 PM', today, originalDate: '2026-11-19' };

test('schedules read as a weekday and time', () => {
    assert.deepEqual(parseSchedule('Thursdays @ 5:00 PM'), { day: 'Thursday', time: '5:00 PM' });
    assert.deepEqual(parseSchedule('monday@ 9:30 am'), { day: 'Monday', time: '9:30 AM' });
    assert.deepEqual(parseSchedule('By Appointment'), { day: '', time: '' });
    assert.equal(weekdayOf('2026-11-19'), 'Thursday');
    assert.equal(to24h('5:00 PM'), '17:00');
    assert.equal(to24h('12:15 AM'), '00:15');
    assert.equal(to12h('17:00'), '5:00 PM');
    assert.equal(to12h('00:30'), '12:30 AM');
    assert.equal(longDate('2026-11-19'), 'Thursday, November 19, 2026');
});

test('an upcoming meeting on the group\'s day can be cancelled', () => {
    assert.equal(changeProblem({ ...base, action: 'Cancelled' }), null);
    assert.equal(changeProblem({ ...base, action: 'Cancelled', originalDate: '2026-11-16', schedule: 'Mondays @ 6:00 PM' }), null);
});

test('a past meeting can be cancelled, or rescheduled to today or later', () => {
    assert.equal(changeProblem({ ...base, action: 'Cancelled', originalDate: '2026-11-12' }), null);
    assert.equal(changeProblem({ ...base, action: 'Rescheduled', originalDate: '2026-11-12', newDate: '2026-11-17', newTime: '17:00' }), null);
    assert.match(changeProblem({ ...base, action: 'Rescheduled', originalDate: '2026-11-12', newDate: '2026-11-13', newTime: '17:00' }), /today or later/);
});

test('only real meetings can change', () => {
    assert.match(changeProblem({ ...base, action: 'Cancelled', originalDate: '2026-11-18' }), /meets on Thursdays/);
    assert.match(changeProblem({ ...base, action: 'Cancelled', schedule: 'By Appointment' }), /no weekly day/);
    assert.match(changeProblem({ ...base, action: 'Moved' }), /Cancel or Reschedule/);
});

test('a reschedule needs a new date and time that differ from the meeting', () => {
    assert.equal(changeProblem({ ...base, action: 'Rescheduled', newDate: '2026-11-20', newTime: '17:00' }), null);
    assert.equal(changeProblem({ ...base, action: 'Rescheduled', newDate: '2026-11-19', newTime: '18:30' }), null);
    assert.match(changeProblem({ ...base, action: 'Rescheduled', newDate: '2026-11-19', newTime: '17:00' }), /different date or time/);
    assert.match(changeProblem({ ...base, action: 'Rescheduled', newDate: '', newTime: '17:00' }), /new date/);
    assert.match(changeProblem({ ...base, action: 'Rescheduled', newDate: '2026-11-15', newTime: '17:00' }), /today or later/);
    assert.match(changeProblem({ ...base, action: 'Rescheduled', newDate: '2026-11-20', newTime: '' }), /new time/);
});

test('counselors change the groups they lead; office roles change any', () => {
    assert.equal(canChangeGroup({ role: 'Counselor', displayname: 'Belinda Harris' }, 'belinda harris '), true);
    assert.equal(canChangeGroup({ role: 'Counselor', displayname: 'Belinda Harris' }, 'Monte Blake'), false);
    assert.equal(canChangeGroup({ role: 'Counselor', displayname: '' }, ''), false);
    assert.equal(canChangeGroup({ role: 'Office Admin' }, 'Monte Blake'), true);
    assert.equal(canChangeGroup({ role: 'Business Administrator' }, 'Monte Blake'), true);
    assert.equal(canChangeGroup({ role: 'Polygrapher', displayname: 'Monte Blake' }, 'Monte Blake'), false);
});

test('the case note says what happened and why', () => {
    assert.equal(
        changeNoteText({ action: 'Cancelled', groupName: 'Ada SO', originalDate: '2026-11-19', scheduleTime: '5:00 PM', reason: 'Counselor out sick' }),
        'Ada SO on Thursday, November 19, 2026 at 5:00 PM was cancelled. Reason: Counselor out sick');
    assert.equal(
        changeNoteText({ action: 'Rescheduled', groupName: 'Ada SO', originalDate: '2026-11-19', scheduleTime: '5:00 PM', newDate: '2026-11-20', newTime: '18:00', reason: '' }),
        'Ada SO on Thursday, November 19, 2026 at 5:00 PM was rescheduled to Friday, November 20, 2026 at 6:00 PM.');
});
