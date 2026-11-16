const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recordAttendance } = require('../lib/attendance');

// A database that answers the group lookup and refuses everything else, so a guard that lets a check-in through fails loudly
const fakeDb = (groupType = 'SO') => ({
    query: async (sql) => {
        if (/FROM Groups WHERE GroupId/.test(sql)) return { rows: [{ t: groupType }] };
        throw new Error('reached the database');
    },
});
const base = { client: 1, group: 5, date: '2026-11-16', type: 'Group', groupFee: 180, accountPaid: 0, paymentMethod: 'Cash' };

test('a payment or fee that is not a real amount is refused before anything is saved', async () => {
    for (const bad of ['abc', -10, Infinity]) {
        await assert.rejects(recordAttendance(fakeDb(), { ...base, accountPaid: bad }), /payment must be an amount/);
        await assert.rejects(recordAttendance(fakeDb(), { ...base, groupFee: bad }), /fee must be an amount/);
    }
});

test('a group check-in cannot be passed off as an assessment or individual session', async () => {
    await assert.rejects(recordAttendance(fakeDb(), { ...base, type: 'Assessment' }), /assessment is not checked in to a group/);
    await assert.rejects(recordAttendance(fakeDb('SO'), { ...base, type: 'Individual' }), /Only an INDIVIDUAL group/);
    await assert.rejects(recordAttendance(fakeDb(), { ...base, group: null }), /needs its group/);
});

test('real assessments and individual sessions get past the guards', async () => {
    await assert.rejects(recordAttendance(fakeDb(), { ...base, group: null, type: 'Assessment' }), /reached the database/);
    await assert.rejects(recordAttendance(fakeDb('INDIVIDUAL'), { ...base, type: 'Individual' }), /reached the database/);
    await assert.rejects(recordAttendance(fakeDb(), { ...base, accountPaid: undefined, groupFee: null }), /reached the database/);
});
