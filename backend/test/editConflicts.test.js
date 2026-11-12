const { test } = require('node:test');
const assert = require('node:assert/strict');
const { changedFields, clientConflictMessage, sameValue } = require('../lib/editConflicts');

// A client row the way pg returns it: money as strings, dates as Date objects
const row = (changes = {}) => ({
    clientid: 7, firstname: 'John', mainphone: '555-0100', accountbalance: '100.00', vouchers: 2, buspasses: 3,
    dateofbirth: new Date(1990, 0, 15), pretrial: false, groupid: 4, groupname: 'Tuesday SO',
    federalunits: { 6022: '4.00' }, middlename: null, ...changes,
});
// What the screen holds: the same row after the trip through JSON
const asSeen = (r) => JSON.parse(JSON.stringify(r));

test('a payment taken while someone fixes the phone number is not a conflict', () => {
    const seen = asSeen(row());
    const now = row({ accountbalance: '50.00' });
    assert.deepEqual(changedFields({ mainphone: seen.mainphone }, now), []);
});

test('a field the editor changed that someone else also changed is a conflict', () => {
    const seen = asSeen(row());
    const now = row({ accountbalance: '50.00', mainphone: '555-0199' });
    assert.deepEqual(changedFields({ accountbalance: seen.accountbalance, mainphone: seen.mainphone }, now).sort(), ['accountbalance', 'mainphone']);
});

test('values that only look different are the same', () => {
    assert.ok(sameValue('accountbalance', 100, '100.00'));
    assert.ok(sameValue('buspasses', '3', 3));
    assert.ok(sameValue('middlename', null, ''));
    assert.ok(sameValue('pretrial', null, false));
    assert.ok(sameValue('dateofbirth', '1990-01-15', asSeen(row()).dateofbirth.split('T')[0] + 'T05:00:00.000Z'));
    assert.ok(sameValue('federalunits', { 6022: 4, 6012: '' }, { 6022: '4.00' }));
    assert.ok(!sameValue('federalunits', { 6022: 4 }, { 6022: '3.00' }));
    assert.ok(!sameValue('pretrial', true, false));
    assert.ok(!sameValue('vouchers', '', 0));
});

test('every field of a row the screen loaded matches the same row read again', () => {
    const seen = asSeen(row());
    assert.deepEqual(changedFields(seen, row()), []);
});

test('federal units are checked only for the codes being changed', () => {
    const now = row({ federalunits: { 6022: '4.00', 1010: '2.00' } });
    // A drug test used a 1010 unit while someone changed 6022: not a conflict
    assert.deepEqual(changedFields({ federalunits: { 6022: 4 } }, now), []);
    // Someone else changed 6022 too
    assert.deepEqual(changedFields({ federalunits: { 6022: 5 } }, now), ['federalunits']);
    // A code with no units on record, still blank
    assert.deepEqual(changedFields({ federalunits: { 6012: '' } }, now), []);
});

test('fields the row does not have and a missing expected are skipped', () => {
    assert.deepEqual(changedFields({ notacolumn: 'x' }, row()), []);
    assert.deepEqual(changedFields(undefined, row()), []);
});

test('the conflict message names each field and its current value as the office reads it', () => {
    const now = row({ accountbalance: '50.00', groupid: 9, groupname: 'Thursday SO', middlename: null });
    const msg = clientConflictMessage(['accountbalance', 'groupid', 'middlename'], now);
    assert.match(msg, /Account Balance \(now -\$50\.00\)/);
    assert.match(msg, /Group \(now Thursday SO\)/);
    assert.match(msg, /Middle Name \(now blank\)/);
    assert.match(msg, /Save again/);
});

// Two people at once, end to end: the browser's payload (frontend/src/utils/clientEdits.ts) against the server's check
const path = require('path');
const { pathToFileURL } = require('url');
const browser = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'clientEdits.ts')).href);
// Applies a save the way the UPDATE does: only the fields sent change (units code by code)
const applySave = (current, changes) => {
    const next = { ...current };
    for (const [field, value] of Object.entries(changes)) {
        next[field] = field === 'federalunits' ? { ...current.federalunits, ...value } : value;
    }
    return next;
};
// One person's edit session, driven the way the Information tab drives it
const startEdit = (b, client) => {
    let edits = {};
    let origins = {};
    return {
        set(field, value) { origins = b.recordOrigins(origins, client, [field]); edits = { ...edits, [field]: value }; },
        setUnits(code, value) {
            origins = b.recordOrigins(origins, client, ['federalunits']);
            edits = { ...edits, federalunits: { ...(edits.federalunits ?? {}), [code]: value } };
        },
        save(current) {
            const { changes, expected } = b.editPayload(edits, origins);
            const conflicts = changedFields(expected, current);
            if (conflicts.length) { origins = b.rebaseOrigins(origins, asSeen(current), conflicts); return { conflicts }; }
            return { saved: applySave(current, changes), changes };
        },
    };
};

