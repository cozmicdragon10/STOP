const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MAKEUP_COMMENT, addAttendanceNote, attendanceLabel, attendanceNoteText, noteAuthor, splitEntryComments } = require('../lib/attendanceNotes');

test('a comment goes to the note and nothing stays on the attendance', () => {
    assert.deepEqual(splitEntryComments({ comments: '  Arrived late, participated well. ' }),
        { attendanceComment: null, noteText: 'Arrived late, participated well.' });
    assert.deepEqual(splitEntryComments({ comments: '' }), { attendanceComment: null, noteText: '' });
});

test('an approved make-up stays on the attendance and is not part of the note', () => {
    assert.deepEqual(splitEntryComments({ comments: 'Quiet today', makeup: true }),
        { attendanceComment: MAKEUP_COMMENT, noteText: 'Quiet today' });
    // Sheets saved before the make-up flag put the text at the start of the comments
    assert.deepEqual(splitEntryComments({ comments: `${MAKEUP_COMMENT}. Quiet today` }),
        { attendanceComment: MAKEUP_COMMENT, noteText: 'Quiet today' });
    assert.deepEqual(splitEntryComments({ comments: MAKEUP_COMMENT }), { attendanceComment: MAKEUP_COMMENT, noteText: '' });
});

test('the note names the BIP week, or the attendance count for everyone else', () => {
    assert.equal(attendanceLabel({ bipWeek: '12', count: null }), 'BIP Week 12');
    assert.equal(attendanceLabel({ bipWeek: null, count: 23 }), 'Attendance #23');
    assert.equal(attendanceLabel({ bipWeek: null, count: 4, individual: true }), 'Individual Session #4');
    assert.equal(
        attendanceNoteText({ label: 'BIP Week 12', groupName: 'Clinton SO 1', date: '2026-11-19', sessionNumber: 1, text: 'Did well.' }),
        'BIP Week 12 · Clinton SO 1 · 11/19/2026: Did well.'
    );
    assert.equal(
        attendanceNoteText({ label: 'Attendance #3', groupName: 'Clinton SO 1', date: '2026-11-19', sessionNumber: 2, text: 'Hi' }),
        'Attendance #3 · Clinton SO 1 (session 2) · 11/19/2026: Hi'
    );
});

// A stand-in database that answers the queries addAttendanceNote and noteAuthor make
const fakeDb = (answers = {}) => {
    const calls = [];
    return {
        calls,
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/COUNT\(\*\)/.test(sql)) return { rows: [{ n: answers.count ?? 1 }] };
            if (/FROM EmployeeRoles/.test(sql)) return { rows: answers.employee ? [{ employeeemail: answers.employee }] : [] };
            return { rows: [] };
        },
    };
};

test('the note is written by the covering counselor, else the group counselor, else whoever closed the group', async () => {
    assert.equal(await noteAuthor(fakeDb(), { coveredBy: 'cover@x.org', groupCounselor: 'Belinda Harris', closedBy: 'desk@x.org' }), 'cover@x.org');
    assert.equal(await noteAuthor(fakeDb({ employee: 'bharris@x.org' }), { coveredBy: null, groupCounselor: 'Belinda Harris', closedBy: 'desk@x.org' }), 'bharris@x.org');
    assert.equal(await noteAuthor(fakeDb(), { coveredBy: null, groupCounselor: 'No Account', closedBy: 'desk@x.org' }), 'desk@x.org');
});

test('a Therapist note is added with the attendance count, and nothing is added without a comment', async () => {
    const db = fakeDb({ count: 23 });
    const text = await addAttendanceNote(db, {
        clientId: 7, attendanceId: 900, date: '2026-11-19', sessionNumber: 1, groupName: 'Clinton SO 1', bipWeek: null,
        individual: false, text: 'Arrived late.', author: 'bharris@x.org', closedBy: 'desk@x.org',
    });
    assert.equal(text, 'Attendance #23 · Clinton SO 1 · 11/19/2026: Arrived late.');
    const insert = db.calls.find(c => /INSERT INTO Notes/.test(c.sql));
    assert.match(insert.sql, /'Therapist'/);
    assert.deepEqual(insert.params, [7, 'bharris@x.org', text]);

    const empty = fakeDb();
    assert.equal(await addAttendanceNote(empty, { clientId: 7, attendanceId: 901, date: '2026-11-19', text: '' }), null);
    assert.equal(empty.calls.length, 0);
});

test('a BIP client\'s note uses their week number without counting attendance', async () => {
    const db = fakeDb();
    const text = await addAttendanceNote(db, {
        clientId: 8, attendanceId: 902, date: '2026-11-19', sessionNumber: 1, groupName: 'BIP Tues', bipWeek: '12',
        individual: false, text: 'Good insight.', author: 'c@x.org', closedBy: 'c@x.org',
    });
    assert.equal(text, 'BIP Week 12 · BIP Tues · 11/19/2026: Good insight.');
    assert.ok(!db.calls.some(c => /COUNT\(\*\)/.test(c.sql)));
});
