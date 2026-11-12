// Catches two people editing the same thing. When an edit is saved, the screen sends, for each field it changed, the
// value it showed when that field was first changed ("expected"). If the saved value no longer matches, someone else (or
// another screen) changed that field in the meantime, and the save is refused instead of silently replacing their change.
// Only the fields being changed are compared, so a payment taken while someone fixes a phone number is not a conflict.

// Client fields compared as numbers (150 and "150.00" match); blanks are compared as text
const NUMBER_FIELDS = new Set(['treatmentfee', 'accountbalance', 'vouchers', 'polyfeevoucher', 'polyfeepaid', 'polyfee',
    'copay', 'buspasses', 'buspassrefill', 'groupid', 'individualgroupid']);
const UNIT_FIELDS = new Set(['federalunits', 'federalunitrefills']);
const isDateField = (field) => /date/i.test(field);

// Federal units ({ code: units }) with blanks dropped and numbers compared as numbers, so 4 and "4.00" match
const normalizedUnits = (units) => JSON.stringify(Object.entries(units && typeof units === 'object' ? units : {})
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => [k, Number(v)])
    .sort(([a], [b]) => String(a).localeCompare(String(b))));

// Whether two values of a field are the same, compared the way the screen shows them. Values are as sent over JSON:
// dates as ISO strings, money as strings.
const sameValue = (field, a, b) => {
    if (UNIT_FIELDS.has(field)) return normalizedUnits(a) === normalizedUnits(b);
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
    const [x, y] = [String(a ?? ''), String(b ?? '')];
    if (isDateField(field)) return x.split('T')[0] === y.split('T')[0];
    if (NUMBER_FIELDS.has(field) && x !== '' && y !== '') return Number(x) === Number(y);
    return x === y;
};

// Federal units are checked code by code: expected holds only the codes being changed ({ code: units before }), so a
// unit used at check-in for another code isn't a conflict. A blank is no units on record.
const unitValue = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const unitsChanged = (expected, current) => Object.keys(expected && typeof expected === 'object' ? expected : {})
    .some(code => unitValue(expected[code]) !== unitValue(current && typeof current === 'object' ? current[code] : null));

// The fields in expected whose current value differs. current is the row as the screen would receive it (JSON-ready);
// fields it doesn't have are skipped.
const changedFields = (expected, current) => {
    if (!expected || typeof expected !== 'object' || !current) return [];
    const json = JSON.parse(JSON.stringify(current));
    return Object.keys(expected).filter(field => Object.prototype.hasOwnProperty.call(json, field)
        && (UNIT_FIELDS.has(field) ? unitsChanged(expected[field], json[field]) : !sameValue(field, expected[field], json[field])));
};

const CLIENT_FIELD_LABELS = {
    firstname: 'First Name', middlename: 'Middle Name', lastname: 'Last Name', doctype: 'ID # type', docnumber: 'ID #',
    dateofbirth: 'Date of Birth', sex: 'Sex', race: 'Race', supervisingagent: 'Supervising Agent', programstatus: 'Program Status',
    programstartdate: 'Program Start Date', address: 'Address', city: 'City', county: 'County', state: 'State', zip: 'Zip',
    mainphone: 'Main Phone', altphone: 'Alt Phone', emergencycontact: 'Emergency Contact', emergencycontactphone: 'Emergency Contact Phone',
    comments: 'Comments', programtype: 'Program Type', pretrial: 'Pretrial', phase: 'Phase', groupid: 'Group',
    individualgroupid: 'Individual Group', assessor: 'Assessor', copay: 'Copay', buspasses: 'Bus Passes', buspassrefill: 'Bus Pass Refill',
    treatmentfee: 'Treatment Fee', accountbalance: 'Account Balance', vouchers: 'Vouchers', polyfeevoucher: 'Poly Fee Voucher',
    polyfeepaid: 'Poly Fee Paid', polyfee: 'Poly Fee', federalunits: 'Federal Units', federalunitrefills: 'Federal Unit Refills',
};

// A field's current value as the office reads it, for the conflict message
const shownValue = (field, row) => {
    const v = row[field];
    if (field === 'groupid') return row.groupname || (v ? `Group ${v}` : 'none');
    if (field === 'individualgroupid') return row.individualgroupname || (v ? `Group ${v}` : 'none');
    if (UNIT_FIELDS.has(field)) {
        const entries = JSON.parse(normalizedUnits(v));
        return entries.length ? entries.map(([code, units]) => `${code}: ${units}`).join(', ') : 'none';
    }
    if (typeof v === 'boolean') return v ? 'checked' : 'unchecked';
    if (v === null || v === undefined || String(v).trim() === '') return 'blank';
    // Balances are stored as owed (positive) and shown the other way around: positive = credit (see frontend utils/balance.ts)
    if (field === 'accountbalance') {
        const shown = -Number(v);
        return `${shown < 0 ? '-' : ''}$${Math.abs(shown).toFixed(2)}`;
    }
    if (['treatmentfee', 'polyfeepaid', 'polyfee', 'copay'].includes(field)) return `$${Number(v).toFixed(2)}`;
    if (isDateField(field)) return String(v).split('T')[0];
    const text = String(v);
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

// The message for a refused client save, naming each field and what it is now
const clientConflictMessage = (fields, row) => {
    const json = JSON.parse(JSON.stringify(row));
    const list = fields.map(f => `${CLIENT_FIELD_LABELS[f] || f} (now ${shownValue(f, json)})`).join('; ');
    return `Not saved: while you were editing, this client's information was changed on another screen: ${list}. `
        + 'The current information is now shown. Your changes are still in the form: Save again to replace the other change with yours, or Cancel to keep it.';
};

// Whole-form saves (employee accounts, groups, the price list, supervising agents) send every field, so a stale form
// would put back anything changed since it was opened, such as reactivating an account someone just deactivated.
// The screen sends the record as it loaded it (expected); if any field the form saves is different now, the save is
// refused and the screen reloads the form. fields: [key, label, kind] with kind 'money', 'yesno', or omitted for text.
// No expected (a screen loaded before this check existed) means no check.
const staleFields = (expected, current, fields) => {
    if (!expected || typeof expected !== 'object' || !current) return [];
    const json = JSON.parse(JSON.stringify(current));
    return fields.filter(([key]) => Object.prototype.hasOwnProperty.call(expected, key)
        && !sameValue(key, expected[key], json[key]));
};

const formatted = (value, kind) => {
    if (kind === 'yesno') return value ? 'yes' : 'no';
    if (value === null || value === undefined || String(value).trim() === '') return 'blank';
    if (kind === 'money') return `$${Number(value).toFixed(2)}`;
    const text = String(value);
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

// The refusal for a whole-form save: what changed and its value now
const staleMessage = (what, stale, current) => {
    const json = JSON.parse(JSON.stringify(current));
    const list = stale.map(([key, label, kind]) => `${label} (now ${formatted(json[key], kind)})`).join('; ');
    return `Not saved: ${what} was changed on another screen since you opened it: ${list}. `
        + 'The form now shows the current version. Make your change again if it is still needed.';
};

module.exports = { sameValue, changedFields, clientConflictMessage, shownValue, staleFields, staleMessage };