test('two people: a payment taken while someone edits the phone number is kept', async () => {
    const b = await browser();
    const db = row();
    const a = startEdit(b, asSeen(db));
    a.set('mainphone', '555-0142');
    const afterPayment = { ...db, accountbalance: '50.00' };
    const result = a.save(afterPayment);
    assert.deepEqual(Object.keys(result.changes), ['mainphone']);
    assert.equal(result.saved.accountbalance, '50.00');
    assert.equal(result.saved.mainphone, '555-0142');
});

test('two people: both change the phone number; the second is stopped, then can save on purpose', async () => {
    const b = await browser();
    const db = row();
    const a = startEdit(b, asSeen(db));
    const other = startEdit(b, asSeen(db));
    a.set('mainphone', '555-0142');
    other.set('mainphone', '555-0199');
    const afterOther = other.save(db).saved;
    assert.deepEqual(a.save(afterOther).conflicts, ['mainphone']);
    // Having seen the message, saving again replaces the other change
    assert.equal(a.save(afterOther).saved.mainphone, '555-0142');
});

test('two people: an edited balance is stopped when a payment changed it meanwhile', async () => {
    const b = await browser();
    const db = row();
    const a = startEdit(b, asSeen(db));
    a.set('accountbalance', -20);
    assert.deepEqual(a.save({ ...db, accountbalance: '50.00' }).conflicts, ['accountbalance']);
});

test('two people: a drug test unit used while someone changes another code is kept', async () => {
    const b = await browser();
    const db = row({ federalunits: { 6022: '4.00', 1010: '3.00' } });
    const a = startEdit(b, asSeen(db));
    a.setUnits('6022', '6');
    const afterDrugTest = { ...db, federalunits: { 6022: '4.00', 1010: '2.00' } };
    const result = a.save(afterDrugTest);
    assert.deepEqual(result.changes, { federalunits: { 6022: '6' } });
    assert.deepEqual(result.saved.federalunits, { 6022: '6', 1010: '2.00' });
});

test('a field typed back to what it was is not sent', async () => {
    const b = await browser();
    const a = startEdit(b, asSeen(row()));
    a.set('mainphone', '555-9999');
    a.set('mainphone', '555-0100');
    assert.deepEqual(a.save(row()).changes, {});
});

// Whole-form saves (accounts, agents, groups, the price list)
const { staleFields, staleMessage } = require('../lib/editConflicts');
const EMPLOYEE = [['displayname', 'Display Name'], ['role', 'Role'], ['active', 'Active', 'yesno'], ['credentials', 'Credentials']];
const PRICE = [['name', 'Name'], ['fee', 'Price', 'money'], ['active', 'Active', 'yesno'], ['latefee', 'Price after 6 months', 'money']];

test('an account deactivated by another admin is not reactivated by a stale form', () => {
    const loaded = { displayname: 'Pat Doe', role: 'Counselor', active: true, credentials: 'LPC' };
    const now = { ...loaded, active: false };
    const stale = staleFields(asSeen(loaded), now, EMPLOYEE);
    assert.deepEqual(stale.map(([k]) => k), ['active']);
    assert.match(staleMessage('this account', stale, now), /^Not saved: this account was changed on another screen since you opened it: Active \(now no\)\./);
});

test('an unchanged record saves, and blanks match whether null or empty', () => {
    const loaded = { displayname: 'Pat Doe', role: 'Counselor', active: true, credentials: null };
    assert.deepEqual(staleFields(asSeen(loaded), { ...loaded, credentials: '' }, EMPLOYEE), []);
});

test('a price changed meanwhile is caught and shown as money', () => {
    const loaded = { name: '50-Minute Individual', fee: '80.00', active: true, latefee: null };
    const now = { ...loaded, fee: '95.00' };
    const stale = staleFields(asSeen(loaded), now, PRICE);
    assert.match(staleMessage('this price list entry', stale, now), /Price \(now \$95\.00\)/);
});

test('a screen loaded before the check existed (no expected) is not checked', () => {
    assert.deepEqual(staleFields(undefined, { active: false }, EMPLOYEE), []);
});
