// Imports clients from the old SQL Server system's ClientData.csv export into Clients.
//
//   node import/importClients.js [folder]            dry run: loads everything in a transaction, reports, rolls back
//   node import/importClients.js [folder] --commit   same, then commits
//
// folder defaults to D:\DataImports and must hold ClientData.csv and SupervisingAgent.csv.
// WARNING: --commit wipes the existing clients and everything linked to them (attendance, payments, notes, polygraphs,
// discharges, ...) so the old ClientIds can be kept as-is and the later Attendance/Notes/Polygraph imports line up.
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const IMPORTED_BY = 'Data Import';

// The old system stored balances as payments minus charges (negative = client owes). Here a positive balance is owed.
const NEGATE_BALANCE = true;

// Old ClientStatus -> ProgramStatus (TreatmentStatus.csv)
const STATUS_MAP = {
    0: 'Inactive',
    1: 'Active',
    2: 'Completed',
    3: 'Transferred',
    4: 'Discharged Supervision',
    5: 'Deceased',
    6: 'Revoked',
    7: 'Revoked',
    8: 'Program Failed',
    9: 'Program Failed',
};
const OLD_STATUS_NAMES = {
    0: 'Inactive', 1: 'Active', 2: 'Completed', 3: 'Transferred', 4: 'Discharged', 5: 'Deceased',
    6: 'Revoked - Sex Related', 7: 'Revoked', 8: 'Failed - Non Attendance', 9: 'Failed - Non Compliance',
};
// Discharge subcategory recorded for old statuses that say why (see DISCHARGE_SUBCATEGORIES in the frontend)
const DISCHARGE_SUBCATEGORY = { 6: 'New SO Charge', 8: 'Attendance' };

// Old TreatmentPhase (ProgramPhase.csv) -> [ProgramType, Phase]. BIP phase is the client's week number, which the old
// system didn't track, so BIP clients start at '0'. Services with no matching program keep the old phase name.
const PHASE_MAP = {
    0: ['State SO', 'Completed'],
    1: ['State SO', 'Phase 1 - Weekly'],
    2: ['State SO', 'Phase 2 - Monthly'],
    3: ['State SO', 'Phase 3 - Quarterly'],
    4: ['State SO', 'Phase 4 - Semi Anual'],
    5: ['State SO', 'Phase 1 - Weekly'],     // Weekly Voucher
    6: ['BIP', '0'],                         // Weekly - 35
    7: ['Federal SO', 'Phase 2 - Monthly'],
    8: ['Federal SO', 'Phase 3 - Quarterly'],
    9: ['Federal SO', 'Phase 4 - Semi Anual'],
    10: ['State SO', 'Phase 1 - Weekly'],    // 1 Week Free
    11: ['State SO', 'Phase 1 - Weekly'],    // 2 Weeks Free
    12: ['State SO', 'Phase 1 - Weekly'],    // 3 Weeks Free
    13: ['State SO', 'Phase 1 - Weekly'],    // Weekly Temp
    14: ['Federal SO', 'Phase 1 - Weekly'],
    15: ['State SO', 'Phase 1 - Weekly'],    // Pro-Bono
    16: ['State SO', 'Phase 1 - Weekly'],    // Pro-Bono Reduced
    17: [null, 'MRT'],
    18: [null, 'MRT Voucher'],
    19: [null, 'Chaperon'],
    20: [null, 'Substance Abuse Evaluation'],
    22: [null, 'Mental Health Evaluation'],
    23: [null, 'Sexual Interest Evaluation'],
    24: ['BIP', '0'],                        // Domestic Violence Assessment
    25: ['BIP', '0'],                        // BIP Intake
    26: [null, 'AM Assessment'],
    27: ['BIP', '0'],                        // BIP Exit
    32: ['BIP', '0'],                        // BIP Reinstatement
    33: ['Federal SO', 'Phase 1 - Weekly'],  // Federal Drug Testing
    34: ['Federal SO', 'Phase 1 - Weekly'],  // Federal Individual
    35: ['Federal SO', 'Phase 1 - Weekly'],  // Federal Polygraphs
    36: ['Federal SO', 'Phase 1 - Weekly'],  // Federal Chaperon
};

