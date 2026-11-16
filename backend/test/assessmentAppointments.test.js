const { test } = require('node:test');
const assert = require('node:assert/strict');
const { slotProblem, appointmentProblem, ownsSlot } = require('../lib/assessmentAppointments');

const ok = { date: '2026-12-01', time: '09:30', today: '2026-11-16', clientActive: true, assessorActive: true };

test('a future assessment with an active client and counselor is fine', () => {
    assert.equal(appointmentProblem(ok), null);
});

test('today is allowed, earlier dates are not', () => {
    assert.equal(appointmentProblem({ ...ok, date: '2026-11-16' }), null);
    assert.match(appointmentProblem({ ...ok, date: '2026-11-15' }), /today or a later date/);
    assert.match(slotProblem({ ...ok, date: '2026-11-15' }), /today or a later date/);
});

test('the date and time must be filled in correctly', () => {
    assert.match(appointmentProblem({ ...ok, date: '' }), /assessment date/);
    assert.match(appointmentProblem({ ...ok, date: '12/01/2026' }), /assessment date/);
    assert.match(appointmentProblem({ ...ok, time: '' }), /assessment time/);
    assert.match(appointmentProblem({ ...ok, time: '25:00' }), /assessment time/);
});

test('only active clients and active counselors can be booked', () => {
    assert.match(appointmentProblem({ ...ok, clientActive: false }), /active clients/);
    assert.match(appointmentProblem({ ...ok, assessorActive: false }), /active counselor/);
});

test('open availability needs no client', () => {
    assert.equal(slotProblem({ ...ok, clientActive: false }), null);
    assert.match(slotProblem({ ...ok, assessorActive: false }), /active counselor/);
});

test('counselors only change their own times; admins change any', () => {
    assert.equal(ownsSlot({ role: 'Counselor', displayname: 'Pat Lee' }, 'Pat Lee'), true);
    assert.equal(ownsSlot({ role: 'Counselor', displayname: 'Pat Lee' }, 'Sam Ray'), false);
    assert.equal(ownsSlot({ role: 'Office Admin', displayname: 'Ann Fox' }, 'Sam Ray'), true);
    assert.equal(ownsSlot({ role: 'Business Administrator' }, 'Sam Ray'), true);
});

const { repeatDates, MAX_REPEATS } = require('../lib/assessmentAppointments');

test('no repeat is just the first date', () => {
    assert.deepEqual(repeatDates('2026-12-01', 'none', ''), { dates: ['2026-12-01'] });
    assert.deepEqual(repeatDates('2026-12-01', undefined, undefined), { dates: ['2026-12-01'] });
});

test('weekly and every-2-weeks repeats run through the end date', () => {
    // 2026-12-01 is a Tuesday
    assert.deepEqual(repeatDates('2026-12-01', 'weekly', '2026-12-22').dates, ['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22']);
    assert.deepEqual(repeatDates('2026-12-01', 'biweekly', '2026-12-31').dates, ['2026-12-01', '2026-12-15', '2026-12-29']);
    // across the year end and a month end
    assert.deepEqual(repeatDates('2026-12-29', 'weekly', '2027-01-12').dates, ['2026-12-29', '2027-01-05', '2027-01-12']);
});

test('weekday repeats skip Saturday and Sunday', () => {
    // Friday 2026-12-04 through Tuesday 2026-12-08
    assert.deepEqual(repeatDates('2026-12-04', 'weekdays', '2026-12-08').dates, ['2026-12-04', '2026-12-07', '2026-12-08']);
    assert.match(repeatDates('2026-12-05', 'weekdays', '2026-12-06').error, /No weekdays/);
});

test('repeats need a sensible end date and a limit', () => {
    assert.match(repeatDates('2026-12-01', 'weekly', '').error, /date the repeats end/);
    assert.match(repeatDates('2026-12-01', 'weekly', '2026-11-30').error, /before the first date/);
    assert.match(repeatDates('2026-12-01', 'monthly', '2027-01-01').error, /how often/);
    assert.match(repeatDates('2026-12-01', 'weekdays', '2027-12-31').error, new RegExp(`more than ${MAX_REPEATS}`));
});

const { locationProblem } = require('../lib/assessmentAppointments');

test('a new or changed time needs a location', () => {
    assert.equal(locationProblem('Oklahoma City Office'), null);
    assert.match(locationProblem(''), /Enter the location/);
    assert.match(locationProblem('   '), /Enter the location/);
    assert.match(locationProblem(undefined), /Enter the location/);
    assert.match(locationProblem('x'.repeat(151)), /under 150/);
});

const { moveProblem } = require('../lib/assessmentAppointments');

test('rescheduling moves a client only into the same counselor\'s upcoming open time', () => {
    const from = { appointmentid: 1, status: 'Scheduled', assessor: 'Alicia Martinez', apptdate: '2026-11-30' };
    const to = { appointmentid: 2, status: 'Open', assessor: 'alicia martinez ', apptdate: '2026-12-02' };
    const today = '2026-11-16';
    assert.equal(moveProblem({ from, to, today }), null);
    assert.match(moveProblem({ from: { ...from, status: 'Open' }, to, today }), /with a client/);
    assert.match(moveProblem({ from, to: { ...to, status: 'Scheduled' }, today }), /open times/);
    assert.match(moveProblem({ from, to: { ...to, status: 'Cancelled' }, today }), /open times/);
    assert.match(moveProblem({ from, to: { ...to, appointmentid: 1 }, today }), /different time/);
    assert.match(moveProblem({ from, to: { ...to, assessor: 'Monte Blake' }, today }), /Alicia Martinez's open times/);
    assert.match(moveProblem({ from, to: { ...to, apptdate: '2026-11-15' }, today }), /already passed/);
    assert.match(moveProblem({ from, to: undefined, today }), /open times/);
});
