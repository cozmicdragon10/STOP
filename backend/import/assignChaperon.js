// Moves the old system's chaperon clients into the Chaperon program.
//
//   node import/assignChaperon.js [folder]            dry run: makes the changes in a transaction, reports, rolls back
//   node import/assignChaperon.js [folder] --commit   same, then commits
//
// folder defaults to D:\DataImports and must hold ClientData.csv. Chaperon clients are the ones whose old TreatmentPhase was
// 19 (Chaperon) or 36 (Federal Chaperon). importClients.js first brought them in as no program / "Chaperon" and as Federal SO /
// Phase 1 - Weekly; they become ProgramType Chaperon with phase Chaperon or Federal Chaperon. Clients whose program was
// changed in the app since the import are left alone and listed. Chaperon clients don't take polygraphs, so any booked
// upcoming polygraph slot is listed for the office to cancel. Each change goes in the client's Change Log.
const { pool } = require('../db');
const { readCsv, num, ensureNotImported, logImport, runImport } = require('./csv');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const ACTION = 'Chaperon Program';
const IMPORTED_BY = 'Data Import';
// Old TreatmentPhase -> [program type the client import gave them, phase it gave them, new Chaperon phase]
const OLD_PHASES = {
    19: [null, 'Chaperon', 'Chaperon'],
    36: ['Federal SO', 'Phase 1 - Weekly', 'Federal Chaperon'],
};

runImport(pool, COMMIT, async (db) => {
    await ensureNotImported(db, ACTION);
    const old = readCsv(FOLDER, 'ClientData.csv').rows.filter(r => OLD_PHASES[num(r.TreatmentPhase)]);
    const oldPhase = new Map(old.map(r => [num(r.ClientId), num(r.TreatmentPhase)]));
    const clients = (await db.query(
        'SELECT ClientId, FirstName, LastName, ProgramType, Phase, ProgramStatus, Pretrial FROM Clients WHERE ClientId = ANY($1) ORDER BY ClientId',
        [[...oldPhase.keys()]])).rows;

    const moved = [], skipped = [];
    for (const c of clients) {
        const [importedType, importedPhase, newPhase] = OLD_PHASES[oldPhase.get(c.clientid)];
        const name = `${c.lastname}, ${c.firstname}`;
        if ((c.programtype ?? null) !== importedType || c.phase !== importedPhase) {
            skipped.push({ id: c.clientid, name, status: c.programstatus, program: c.programtype, phase: c.phase });
            continue;
        }
        await db.query("UPDATE Clients SET ProgramType = 'Chaperon', Phase = $1, Pretrial = false WHERE ClientId = $2", [newPhase, c.clientid]);
        await db.query(
            `INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details)
             VALUES ($1, $2, 'Program Type', $3, 'Chaperon', $4)`,
            [c.clientid, IMPORTED_BY, c.programtype, `Old system phase: ${newPhase}. Phase ${c.phase} -> ${newPhase}.`]);
        moved.push({ id: c.clientid, name, status: c.programstatus, from: `${c.programtype ?? '(none)'} / ${c.phase}`, to: newPhase });
    }

    // Upcoming polygraphs already booked for clients who are now Chaperon
    const booked = (await db.query(
        `SELECT s.SlotId, to_char(s.Date, 'YYYY-MM-DD') AS date, c.ClientId, c.LastName || ', ' || c.FirstName AS name
         FROM PolygraphSlots s
         JOIN PolygraphAppointments a ON a.SlotId = s.SlotId AND a.Status = 'Scheduled'
         JOIN Clients c ON c.ClientId = a.Client
         WHERE c.ProgramType = 'Chaperon' AND s.Date >= CURRENT_DATE ORDER BY s.Date`)).rows;

    const count = (status) => moved.filter(m => m.status === status).length;
    const summary = `Moved ${moved.length} old-system chaperon clients to the Chaperon program (${count('Active')} active); `
        + `${skipped.length} left alone because their program changed since the import.`;
    await logImport(db, ACTION, summary);
    console.log(summary);
    console.log('Active clients moved:');
    console.table(moved.filter(m => m.status === 'Active'));
    const byChange = {};
    for (const m of moved) byChange[`${m.status} | ${m.from} -> ${m.to}`] = (byChange[`${m.status} | ${m.from} -> ${m.to}`] || 0) + 1;
    console.table(byChange);
    if (skipped.length) { console.log('Left alone:'); console.table(skipped); }
    if (booked.length) { console.log('Upcoming polygraphs booked for Chaperon clients (cancel these):'); console.table(booked); }
    else console.log('No upcoming polygraphs are booked for Chaperon clients.');
})
    .catch(err => { console.error('Failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
