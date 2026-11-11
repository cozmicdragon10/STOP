// Creates one INDIVIDUAL group per counselor from the old system's "Individual(s) - X" groups, puts the clients whose old
// group was one of them in it, and links the old individual visits to the new groups (with the counselor as Provider).
//
//   node import/individualGroups.js [folder]            dry run: makes the changes in a transaction, reports, rolls back
//   node import/individualGroups.js [folder] --commit   same, then commits
//
// folder defaults to D:\DataImports and must hold ClientData.csv. Groups for current counselors start active; the rest
// (former employees) are inactive and keep the history. Visits the attendance import couldn't place carry
// "Old group: <name>." in their comments; those for the old individual groups get the new group and lose that note.
const { pool } = require('../db');
const { readCsv, num, ensureNotImported, logImport, runImport } = require('./csv');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const ACTION = 'Individual Groups';
const IMPORTED_BY = 'Data Import';
const TYPE = 'INDIVIDUAL';
const SCHEDULE = 'By Appointment';

// Old GroupId -> counselor, from the old group's name (its TherpistId doesn't always match the name)
const GROUPS = [
    { old: 35, oldName: 'Individual - AMartinez', counselor: 'Alicia Martinez', active: true },
    { old: 56, oldName: 'Individual - BHarris', counselor: 'Belinda Harris', active: true },
    { old: 142, oldName: 'Individual - KMcCoy', counselor: 'Kelly McCoy', active: true },
    { old: 94, oldName: 'Individual - MBlake', counselor: 'Monte Blake', active: true },
    { old: 116, oldName: 'Individual - MPorter', counselor: 'Marsha Porter', active: true },
    { old: 140, oldName: 'Individual - MSnipes', counselor: 'Melissa Snipes', active: true },
    { old: 57, oldName: 'Individuals - DBurns', counselor: 'Donna Burns', active: false },
    { old: 98, oldName: 'Individuals - DG', counselor: 'Debra Grayson', active: false },
    { old: 104, oldName: 'Individuals - Holly', counselor: 'Holly Morrell', active: false },
    { old: 95, oldName: 'Individuals - JThomas', counselor: 'John Thomas', active: false },
    { old: 149, oldName: 'Individuals - KLewis-Vick', counselor: 'Keisha Lewis-Vick', active: false },
    { old: 112, oldName: 'Individuals - MClower', counselor: 'Misty Clower', active: false },
    { old: 125, oldName: 'Individuals - MLaFave', counselor: 'Melissa LaFave', active: false },
    { old: 83, oldName: 'Individuals - MSmith', counselor: 'Megan Smith', active: false },
    { old: 79, oldName: 'Individuals - SSmith', counselor: 'Sherry Smith', active: false },
].map(g => ({ ...g, name: `Individual - ${g.counselor}` }));
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

runImport(pool, COMMIT, async (db) => {
    await ensureNotImported(db, ACTION);
    const existing = (await db.query('SELECT GroupName FROM Groups WHERE GroupName = ANY($1)', [GROUPS.map(g => g.name)])).rows;
    if (existing.length) throw new Error(`Groups already exist: ${existing.map(g => g.groupname).join(', ')}`);

    const ids = {};
    for (const g of GROUPS) {
        const r = await db.query(
            `INSERT INTO Groups (GroupName, Location, Counselor, ProgramType, Schedule, Address, Active) VALUES ($1, '', $2, $3, $4, '', $5) RETURNING GroupId`,
            [g.name, g.counselor, TYPE, SCHEDULE, g.active]);
        ids[g.old] = r.rows[0].groupid;
    }
    const byOld = new Map(GROUPS.map(g => [g.old, g]));

    // Clients: everyone whose old group was an individual group; a client already in a group is left there
    const oldGroupOf = new Map(readCsv(FOLDER, 'ClientData.csv').rows.map(r => [num(r.ClientId), num(r.GroupId)]));
    const candidates = [...oldGroupOf].filter(([, og]) => byOld.has(og)).map(([id]) => id);
    const clients = (await db.query(
        `SELECT ClientId, LastName || ', ' || FirstName AS name, ProgramType, ProgramStatus, GroupId FROM Clients WHERE ClientId = ANY($1)`, [candidates])).rows;
    const assigned = [], unplaced = [];
    for (const c of clients) {
        const g = byOld.get(oldGroupOf.get(c.clientid));
        if (c.groupid) { unplaced.push({ id: c.clientid, name: c.name, status: c.programstatus, oldGroup: g.oldName, currentGroup: c.groupid }); continue; }
        await db.query('UPDATE Clients SET GroupId = $1 WHERE ClientId = $2', [ids[g.old], c.clientid]);
        await db.query(
            `INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details) VALUES ($1, $2, 'Group', NULL, $3, $4)`,
            [c.clientid, IMPORTED_BY, g.name, `Placed in the individual group matching their old-system group (${g.oldName}).`]);
        assigned.push({ id: c.clientid, name: c.name, status: c.programstatus, program: c.programtype, group: g.name });
    }

    // Visits: link the old individual groups' unplaced visits and record the counselor as the session's provider
    const linked = {};
    for (const g of GROUPS) {
        const note = `Old group: ${g.oldName}.`;
        const rows = (await db.query(
            `SELECT AttendanceId AS id, Comments FROM Attendance WHERE "Group" IS NULL AND Comments LIKE '%' || $1 || '%'`, [note])).rows;
        const strip = new RegExp(`\\s*${escapeRegex(note)}`);
        for (const r of rows) {
            const comments = r.comments.replace(strip, '').trim() || null;
            await db.query('UPDATE Attendance SET "Group" = $1, Comments = $2, Provider = COALESCE(Provider, $3) WHERE AttendanceId = $4',
                [ids[g.old], comments, g.counselor, r.id]);
        }
        linked[g.name] = rows.length;
    }

    const counts = (await db.query(
        `SELECT g.GroupName, g.Active,
                (SELECT COUNT(*) FROM Clients c WHERE c.GroupId = g.GroupId)::int AS clients,
                (SELECT COUNT(*) FROM Clients c WHERE c.GroupId = g.GroupId AND c.ProgramStatus = 'Active')::int AS active_clients
         FROM Groups g WHERE g.GroupId = ANY($1) ORDER BY g.Active DESC, g.GroupName`, [Object.values(ids)])).rows
        .map(r => ({ ...r, visits_linked: linked[r.groupname] || 0 }));
    const summary = `Created ${GROUPS.length} individual groups, placed ${assigned.length} clients `
        + `(${assigned.filter(a => a.status === 'Active').length} active), linked ${Object.values(linked).reduce((a, b) => a + b, 0)} old visits.`;
    await logImport(db, ACTION, summary);
    console.log(summary);
    console.table(counts);
    console.log('Active clients placed:');
    console.table(assigned.filter(a => a.status === 'Active'));
    if (unplaced.length) { console.log('Not placed (already in a group):'); console.table(unplaced); }
})
    .catch(err => { console.error('Failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
