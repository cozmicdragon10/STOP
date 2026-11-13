const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CLIENT_INFO_COLUMNS, CLIENT_INFO_FIELDS, clientInfoChanges, dateText, dollars, noteText } = require('../lib/changeLog');

// A client row the way pg returns it: DATE columns as local-midnight Date objects, blanks as null
const row = (changes = {}) => ({
    firstname: 'John', middlename: null, lastname: 'Smith', phase: 'Phase 1 - Weekly',
    programstartdate: new Date(2026, 0, 5), dateofbirth: new Date(1990, 0, 15), sex: 'Male', race: 'White',
    address: '1 Main St', city: 'Tulsa', county: 'Tulsa', state: 'OK', zip: '74103',
    mainphone: '555-0100', altphone: null, emergencycontact: null, emergencycontactphone: null, comments: null,
    ...changes,
});

test('a middle name change is logged as just the middle name', () => {
    assert.deepEqual(clientInfoChanges(row(), row({ middlename: 'Paul' })), [['Middle Name', '', 'Paul']]);
    assert.deepEqual(clientInfoChanges(row({ middlename: 'Paul' }), row({ middlename: 'Peter' })), [['Middle Name', 'Paul', 'Peter']]);
});

test('nothing changed logs nothing, and blank, null and spaces count as the same', () => {
    assert.deepEqual(clientInfoChanges(row(), row()), []);
    assert.deepEqual(clientInfoChanges(row({ altphone: null }), row({ altphone: '  ' })), []);
});

test('every Edit Info field is compared, with dates as MM/DD/YYYY', () => {
    const after = row({
        phase: 'Phase 2 - Monthly', programstartdate: new Date(2026, 1, 1), dateofbirth: new Date(1991, 2, 3),
        sex: 'Female', race: 'Other', address: '2 Oak Ave', city: 'OKC', county: 'Oklahoma', state: 'TX', zip: '73102',
        mainphone: '555-0101', altphone: '555-0102', emergencycontact: 'Jane', emergencycontactphone: '555-0103', comments: 'Note',
        firstname: 'Jon', middlename: 'Paul', lastname: 'Smyth',
    });
    const changes = clientInfoChanges(row(), after);
    assert.deepEqual(changes.map(c => c[0]), CLIENT_INFO_FIELDS.map(f => f[0]));
    assert.deepEqual(changes.find(c => c[0] === 'Date of Birth'), ['Date of Birth', '01/15/1990', '03/03/1991']);
    assert.deepEqual(changes.find(c => c[0] === 'Alt Phone'), ['Alt Phone', '', '555-0102']);
});

test('the columns selected cover every field read', () => {
    const columns = CLIENT_INFO_COLUMNS.toLowerCase().split(',').map(c => c.trim());
    for (const key of Object.keys(row())) assert.ok(columns.includes(key), `${key} is not selected`);
});

test('dates and amounts read the same however they arrive', () => {
    assert.equal(dateText(new Date(2026, 10, 13)), '11/13/2026');
    assert.equal(dateText('2026-11-13'), '11/13/2026');
    assert.equal(dateText('2026-11-13T00:00:00.000Z'), '11/13/2026');
    assert.equal(dateText(null), '');
    assert.equal(dollars('12.5'), '$12.50');
    assert.equal(dollars(-3), '-$3.00');
});

test('long note text is cut short', () => {
    assert.equal(noteText('  hi  '), 'hi');
    assert.equal(noteText('x'.repeat(600)).length, 501);
});
