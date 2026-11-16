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
