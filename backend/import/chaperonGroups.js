// Creates the chaperon groups (the old system's nine chaperon groups, plus a federal one for Shawnee), puts the Chaperon
// clients in them by their old group, and links their old chaperon visits to the new groups. Run after assignChaperon.js.
//
//   node import/chaperonGroups.js [folder]            dry run: makes the changes in a transaction, reports, rolls back
//   node import/chaperonGroups.js [folder] --commit   same, then commits
//
// folder defaults to D:\DataImports and must hold ClientData.csv. Only groups with visits in 2025 or later start active.
// CHAPERON and FED CHAPERON groups both take Chaperon clients (like SO and FED SO); Federal Chaperon clients from the old
// Shawnee group go to Shawnee F-Chaperon. Visits the attendance import couldn't place carry "Old group: <name>." in their
// comments; those for the old chaperon groups get the new group and lose that note.
const { pool } = require('../db');
const { readCsv, num, ensureNotImported, logImport, runImport } = require('./csv');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const ACTION = 'Chaperon Groups';
const IMPORTED_BY = 'Data Import';

// Old GroupId -> new group. Counselor is the old group's therapist (TherpistId in GroupData.csv).
const GROUPS = [
    { old: 23, name: 'Shawnee Chaperon', location: 'Shawnee', counselor: 'Belinda Harris', type: 'CHAPERON', active: true },
    { old: 23, name: 'Shawnee F-Chaperon', location: 'Shawnee', counselor: 'Belinda Harris', type: 'FED CHAPERON', active: true, federal: true },
    { old: 78, name: 'Tulsa Chaperon', location: 'Tulsa', counselor: 'Belinda Harris', type: 'CHAPERON', active: true },
    { old: 71, name: 'Chaperon', location: '', counselor: 'Donna Burns', type: 'CHAPERON', active: true },
    { old: 32, name: 'Ada Chaperon', location: 'Ada', counselor: 'Belinda Harris', type: 'CHAPERON', active: false },
    { old: 22, name: 'Ardmore Chaperon', location: 'Ardmore', counselor: 'Donna Burns', type: 'CHAPERON', active: false },
    { old: 91, name: 'Lawton Chaperon', location: 'Lawton', counselor: 'Belinda Harris', type: 'CHAPERON', active: false },
    { old: 31, name: 'Okemah Chaperon', location: 'Okemah', counselor: 'Belinda Harris', type: 'CHAPERON', active: false },
    { old: 24, name: 'Sapulpa Chaperon', location: 'Sapulpa', counselor: 'Megan Smith', type: 'CHAPERON', active: false },
    { old: 28, name: 'Stillwater Chaperon', location: 'Stillwater', counselor: 'Donna Burns', type: 'CHAPERON', active: false },
];
const SCHEDULE = 'By Appointment';
// The attendance import's note for a visit it couldn't place, with the old name's spaces collapsed
const OLD_NAMES = { 23: 'Shawnee Chaperon', 78: 'Tulsa Chaperon', 71: 'Chaperon', 32: 'Ada Chaperon', 22: 'Ardmore Chaperon',
    91: 'Lawton Chaperon', 31: 'Okemah Chaperon', 24: 'Sapulpa Chaperon', 28: 'Stillwater Chaperon' };
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

