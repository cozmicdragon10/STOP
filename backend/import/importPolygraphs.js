// Imports polygraph history and upcoming appointments from the old system. Run after the client import. Can only be
// committed once.
//
//   node import/importPolygraphs.js [folder] [--commit]     dry run unless --commit; folder defaults to D:\DataImports
//
//   ClientPolygraphs.csv -> PolygraphResults (every past result; these drive the NDI waiting period and voucher rules)
//   PolySchedule.csv     -> PolygraphSlots + PolygraphAppointments, only for appointments from today on. Past schedule
//                           entries are skipped: their outcomes are in ClientPolygraphs.
// Polygrapher must be a current employee, so old examiner names are matched to Polygrapher employees by surname
// (allowing one typo: "James Kellky"). Unmatched examiners are kept in the result's notes or the slot's comments.
const { pool } = require('../db');
const { readCsv, text, num, date, timestamp, insertRows, ensureNotImported, logImport, runImport } = require('./csv');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const ACTION = 'Polygraph Import';

// PolyTypes.csv and PolyResults.csv -> this app's values
const POLY_TYPES = { 1: 'Sexual History', 2: 'Maintenance', 3: 'Monitoring', 4: 'Instant' };
const POLY_RESULTS = {
    1: 'No Deception Indicated', 2: 'No Significant Response', 3: 'Inconclusive', 4: 'Deception Indicated',
    5: 'No Opinion', 6: 'Unable to Perform Test', 7: 'Other - See Test',
};

const editDistance = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return d[a.length][b.length];
};

runImport(pool, COMMIT, async (db) => {
    await ensureNotImported(db, ACTION);
    const clientIds = new Set((await db.query('SELECT ClientId FROM Clients')).rows.map(r => r.clientid));
    const examiners = (await db.query(`SELECT EmployeeEmail, DisplayName FROM EmployeeRoles WHERE Role = 'Polygrapher'`)).rows
        .map(e => ({ email: e.employeeemail, last: String(e.displayname).trim().split(/\s+/).pop().toLowerCase() }))
        .filter(e => e.last.length >= 4);
    const examinerCache = new Map();
    const examinerFor = (name) => {
        const t = text(name);
        if (!t) return null;
        if (!examinerCache.has(t)) {
            // Only the surname (last word) is compared, so a first name one letter off a surname (Marvin/Martin) doesn't match
            const surname = t.toLowerCase().split(/[^a-z]+/).filter(Boolean).pop() || '';
            const hits = examiners.filter(e => editDistance(surname, e.last) <= 1);
            examinerCache.set(t, hits.length === 1 ? hits[0].email : null);
        }
        return examinerCache.get(t);
    };

    // Past results
    const stats = { results: 0, resultsNoExaminer: 0, skippedNoClient: 0, skippedNoDate: 0, slots: 0, appointments: 0, bookedClientMissing: 0 };
    const results = [];
    for (const r of readCsv(FOLDER, 'ClientPolygraphs.csv', { freeText: 'PolyFileName' }).rows) {
        const client = num(r.ClientId);
        if (!clientIds.has(client)) { stats.skippedNoClient++; continue; }
        const day = date(r.Date);
        if (!day) { stats.skippedNoDate++; continue; }
        const oldExaminer = text(r.PolygrapherName);
        const examiner = examinerFor(oldExaminer);
        if (!examiner) stats.resultsNoExaminer++;
        const notes = [examiner || !oldExaminer ? '' : `Polygrapher: ${oldExaminer}.`, text(r.PolyFileName) ? `Old file: ${text(r.PolyFileName)}.` : '']
            .filter(Boolean).join(' ') || null;
        results.push([client, day, POLY_TYPES[num(r.PolyType)] || 'Maintenance', POLY_RESULTS[num(r.Results)] || 'Other - See Test',
            examiner, notes, timestamp(r.Date)]);
        stats.results++;
    }
    await insertRows(db, 'PolygraphResults', ['Client', 'Date', 'Type', 'Results', 'Polygrapher', 'Notes', 'PolygraphDateTime'], results);

    // Upcoming appointments: one slot per old schedule entry; booked entries also get a scheduled appointment
    const today = new Date().toLocaleDateString('en-CA');
    const upcoming = readCsv(FOLDER, 'PolySchedule.csv', { freeText: 'Comments' }).rows.filter(r => (date(r.Date) || '') >= today);
    for (const r of upcoming) {
        const when = timestamp(r.Date);
        const day = when.slice(0, 10), time = when.slice(11, 19);
        const oldExaminer = text(r.PolygrapherName);
        const examiner = examinerFor(oldExaminer);
        const type = POLY_TYPES[num(r.PolyTypeId)] || 'Maintenance';
        const client = num(r.ClientId);
        const booked = text(r.ActionButton) === 'Cancel' && client !== null;
        const clientFound = booked && clientIds.has(client);
        if (booked && !clientFound) stats.bookedClientMissing++;
        const comments = [
            text(r.Comments),
            examiner || !oldExaminer ? '' : `Polygrapher: ${oldExaminer}.`,
            booked && !clientFound ? `Booked in the old system for ${text(r.ClientName) || `client ${client}`}, who isn't in this app.` : '',
        ].filter(Boolean).join(' ') || null;
        const slot = await db.query(
            `INSERT INTO PolygraphSlots (Location, Address, Date, Time, Polygrapher, Type, Comments, IsFilled, SlotsAvailable)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1) RETURNING SlotId`,
            [text(r.GroupName) || 'Unknown', text(r.Location) || '', day, time, examiner, type, comments, clientFound]
        );
        stats.slots++;
        if (clientFound) {
            await db.query(
                `INSERT INTO PolygraphAppointments (SlotId, Client, ScheduledDateTime, Polygrapher, Type, Comments, LastPolyDate, Status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'Scheduled')`,
                [slot.rows[0].slotid, client, when, examiner, type, text(r.Comments), date(r.LastPoly)]
            );
            stats.appointments++;
        }
    }

    const summary = `Imported ${stats.results} polygraph results and ${stats.slots} upcoming polygraph slots (${stats.appointments} booked) from ${FOLDER}.`;
    await logImport(db, ACTION, summary);
    console.log(summary);
    console.log(stats);
    console.log('Examiner names matched to employees:', Object.fromEntries([...examinerCache].filter(([, e]) => e)));
    console.log('Examiner names kept as text:', [...examinerCache].filter(([, e]) => !e).map(([n]) => n).join(', '));
    console.table((await db.query('SELECT Results, COUNT(*)::int AS n FROM PolygraphResults GROUP BY 1 ORDER BY 2 DESC')).rows);
})
    .catch(err => { console.error('Import failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
