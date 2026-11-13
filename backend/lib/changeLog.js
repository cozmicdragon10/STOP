const { pool } = require('../db');

// Every change to a client's account goes on its change log (the Change Log tab): information edits, money, attendance,
// polygraphs, case notes, attachments and call-ins. Pass the caller's transaction client as db so the entry is saved (or
// rolled back) with the change it describes.
const logClientChange = (db, { clientId, changedBy, changeType, oldValue = null, newValue = null, details = null, expiresOn = null }) =>
    db.query(
        `INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details, ExpiresOn)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [clientId, changedBy || 'Unknown', changeType, oldValue, newValue, details, expiresOn]
    );

const groupNameFor = async (groupId) => {
    if (!groupId) return 'None';
    const res = await pool.query('SELECT GroupName FROM Groups WHERE GroupId = $1', [groupId]);
    return res.rows[0]?.groupname || `Group ${groupId}`;
};

// "$12.50" (a negative amount keeps its sign: "-$12.50")
const dollars = (n) => {
    const v = Math.round(Number(n || 0) * 100) / 100;
    return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
};

// A date column as MM/DD/YYYY. pg returns DATE columns as local-midnight Date objects; text is read as YYYY-MM-DD.
const dateText = (value) => {
    if (value === null || value === undefined || value === '') return '';
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return '';
        return `${String(value.getMonth() + 1).padStart(2, '0')}/${String(value.getDate()).padStart(2, '0')}/${value.getFullYear()}`;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    return m ? `${m[2]}/${m[3]}/${m[1]}` : String(value);
};

const fullName = (c) => [c.firstname, c.middlename, c.lastname].map(p => String(p ?? '').trim()).filter(Boolean).join(' ');

// The Edit Info fields logged by clientInfoChanges, as [change type, how to read it from a client row]. The ID #, status,
// program, agent, assessor, groups, pretrial, bus passes, copay and money fields are logged separately in routes/clients.js.
const CLIENT_INFO_FIELDS = [
    ['Name', fullName],
    ['Phase', c => c.phase],
    ['Program Start Date', c => dateText(c.programstartdate)],
    ['Date of Birth', c => dateText(c.dateofbirth)],
    ['Sex', c => c.sex],
    ['Race', c => c.race],
    ['Address', c => c.address],
    ['City', c => c.city],
    ['County', c => c.county],
    ['State', c => c.state],
    ['Zip', c => c.zip],
    ['Main Phone', c => c.mainphone],
    ['Alt Phone', c => c.altphone],
    ['Emergency Contact', c => c.emergencycontact],
    ['Emergency Contact Phone', c => c.emergencycontactphone],
    ['Comments', c => c.comments],
];
// Columns clientInfoChanges reads, for the SELECTs before and after an edit
const CLIENT_INFO_COLUMNS = 'FirstName, MiddleName, LastName, Phase, ProgramStartDate, DateOfBirth, Sex, Race, Address, City, County, State, Zip, MainPhone, AltPhone, EmergencyContact, EmergencyContactPhone, Comments';

// [change type, old text, new text] for each Edit Info field that differs between two client rows ('' when blank)
const clientInfoChanges = (before, after) => CLIENT_INFO_FIELDS
    .map(([type, read]) => [type, String(read(before) ?? '').trim(), String(read(after) ?? '').trim()])
    .filter(([, oldValue, newValue]) => oldValue !== newValue);

// A note's text for the log, cut short so one long note doesn't swamp the entry
const NOTE_TEXT_MAX = 500;
const noteText = (text) => {
    const t = String(text ?? '').trim();
    return t.length > NOTE_TEXT_MAX ? `${t.slice(0, NOTE_TEXT_MAX)}…` : t;
};

module.exports = {
    logClientChange, groupNameFor, dollars, dateText, fullName, CLIENT_INFO_FIELDS, CLIENT_INFO_COLUMNS, clientInfoChanges, noteText,
};