runImport(pool, COMMIT, async (db) => {
    await ensureNotImported(db, ACTION);
    const existing = (await db.query('SELECT GroupName FROM Groups WHERE GroupName = ANY($1)', [GROUPS.map(g => g.name)])).rows;
    if (existing.length) throw new Error(`Groups already exist: ${existing.map(g => g.groupname).join(', ')}`);

    const ids = {};
    for (const g of GROUPS) {
        const r = await db.query(
            `INSERT INTO Groups (GroupName, Location, Counselor, ProgramType, Schedule, Address, Active) VALUES ($1, $2, $3, $4, $5, '', $6) RETURNING GroupId`,
            [g.name, g.location, g.counselor, g.type, SCHEDULE, g.active]);
        ids[g.name] = r.rows[0].groupid;
    }
    const newGroupFor = (oldGroup, federal) =>
        GROUPS.find(g => g.old === oldGroup && !!g.federal === federal) || GROUPS.find(g => g.old === oldGroup && !g.federal);

    // Clients: Chaperon clients by their old group
    const oldGroupOf = new Map(readCsv(FOLDER, 'ClientData.csv').rows.map(r => [num(r.ClientId), num(r.GroupId)]));
    const clients = (await db.query(`SELECT ClientId, LastName || ', ' || FirstName AS name, Phase, ProgramStatus, GroupId FROM Clients WHERE ProgramType = 'Chaperon'`)).rows;
    const assigned = [], unplaced = [];
    for (const c of clients) {
        const g = newGroupFor(oldGroupOf.get(c.clientid), c.phase === 'Federal Chaperon');
        if (!g || c.groupid) { unplaced.push({ id: c.clientid, name: c.name, status: c.programstatus, oldGroup: oldGroupOf.get(c.clientid), currentGroup: c.groupid }); continue; }
        await db.query('UPDATE Clients SET GroupId = $1 WHERE ClientId = $2', [ids[g.name], c.clientid]);
        await db.query(
            `INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details) VALUES ($1, $2, 'Group', NULL, $3, $4)`,
            [c.clientid, IMPORTED_BY, g.name, `Placed in the chaperon group matching their old-system group (${OLD_NAMES[g.old]}).`]);
        assigned.push({ id: c.clientid, name: c.name, status: c.programstatus, phase: c.phase, group: g.name });
    }

    // Visits: link the old chaperon groups' unplaced visits; a Federal Chaperon client's Shawnee visits go to Shawnee F-Chaperon
    const linked = {};
    for (const [old, oldName] of Object.entries(OLD_NAMES)) {
        const note = `Old group: ${oldName}.`;
        const rows = (await db.query(
            `SELECT a.AttendanceId AS id, a.Comments, c.Phase, c.ProgramType FROM Attendance a JOIN Clients c ON c.ClientId = a.Client
             WHERE a."Group" IS NULL AND a.Comments LIKE '%' || $1 || '%'`, [note])).rows;
        const strip = new RegExp(`\\s*${escapeRegex(note)}`);
        for (const r of rows) {
            const g = newGroupFor(Number(old), r.programtype === 'Chaperon' && r.phase === 'Federal Chaperon');
            const comments = r.comments.replace(strip, '').trim() || null;
            await db.query('UPDATE Attendance SET "Group" = $1, Comments = $2 WHERE AttendanceId = $3', [ids[g.name], comments, r.id]);
            linked[g.name] = (linked[g.name] || 0) + 1;
        }
    }

    const counts = (await db.query(
        `SELECT g.GroupName, g.ProgramType, g.Active,
                (SELECT COUNT(*) FROM Clients c WHERE c.GroupId = g.GroupId)::int AS clients,
                (SELECT COUNT(*) FROM Clients c WHERE c.GroupId = g.GroupId AND c.ProgramStatus = 'Active')::int AS active_clients
         FROM Groups g WHERE g.GroupId = ANY($1) ORDER BY g.Active DESC, g.GroupName`, [Object.values(ids)])).rows
        .map(r => ({ ...r, visits_linked: linked[r.groupname] || 0 }));
    const summary = `Created ${GROUPS.length} chaperon groups, placed ${assigned.length} Chaperon clients `
        + `(${assigned.filter(a => a.status === 'Active').length} active), linked ${Object.values(linked).reduce((a, b) => a + b, 0)} old visits.`;
    await logImport(db, ACTION, summary);
    console.log(summary);
    console.table(counts);
    console.log('Active clients placed:');
    console.table(assigned.filter(a => a.status === 'Active'));
    if (unplaced.length) { console.log('Not placed (old group was not a chaperon group, or already in a group):'); console.table(unplaced); }
})
    .catch(err => { console.error('Failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