// Old GroupId (GroupData.csv) -> current group name. Old groups with no clear match (assessments, individuals,
// accounts, drug testing, "Okc", "Shawnee", ...) are left out, and those clients get no group.
const GROUP_MAP = {
    1: 'Ada SO', 113: 'Ada BIP',
    3: 'Ardmore SO',
    139: 'Chickasha SO 1', 73: 'Chickasha SO 2',
    131: 'Clinton SO 1', 81: 'Clinton SO 2',
    5: 'Duncan SO',
    138: 'Guthrie SO',
    7: 'Lawton SO', 44: 'Lawton BIP',
    114: 'Muskogee SO 1', 34: 'Muskogee SO 2', 123: 'Muskogee BIP',
    8: 'Norman SO 1', 89: 'Norman SO 2',
    20: 'OKC F-SO 1', 18: 'OKC F-SO 2', 41: 'OKC F-SO 3', 58: 'OKC F-SO 4', 60: 'OKC F-SO 5',
    96: 'OKC M-SO 2',
    36: 'OKC W-SO 1', 105: 'OKC W-SO 2', 109: 'OKC W-SO 3', 6: 'OKC W-SO 4', 12: 'OKC W-SO 5',
    11: 'Okmulgee SO', 100: 'Okmulgee BIP',
    14: 'Sapulpa SO 1', 61: 'Sapulpa SO 2',
    141: 'Shawnee M-SO 1', 27: 'Shawnee M-SO 2', 33: 'Shawnee M-BIP',
    50: 'Shawnee Th-SO 1', 85: 'Shawnee Th-SO 2', 76: 'Shawnee Th-BIP',
    130: 'Stillwater SO 1', 137: 'Stillwater SO 2', 72: 'Stillwater SO 3',
    62: 'Tulsa North-SO 1', 43: 'Tulsa North-SO 2',
    64: 'Tulsa SO 1', 25: 'Tulsa SO 2',
    66: 'Tulsa BIP 1', 26: 'Tulsa BIP 2',
    132: 'Woodward SO 1', 45: 'Woodward SO 2',
};
// Group program types each client program may join (mirrors GROUP_TYPES_BY_PROGRAM in the frontend)
const GROUP_TYPES_BY_PROGRAM = { 'State SO': ['SO', 'FED SO'], 'Federal SO': ['SO', 'FED SO'], 'BIP': ['BIP'] };

