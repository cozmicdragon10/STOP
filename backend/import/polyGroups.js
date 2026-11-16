// Creates the two Polys groups (the old system's "Polygraphs" group, now Polys East, and "Tulsa Polys - North", now
// Polys North), and puts the Poly Only clients in them by their old group. Run after importClients.js.
//
//   node import/polyGroups.js [folder]            dry run: makes the changes in a transaction, reports, rolls back
//   node import/polyGroups.js [folder] --commit   same, then commits
//
// folder defaults to D:\DataImports and must hold ClientData.csv. Poly Only clients (old phase 35, Federal Polygraphs)
// go to the group they were in the old system; the old Sapulpa Polys group had no clients, so it isn't made.
// Counselors are the old groups' therapists (TherpistId in GroupData.csv: 1 Holly Chandler, 30 Charlie Pope).
const { pool } = require('../db');
const { readCsv, num, ensureNotImported, logImport, runImport } = require('./csv');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const ACTION = 'Polys Groups';
const IMPORTED_BY = 'Data Import';

// Old GroupId -> new group. Location is blank for Polys East: the old group had none.
const GROUPS = [
    { old: 118, name: 'Polys East', location: '', counselor: 'Holly Chandler', type: 'POLY', active: true },
    { old: 136, name: 'Polys North', location: 'Tulsa', counselor: 'Charlie Pope', type: 'POLY', active: true },
];
const SCHEDULE = 'By Appointment';
const POLY_ONLY_PHASE = 'Polygraphs';

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
    const newGroupFor = (oldGroup) => GROUPS.find(g => g.old === oldGroup);

    // Clients: Poly Only clients by their old group
    const oldGroupOf = new Map(readCsv(FOLDER, 'ClientData.csv').rows.map(r => [num(r.ClientId), num(r.GroupId)]));
    const clients = (await db.query(
        `SELECT ClientId, LastName || ', ' || FirstName AS name, ProgramStatus, GroupId FROM Clients WHERE ProgramType = 'Poly Only' AND Phase = $1`,
        [POLY_ONLY_PHASE])).rows;
    const assigned = [], unplaced = [];
    for (const c of clients) {
        const g = newGroupFor(oldGroupOf.get(c.clientid));
        if (!g || c.groupid) { unplaced.push({ id: c.clientid, name: c.name, status: c.programstatus, oldGroup: oldGroupOf.get(c.clientid), currentGroup: c.groupid }); continue; }
        await db.query('UPDATE Clients SET GroupId = $1 WHERE ClientId = $2', [ids[g.name], c.clientid]);
        await db.query(
            `INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details) VALUES ($1, $2, 'Group', NULL, $3, $4)`,
            [c.clientid, IMPORTED_BY, g.name, `Placed in the polys group matching their old-system group (${g.old === 118 ? 'Polygraphs' : 'Tulsa Polys - North'}).`]);
        assigned.push({ id: c.clientid, name: c.name, status: c.programstatus, group: g.name });
    }

    const counts = (await db.query(
        `SELECT g.GroupName, g.ProgramType, g.Active,
                (SELECT COUNT(*) FROM Clients c WHERE c.GroupId = g.GroupId)::int AS clients,
                (SELECT COUNT(*) FROM Clients c WHERE c.GroupId = g.GroupId AND c.ProgramStatus = 'Active')::int AS active_clients
         FROM Groups g WHERE g.GroupId = ANY($1) ORDER BY g.GroupName`, [Object.values(ids)])).rows;
    const summary = `Created ${GROUPS.length} polys groups, placed ${assigned.length} Poly Only clients (${assigned.filter(a => a.status === 'Active').length} active).`;
    await logImport(db, ACTION, summary);
    console.log(summary);
    console.table(counts);
    if (unplaced.length) { console.log('Not placed (no matching old group, or already in a group):'); console.table(unplaced); }
})
    .catch(err => { console.error('Failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
