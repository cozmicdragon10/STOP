// Imports the old system's case notes (ClientNotes.csv) into Notes.
//
//   node --max-old-space-size=6144 import/importNotes.js [folder] [--commit]
//
// Dry run unless --commit; folder defaults to D:\DataImports. Run after the client import. Can only be committed once.
// Notes.User must be a current employee, so authors are matched to EmployeeRoles by name or email; notes by anyone else
// (former staff, "Admin 31", ...) have no User and start with "(Old system: name)" instead.
const { pool } = require('../db');
const { readCsv, text, num, timestamp, insertRows, employeeLookup, ensureNotImported, logImport, runImport } = require('./csv');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const ACTION = 'Notes Import';

// Note category from the author: polygraphers' notes are Polygraph, counselors' Therapist, office staff and "Admin ..."
// logins Admin. Unknown former staff default to Therapist, the category most old notes are.
const categoryFor = (oldUser, employee) => {
    if (employee) return employee.role === 'Polygrapher' ? 'Polygraph' : employee.role === 'Counselor' ? 'Therapist' : 'Admin';
    return /^admin\b/i.test(oldUser || '') ? 'Admin' : 'Therapist';
};

runImport(pool, COMMIT, async (db) => {
    await ensureNotImported(db, ACTION);
    const { rows } = readCsv(FOLDER, 'ClientNotes.csv');
    const clientIds = new Set((await db.query('SELECT ClientId FROM Clients')).rows.map(r => r.clientid));
    const findEmployee = await employeeLookup(db);

    const stats = { notes: 0, skippedEmpty: 0, skippedNoClient: 0, skippedNoDate: 0, linkedToEmployee: 0 };
    const authors = {};
    const notes = [];
    for (const r of rows) {
        const comments = text(r.Comments);
        const client = num(r.ClientId);
        const when = timestamp(r.Date);
        if (!comments) { stats.skippedEmpty++; continue; }
        if (!clientIds.has(client)) { stats.skippedNoClient++; continue; }
        if (!when) { stats.skippedNoDate++; continue; }
        const oldUser = text(r.User);
        const employee = findEmployee(oldUser);
        if (employee) stats.linkedToEmployee++;
        authors[oldUser || '(none)'] = employee ? employee.email : null;
        notes.push([client, when, employee?.email || null,
            employee || !oldUser ? comments : `(Old system: ${oldUser}) ${comments}`, categoryFor(oldUser, employee)]);
        stats.notes++;
    }
    await insertRows(db, 'Notes', ['Client', 'Date', '"User"', 'Comments', 'Category'], notes);

    const summary = `Imported ${stats.notes} case notes from ${FOLDER}\\ClientNotes.csv.`;
    await logImport(db, ACTION, summary);
    console.log(summary);
    console.log(stats);
    console.log('Old authors linked to employees:', Object.fromEntries(Object.entries(authors).filter(([, e]) => e)));
    console.log('Old authors kept as text:', Object.keys(authors).filter(a => !authors[a]).length);
    console.table((await db.query('SELECT Category, COUNT(*)::int AS n FROM Notes GROUP BY 1 ORDER BY 2 DESC')).rows);
})
    .catch(err => { console.error('Import failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