// Splits one record into fields; quoted fields may hold commas, doubled quotes and line breaks
const parseFields = (record) => {
    const fields = [];
    let field = '', quoted = false;
    for (let i = 0; i < record.length; i++) {
        const ch = record[i];
        if (quoted) {
            if (ch !== '"') field += ch;
            else if (record[i + 1] === '"') { field += '"'; i++; }
            else quoted = false;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') { fields.push(field); field = ''; }
        else field += ch;
    }
    fields.push(field);
    return { fields, open: quoted };
};

// The old export didn't always quote the last column, so a comment can run onto following lines and contain commas.
// A line starts a new record only when it begins with a numeric ID and the record so far has every column; extra
// fields are joined back into the last column.
const readCsv = (file) => {
    const lines = fs.readFileSync(path.join(FOLDER, file), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const header = parseFields(lines[0]).fields.map(h => h.trim());
    const records = [];
    let current = null;
    for (const line of lines.slice(1)) {
        if (current !== null && current.trim() !== '') {
            const parsed = parseFields(current);
            if (parsed.open || parsed.fields.length < header.length || !/^\d+,/.test(line)) {
                current += '\n' + line;
                continue;
            }
            records.push(current);
        }
        current = line;
    }
    if (current && current.trim() !== '') records.push(current);
    return records.map(record => {
        const { fields } = parseFields(record);
        const row = fields.slice(0, header.length - 1);
        row.push(fields.slice(header.length - 1).join(','));
        return Object.fromEntries(header.map((h, i) => [h, row[i]]));
    });
};

// 'NULL', blanks and the old system's ' ' defaults become null
const text = (v) => (v === undefined || v === 'NULL' || v.trim() === '') ? null : v.trim();
const num = (v) => text(v) === null ? null : Number(v);
// 'YYYY-MM-DD hh:mm:ss.fff' -> 'YYYY-MM-DD'; the old 1800-01-01 "no date" placeholder becomes null
const date = (v) => {
    const t = text(v);
    return t && /^\d{4}-\d{2}-\d{2}/.test(t) && t.slice(0, 4) >= '1900' ? t.slice(0, 10) : null;
};
const STATE_NAMES = { OKLAHOMA: 'OK', OKLA: 'OK', 'OK.': 'OK', TEXAS: 'TX', ARK: 'AR', IOWA: 'IA' };
const state = (v) => {
    const t = text(v);
    if (!t) return null;
    const upper = t.toUpperCase();
    if (/^OK\s+\d{5}$/.test(upper)) return 'OK';
    return STATE_NAMES[upper] || (/^[A-Z]{2}$/.test(upper) ? upper : t);
};

const main = async () => {
    const source = readCsv('ClientData.csv');
    const agents = new Map(readCsv('SupervisingAgent.csv').map(a => [Number(a.AgentId), text(a.FullName)]));
    agents.delete(0); // "None 0"

    // DOC numbers are unique here; values the old system reused (OCS, DHS, NONE, re-enrolled clients) go to comments
    const docCounts = {};
    for (const r of source) {
        const doc = text(r.DOC_Num);
        if (doc) docCounts[doc.toUpperCase()] = (docCounts[doc.toUpperCase()] || 0) + 1;
    }

    const db = await pool.connect();
    const warnings = [];
    try {
        await db.query('BEGIN');
        const groups = new Map((await db.query('SELECT GroupId, GroupName, ProgramType FROM Groups')).rows.map(g => [g.groupname, g]));
        for (const name of Object.values(GROUP_MAP)) if (!groups.has(name)) warnings.push(`Group "${name}" not found; its clients get no group`);

        const before = (await db.query('SELECT COUNT(*)::int AS n FROM Clients')).rows[0].n;
        // Clears Clients and every table that references it, and resets their ID sequences
        await db.query('TRUNCATE Clients RESTART IDENTITY CASCADE');
        // Cash deposit records point at payments by ID without a foreign key, so they would be orphaned
        await db.query('DELETE FROM CashPaymentDeposits');

        const stats = { clients: 0, discharges: 0, noGroup: 0, groupMismatch: 0, startDateMissing: 0, docMoved: 0, unknownPhase: 0, unknownStatus: 0, noAgent: 0 };
        const clients = [], discharges = [];
        for (const r of source) {
            if (!Number.isInteger(num(r.ClientId))) throw new Error(`Unreadable row in ClientData.csv: ${JSON.stringify(r).slice(0, 200)}`);
            const notes = [];
            const statusCode = num(r.ClientStatus);
            let programstatus = STATUS_MAP[statusCode];
            if (!programstatus) { programstatus = 'Inactive'; stats.unknownStatus++; notes.push(`Old status code: ${r.ClientStatus}`); }

            const phaseCode = num(r.TreatmentPhase);
            let [programtype, phase] = PHASE_MAP[phaseCode] || [];
            if (!phase) { programtype = null; phase = `Old phase ${r.TreatmentPhase}`; stats.unknownPhase++; }

            let groupid = null;
            const group = groups.get(GROUP_MAP[num(r.GroupId)]);
            if (!group) stats.noGroup++;
            else if (programtype && !(GROUP_TYPES_BY_PROGRAM[programtype] || []).includes((group.programtype || '').toUpperCase())) stats.groupMismatch++;
            else groupid = group.groupid;

            let docnumber = text(r.DOC_Num);
            if (docnumber && docCounts[docnumber.toUpperCase()] > 1) { notes.push(`Old DOC #: ${docnumber}`); docnumber = null; stats.docMoved++; }

            const supervisingagent = agents.get(num(r.PoId)) || null;
            if (!supervisingagent) stats.noAgent++;

            const lastdateattended = date(r.LastDateAttended);
            let programstartdate = date(r.DateStarted);
            if (!programstartdate) {
                programstartdate = lastdateattended || date(r.DischargeDate) || date(r.DateUpdated) || '1900-01-01';
                notes.push('Program start date was missing in the old system');
                stats.startDateMissing++;
            }

            // Phone and zip columns are 20 characters; longer old values ("405-..., wife cell") keep the first number
            // in the column and the full text in comments
            const fit = (label, v, pattern) => {
                const t = text(v);
                if (!t || t.length <= 20) return t;
                notes.push(`${label}: ${t}`);
                return (t.match(pattern) || [null])[0];
            };
            const phonePattern = /\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}/;
            let mainphone = fit('Home phone', r.HomePhone, phonePattern);
            let altphone = fit('Cell phone', r.CellPhone, phonePattern);
            if (!mainphone && altphone) { mainphone = altphone; altphone = null; }

            const balance = num(r.AcctBal) || 0;
            const comment = text(r.ClientComment);
            clients.push([
                num(r.ClientId), text(r.FirstName) || '(none)', text(r.MiddleName), text(r.LastName) || '(none)', docnumber,
                supervisingagent, programstartdate, lastdateattended, programstatus, phase, groupid,
                num(r.GroupFee) || 0, NEGATE_BALANCE ? -balance : balance, num(r.VoucherCount) || 0,
                text(r.Address), text(r.City), text(r.County), state(r.State), fit('Zip', r.Zip, /\d{5}(-\d{4})?/),
                mainphone, altphone, text(r.EmergancyContact), fit('Emergency contact phone', r.ContactPhone, phonePattern),
                [comment, ...notes].filter(Boolean).join('\n') || null, programtype,
            ]);
            stats.clients++;

            // Discharged clients get the discharge record the app writes when a client is discharged
            const dischargedOn = date(r.DischargeDate);
            if (dischargedOn && !['Active', 'Inactive'].includes(programstatus)) {
                discharges.push([num(r.ClientId), dischargedOn, programstatus, DISCHARGE_SUBCATEGORY[statusCode] || null,
                    `Imported from the old system (status: ${OLD_STATUS_NAMES[statusCode]})`, IMPORTED_BY]);
                stats.discharges++;
            }
        }

        const insertRows = async (table, columns, rows) => {
            const BATCH = 500;
            for (let i = 0; i < rows.length; i += BATCH) {
                const batch = rows.slice(i, i + BATCH);
                const params = batch.flat();
                const values = batch.map((row, r) => `(${row.map((_, c) => `$${r * row.length + c + 1}`).join(', ')})`).join(',\n');
                await db.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`, params);
            }
        };
        await insertRows('Clients', [
            'ClientId', 'FirstName', 'MiddleName', 'LastName', 'DocNumber',
            'SupervisingAgent', 'ProgramStartDate', 'LastDateAttended', 'ProgramStatus', 'Phase', 'GroupId',
            'TreatmentFee', 'AccountBalance', 'Vouchers',
            'Address', 'City', 'County', 'State', 'Zip',
            'MainPhone', 'AltPhone', 'EmergencyContact', 'EmergencyContactPhone',
            'Comments', 'ProgramType',
        ], clients);
        await insertRows('ClientDischarges', ['ClientId', 'DischargedOn', 'DischargeType', 'Subcategory', 'Note', 'DischargedBy'], discharges);
        // New clients added in the app continue after the highest imported ID
        await db.query(`SELECT setval('clients_clientid_seq', (SELECT MAX(ClientId) FROM Clients))`);

        const summary = `Imported ${stats.clients} clients from ${path.join(FOLDER, 'ClientData.csv')} (replaced ${before} existing clients).`;
        await db.query('INSERT INTO SystemLogs (UserEmail, Action, Details, Type) VALUES ($1, $2, $3, $4)',
            [IMPORTED_BY, 'Client Import', summary, 'Audit']);

        const check = (await db.query(`SELECT ProgramStatus, ProgramType, COUNT(*)::int AS n FROM Clients GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
        console.log(summary);
        console.log(stats);
        console.table(check);
        for (const w of warnings) console.warn('Warning:', w);

        if (COMMIT) {
            await db.query('COMMIT');
            console.log('Committed.');
        } else {
            await db.query('ROLLBACK');
            console.log('Dry run: rolled back, nothing was changed. Re-run with --commit to apply.');
        }
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        db.release();
    }
};

main()
    .catch(err => { console.error('Import failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
