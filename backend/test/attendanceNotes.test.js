const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    MAKEUP_COMMENT, addAttendanceNote, attendanceLabel, attendanceNoteText, bipWeekAt, noteAuthor, noteBody, replaceNoteBody, splitEntryComments,
} = require('../lib/attendanceNotes');

test('an attendance note can be shown and changed without its heading', () => {
    const note = 'BIP Week 12 · Clinton SO 1 · 11/19/2026: Did well.';
    assert.equal(noteBody(note), 'Did well.');
    assert.equal(replaceNoteBody(note, 'Left early.'), 'BIP Week 12 · Clinton SO 1 · 11/19/2026: Left early.');
    const second = 'Attendance · Clinton SO 1 (session 2) · 1/5/2027: Hi';
    assert.equal(noteBody(second), 'Hi');
    assert.equal(replaceNoteBody(second, 'Bye'), 'Attendance · Clinton SO 1 (session 2) · 1/5/2027: Bye');
    // Notes written before the label lost its number are still read
    assert.equal(noteBody('Attendance #58 · Muskogee SO 2 · 11/19/2026: test'), 'test');
    // A note without the heading is left whole
    assert.equal(noteBody('Plain note'), 'Plain note');
    assert.equal(replaceNoteBody('Plain note', 'New'), 'New');
});

test('a BIP client\'s week at an earlier attendance is the current week less the group attendances since', async () => {
    const db = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
    assert.equal(await bipWeekAt(db({ programtype: 'BIP', phase: '12', later: 2 }), { clientId: 1, attendanceId: 5, date: '2026-11-01' }), '10');
    assert.equal(await bipWeekAt(db({ programtype: 'BIP', phase: '12', later: 0 }), { clientId: 1, attendanceId: 5, date: '2026-11-01' }), '12');
    // Not BIP, no week number, or a count that doesn't fit: no week (the note uses the attendance count)
    assert.equal(await bipWeekAt(db({ programtype: 'State SO', phase: '3', later: 0 }), { clientId: 1, attendanceId: 5, date: '2026-11-01' }), null);
    assert.equal(await bipWeekAt(db({ programtype: 'BIP', phase: 'Phase 1', later: 0 }), { clientId: 1, attendanceId: 5, date: '2026-11-01' }), null);
    assert.equal(await bipWeekAt(db({ programtype: 'BIP', phase: '2', later: 5 }), { clientId: 1, attendanceId: 5, date: '2026-11-01' }), null);
});

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

test('the note names the BIP week, or just that it is an attendance for everyone else', () => {
    assert.equal(attendanceLabel({ bipWeek: '12' }), 'BIP Week 12');
    assert.equal(attendanceLabel({ bipWeek: null }), 'Attendance');
    assert.equal(attendanceLabel({ bipWeek: null, individual: true }), 'Individual Session');
    assert.equal(
        attendanceNoteText({ label: 'BIP Week 12', groupName: 'Clinton SO 1', date: '2026-11-19', sessionNumber: 1, text: 'Did well.' }),
        'BIP Week 12 · Clinton SO 1 · 11/19/2026: Did well.'
    );
    assert.equal(
        attendanceNoteText({ label: 'Attendance', groupName: 'Clinton SO 1', date: '2026-11-19', sessionNumber: 2, text: 'Hi' }),
        'Attendance · Clinton SO 1 (session 2) · 11/19/2026: Hi'
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

test('a Therapist note is added for the attendance, and nothing is added without a comment', async () => {
    const db = fakeDb();
    const text = await addAttendanceNote(db, {
        clientId: 7, attendanceId: 900, date: '2026-11-19', sessionNumber: 1, groupName: 'Clinton SO 1', bipWeek: null,
        individual: false, text: 'Arrived late.', author: 'bharris@x.org', closedBy: 'desk@x.org',
    });
    assert.equal(text, 'Attendance · Clinton SO 1 · 11/19/2026: Arrived late.');
    const insert = db.calls.find(c => /INSERT INTO Notes/.test(c.sql));
    assert.match(insert.sql, /'Therapist'/);
    // Linked to its attendance so it can be updated from the closed group
    assert.deepEqual(insert.params, [7, 'bharris@x.org', text, 900]);

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
