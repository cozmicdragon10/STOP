// Reads the old SQL Server system's CSV exports (see D:\DataImports) and shared helpers for the import scripts.
const fs = require('fs');
const path = require('path');

// The old export didn't always quote free-text columns, so a comment can run onto following lines and contain commas or
// stray quotes. A quote only starts a quoted field at the very start of the field. A line starts a new record only when it
// begins with a numeric ID and the record so far has every column; otherwise it continues the current field. Extra
// fields are joined back into freeText (default: the last column). Returns { rows, merged } where merged counts the
// records that needed extra fields joined back.
const readCsv = (folder, file, { freeText } = {}) => {
    const lines = fs.readFileSync(path.join(folder, file), 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const at = freeText === undefined ? header.length - 1 : header.indexOf(freeText);
    if (at < 0) throw new Error(`${file} has no ${freeText} column`);

    const rows = [];
    let merged = 0;
    let fields = null, field = '', quoted = false;
    const finish = () => {
        fields.push(field);
        const extra = fields.length - header.length;
        if (extra > 0) {
            merged++;
            fields = [...fields.slice(0, at), fields.slice(at, at + extra + 1).join(','), ...fields.slice(at + extra + 1)];
        }
        rows.push(Object.fromEntries(header.map((h, i) => [h, fields[i]])));
        fields = null;
    };
    for (const line of lines.slice(1)) {
        if (fields !== null) {
            if (!quoted && fields.length + 1 >= header.length && /^\d+,/.test(line)) finish();
            else field += '\n';
        }
        if (fields === null) {
            if (line.trim() === '') continue;
            fields = []; field = ''; quoted = false;
        }
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quoted) {
                if (ch !== '"') field += ch;
                else if (line[i + 1] === '"') { field += '"'; i++; }
                else quoted = false;
            } else if (ch === '"' && field === '') quoted = true;
            else if (ch === ',') { fields.push(field); field = ''; }
            else field += ch;
        }
    }
    if (fields !== null) finish();
    return { rows, merged };
};

// 'NULL', blanks and the old system's ' ' defaults become null
const text = (v) => (v === undefined || v === null || v === 'NULL' || v.trim() === '') ? null : v.trim();
const num = (v) => {
    const t = text(v);
    return t === null || isNaN(Number(t)) ? null : Number(t);
};
// 'YYYY-MM-DD hh:mm:ss.fff' -> 'YYYY-MM-DD'; the old 1753/1800-01-01 "no date" placeholders become null
const date = (v) => {
    const t = text(v);
    return t && /^\d{4}-\d{2}-\d{2}/.test(t) && t.slice(0, 4) >= '1900' ? t.slice(0, 10) : null;
};
// 'YYYY-MM-DD hh:mm:ss.fff' -> 'YYYY-MM-DD hh:mm:ss' (local time, as the old system stored it)
const timestamp = (v) => (date(v) ? text(v).slice(0, 19) : null);

// Batched multi-row INSERT; rows are arrays in column order
const insertRows = async (db, table, columns, rows, batchSize = 1000) => {
    const perBatch = Math.max(1, Math.min(batchSize, Math.floor(60000 / columns.length)));
    for (let i = 0; i < rows.length; i += perBatch) {
        const batch = rows.slice(i, i + perBatch);
        const values = batch.map((row, r) => `(${row.map((_, c) => `$${r * columns.length + c + 1}`).join(', ')})`).join(',\n');
        await db.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}`, batch.flat());
    }
};

// Old login names ("bev", "MWhite") -> { email, role } from EmployeeRoles, matched on full display name, first name, or the
// email's name part ("mwhite" in mwhite.chandlerandassociates@...). Names matching no employee, or more than one, give
// null; callers keep the old name in the record's text instead.
const employeeLookup = async (db) => {
    const employees = (await db.query('SELECT EmployeeEmail, DisplayName, Role FROM EmployeeRoles')).rows;
    const index = new Map();
    const add = (k, e) => {
        if (!k) return;
        const prev = index.get(k);
        index.set(k, prev === undefined || prev?.employeeemail === e.employeeemail ? e : null);
    };
    for (const e of employees) {
        const display = String(e.displayname || '').trim().toLowerCase();
        add(display, e);
        add(display.split(/\s+/)[0], e);
        add(e.employeeemail.toLowerCase().split('@')[0].split(/[._]/)[0], e);
    }
    return (name) => {
        const e = index.get(String(name || '').trim().toLowerCase());
        return e ? { email: e.employeeemail, role: e.role } : null;
    };
};

// Each import writes one SystemLogs entry with its action name. Throws if that import was already committed, since running
// it twice would duplicate its rows.
const ensureNotImported = async (db, action) => {
    const prior = await db.query(`SELECT Timestamp FROM SystemLogs WHERE UserEmail = 'Data Import' AND Action = $1 LIMIT 1`, [action]);
    if (prior.rows.length) throw new Error(`${action} already ran on ${prior.rows[0].timestamp}. Restore a backup from before it to run it again.`);
};
const logImport = (db, action, details) => db.query(
    'INSERT INTO SystemLogs (UserEmail, Action, Details, Type) VALUES ($1, $2, $3, $4)', ['Data Import', action, details, 'Audit']);

// Runs work(db) in a transaction: commits with --commit, otherwise reports and rolls back
const runImport = async (pool, commit, work) => {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        await work(db);
        if (commit) {
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

module.exports = { readCsv, text, num, date, timestamp, insertRows, employeeLookup, ensureNotImported, logImport, runImport };
