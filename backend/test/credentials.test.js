const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withCredentials, CREDENTIALS_SQL } = require('../lib/credentials');

test('prints a counselor name followed by their credentials', () => {
    assert.equal(withCredentials('Belinda Harris', 'LPC, LADC-MH'), 'Belinda Harris, LPC, LADC-MH');
    assert.equal(withCredentials('  Pat Doe ', ' LPC '), 'Pat Doe, LPC');
});

test('prints just the name when there are no credentials, and nothing without a name', () => {
    assert.equal(withCredentials('Pat Doe', null), 'Pat Doe');
    assert.equal(withCredentials('Pat Doe', '  '), 'Pat Doe');
    assert.equal(withCredentials(null, 'LPC'), '');
    assert.equal(withCredentials('', ''), '');
});

test('looks credentials up by display name or account email', () => {
    const sql = CREDENTIALS_SQL('g.Counselor');
    assert.match(sql, /LOWER\(TRIM\(e\.DisplayName\)\) = LOWER\(TRIM\(g\.Counselor\)\)/);
    assert.match(sql, /LOWER\(e\.EmployeeEmail\) = LOWER\(TRIM\(g\.Counselor\)\)/);
});
