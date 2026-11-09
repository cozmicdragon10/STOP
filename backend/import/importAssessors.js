// Brings over the old system's per-counselor assessment groups ("Assessment - BHarris", ...) without making groups: the app
// records assessments as sessions, so instead
//   - active clients still in an old assessment group get that counselor as their Assessor (Waiting for Assessment list)
//   - old assessment visits get that counselor as their Provider, in place of the "Old group: ..." note
// Run after the client and attendance imports and migration 050.
//
//   node import/importAssessors.js [folder]            dry run: makes the changes in a transaction, reports, rolls back
//   node import/importAssessors.js [folder] --commit   same, then commits
const { pool } = require('../db');
const { readCsv, num, text, ensureNotImported, logImport, runImport } = require('./csv');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const ACTION = 'Assessor Import';
const IMPORTED_BY = 'Data Import';

// Old assessment GroupId -> the counselor it belonged to (from the group's name; current employees' display names where
// they still work here). Old group 47 "Assessments - HM" was Holly Morrell (former employee; added 2026-11-09 after the first run).
const ASSESSORS = {
    47: 'Holly Morrell',
    30: 'Belinda Harris', 110: 'Alicia Martinez', 103: 'Kelly McCoy', 74: 'Monte Blake', 129: 'Melissa Snipes', 108: 'Marsha Porter',
    48: 'Donna Burns', 55: 'Melissa LaFave', 63: 'Megan Smith', 77: 'Sherry Smith', 97: 'John Thomas', 111: 'Misty Clower',
    115: 'Holly Chandler', 120: 'Eric Armstrong', 148: 'Keisha Lewis-Vick',
};
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

runImport(pool, COMMIT, async (db) => {
    await ensureNotImported(db, ACTION);
    // Old names with spaces collapsed, as the attendance import wrote them into its "Old group: <name>." note
    const oldNames = new Map(readCsv(FOLDER, 'GroupData.csv').rows.map(g => [num(g.GroupId), text(g.GroupName)?.replace(/\s+/g, ' ')]));

    // Clients: active, still in an old assessment group, and not in a group here
    const oldGroupOf = new Map(readCsv(FOLDER, 'ClientData.csv').rows.map(r => [num(r.ClientId), num(r.GroupId)]));
    const clients = (await db.query(
        `SELECT ClientId, LastName || ', ' || FirstName AS name, ProgramType, Phase, GroupId, Assessor FROM Clients WHERE ProgramStatus = 'Active'`)).rows;
    const assigned = [], skipped = [];
    for (const c of clients) {
        const assessor = ASSESSORS[oldGroupOf.get(c.clientid)];
        if (!assessor) continue;
        if (c.groupid || c.assessor) { skipped.push({ id: c.clientid, name: c.name, assessor, groupid: c.groupid, current: c.assessor }); continue; }
        await db.query('UPDATE Clients SET Assessor = $1 WHERE ClientId = $2', [assessor, c.clientid]);
        await db.query(
            `INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details) VALUES ($1, $2, 'Assessor', 'None', $3, $4)`,
            [c.clientid, IMPORTED_BY, assessor, `Waiting for assessment in the old system (${oldNames.get(oldGroupOf.get(c.clientid))}).`]);
        assigned.push({ id: c.clientid, name: c.name, program: `${c.programtype ?? '(none)'} / ${c.phase}`, assessor });
    }

    // Visits: the counselor becomes the provider; the note naming the old group goes
    const linked = {};
    for (const [old, assessor] of Object.entries(ASSESSORS)) {
        const note = `Old group: ${oldNames.get(Number(old))}.`;
        const rows = (await db.query(
            `SELECT AttendanceId AS id, Comments FROM Attendance WHERE "Group" IS NULL AND Provider IS NULL AND Comments LIKE '%' || $1 || '%'`, [note])).rows;
        const strip = new RegExp(`\\s*${escapeRegex(note)}`);
        for (const r of rows) {
            await db.query('UPDATE Attendance SET Provider = $1, Comments = $2 WHERE AttendanceId = $3',
                [assessor, r.comments.replace(strip, '').trim() || null, r.id]);
        }
        linked[assessor] = (linked[assessor] || 0) + rows.length;
    }

    const byAssessor = {};
    for (const a of assigned) byAssessor[a.assessor] = (byAssessor[a.assessor] || 0) + 1;
    const visits = Object.values(linked).reduce((a, b) => a + b, 0);
    const summary = `Set the assessor for ${assigned.length} active clients waiting for an assessment; set the provider on ${visits} old assessment visits.`;
    await logImport(db, ACTION, summary);
    console.log(summary);
    console.table(Object.entries(byAssessor).map(([assessor, clients]) => ({ assessor, clients, visits: linked[assessor] || 0 })));
    console.table(Object.entries(linked).filter(([a]) => !byAssessor[a]).map(([assessor, visits]) => ({ assessor, visits })));
    console.table(assigned);
    if (skipped.length) { console.log('Left alone (already in a group or has an assessor):'); console.table(skipped); }
})
    .catch(err => { console.error('Failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
