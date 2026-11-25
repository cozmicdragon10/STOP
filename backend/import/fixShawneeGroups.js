// One-time fix for databases imported before 2026-11-25, when the Shawnee Monday groups were mapped one number low.
// The old system's groups are numbered one higher here (user, 2026-11-25):
//   old 16 "Shawnee" -> Shawnee M-SO 1, old 141 "Shawnee MSO 1" -> Shawnee M-SO 2, old 27 "Shawnee MSO 2" -> Shawnee M-SO 3
// oldGroups.js now has the right map, so a fresh import doesn't need this script.
//
//   node import/fixShawneeGroups.js [folder]            dry run: makes the changes in a transaction, reports, rolls back
//   node import/fixShawneeGroups.js [folder] --commit   same, then commits
//
// folder defaults to D:\DataImports and must hold ClientData.csv.
// Clients move only if they are still in the group the import gave them (anyone moved by staff since stays put), and old
// "Shawnee" clients join M-SO 1 only if they have no group and their program takes SO groups, as the client import does.
// Imported visits (CreatedBy NULL) move with their group; old "Shawnee" visits lose their "Old group: Shawnee." note.
const { pool } = require('../db');
const { readCsv, num, ensureNotImported, logImport, runImport } = require('./csv');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const ACTION = 'Shawnee Group Mapping';
const IMPORTED_BY = 'Data Import';
const SO_PROGRAMS = ['State SO', 'Federal SO'];
const NOTE = 'Old group: Shawnee.';

// In order: each group is emptied of its imported rows before the next step fills it
const MOVES = [
    { old: 27, oldName: 'Shawnee MSO 2', from: 'Shawnee M-SO 2', to: 'Shawnee M-SO 3' },
    { old: 141, oldName: 'Shawnee MSO 1', from: 'Shawnee M-SO 1', to: 'Shawnee M-SO 2' },
    { old: 16, oldName: 'Shawnee', from: null, to: 'Shawnee M-SO 1' },
];

runImport(pool, COMMIT, async (db) => {
    await ensureNotImported(db, ACTION);
    const names = [...new Set(MOVES.map(m => m.to))];
    const ids = Object.fromEntries((await db.query('SELECT GroupName, GroupId FROM Groups WHERE GroupName = ANY($1)', [names])).rows
        .map(g => [g.groupname, g.groupid]));
    const missing = names.filter(n => !ids[n]);
    if (missing.length) throw new Error(`Groups not found: ${missing.join(', ')}`);
    const already = (await db.query(`SELECT COUNT(*)::int AS n FROM Attendance WHERE "Group" = $1 AND CreatedBy IS NULL`, [ids['Shawnee M-SO 3']])).rows[0].n;
    if (already) throw new Error(`Shawnee M-SO 3 already has ${already} imported visits; this database looks fixed already.`);

    const oldGroupOf = new Map(readCsv(FOLDER, 'ClientData.csv').rows.map(r => [num(r.ClientId), num(r.GroupId)]));
    const results = [];
    for (const m of MOVES) {
        const clientIds = [...oldGroupOf].filter(([, g]) => g === m.old).map(([id]) => id);
        const moved = m.from
            ? (await db.query(`UPDATE Clients SET GroupId = $1 WHERE ClientId = ANY($2) AND GroupId = $3 RETURNING ClientId, ProgramStatus`,
                [ids[m.to], clientIds, ids[m.from]])).rows
            : (await db.query(`UPDATE Clients SET GroupId = $1 WHERE ClientId = ANY($2) AND GroupId IS NULL AND ProgramType = ANY($3) RETURNING ClientId, ProgramStatus`,
                [ids[m.to], clientIds, SO_PROGRAMS])).rows;
        for (const c of moved) {
            await db.query(
                `INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details) VALUES ($1, $2, 'Group', $3, $4, $5)`,
                [c.clientid, IMPORTED_BY, m.from, m.to, `Old-system group "${m.oldName}" is ${m.to} here (group mapping fix).`]);
        }

        let visits;
        if (m.from) {
            visits = (await db.query(`UPDATE Attendance SET "Group" = $1 WHERE "Group" = $2 AND CreatedBy IS NULL`, [ids[m.to], ids[m.from]])).rowCount;
        } else {
            const rows = (await db.query(
                `SELECT AttendanceId AS id, Comments FROM Attendance WHERE "Group" IS NULL AND CreatedBy IS NULL AND Comments LIKE '%' || $1 || '%'`, [NOTE])).rows;
            for (const r of rows) {
                const comments = r.comments.replace(/\s*Old group: Shawnee\.(?=\s|$)/, '').trim() || null;
                await db.query('UPDATE Attendance SET "Group" = $1, Comments = $2 WHERE AttendanceId = $3', [ids[m.to], comments, r.id]);
            }
            visits = rows.length;
        }
        results.push({ old_group: `${m.old} ${m.oldName}`, now: m.to, old_clients: clientIds.length, clients_moved: moved.length,
            active_moved: moved.filter(c => c.programstatus === 'Active').length, visits_moved: visits });
    }

    const summary = results.map(r => `old "${r.old_group.replace(/^\d+ /, '')}" -> ${r.now}: ${r.clients_moved} clients `
        + `(${r.active_moved} active), ${r.visits_moved} visits`).join('; ');
    await logImport(db, ACTION, summary + '.');
    console.table(results);
    const counts = (await db.query(
        `SELECT g.GroupName,
                (SELECT COUNT(*) FROM Clients c WHERE c.GroupId = g.GroupId)::int AS clients,
                (SELECT COUNT(*) FROM Clients c WHERE c.GroupId = g.GroupId AND c.ProgramStatus = 'Active')::int AS active,
                (SELECT COUNT(*) FROM Attendance a WHERE a."Group" = g.GroupId)::int AS visits
         FROM Groups g WHERE g.GroupId = ANY($1) ORDER BY g.GroupName`, [Object.values(ids)])).rows;
    console.table(counts);
    const left = (await db.query(`SELECT COUNT(*)::int AS n FROM Attendance WHERE Comments LIKE '%' || $1 || '%'`, [NOTE])).rows[0].n;
    console.log(`Visits still carrying "${NOTE}": ${left}`);
}).then(() => pool.end()).catch(err => { console.error(err.message); pool.end(); process.exit(1); });
