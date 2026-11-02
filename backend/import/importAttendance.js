// Imports the old system's ClientAttendance.csv. Run after the client import. Can only be committed once.
//
//   node --max-old-space-size=6144 import/importAttendance.js [folder] [--commit]     dry run unless --commit
//
// The old table mixed several kinds of entries, which go to different places here:
//   - "CALL IN: ..." entries (mostly under old group 0) -> Call-In case notes, like the Call-In Log writes
//   - other group 0 entries and payment-only "ACCOUNT: ..." entries -> Admin case notes, with any amount in the text
//   - everything else -> Attendance history, with the amount paid and the balance after the visit
// No FinancialTransactions are created: the client import already set each account balance from the old system, so
// replaying old payments would count them twice.
// BIP clients also get a "BIP Intake" assessment dated their program start, since group check-in requires an intake on
// record and the old system didn't record one in a form this app can read.
const { pool } = require('../db');
const { readCsv, text, num, date, timestamp, insertRows, ensureNotImported, logImport, runImport } = require('./csv');
const { GROUP_MAP } = require('./oldGroups');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const ACTION = 'Attendance Import';
// The old system stored balances as payments minus charges (positive = credit); here a positive balance is owed
const NEGATE_BALANCE = true;

const money = (n) => `$${Number(n).toFixed(2)}`;

runImport(pool, COMMIT, async (db) => {
    await ensureNotImported(db, ACTION);
    const { rows } = readCsv(FOLDER, 'ClientAttendance.csv', { freeText: 'Comments' });
    const oldGroupNames = new Map(readCsv(FOLDER, 'GroupData.csv').rows.map(g => [num(g.GroupId), text(g.GroupName)?.replace(/\s+/g, ' ')]));
    const groupIds = new Map((await db.query('SELECT GroupId, GroupName FROM Groups')).rows.map(g => [g.groupname, g.groupid]));
    const clientIds = new Set((await db.query('SELECT ClientId FROM Clients')).rows.map(r => r.clientid));

    const stats = { attendance: 0, callInNotes: 0, accountNotes: 0, bipIntakes: 0, skippedNoClient: 0, skippedNoDate: 0, skippedEmpty: 0 };
    const attendance = [], notes = [];
    for (const r of rows) {
        const client = num(r.ClientId);
        if (!clientIds.has(client)) { stats.skippedNoClient++; continue; }
        const day = date(r.Date);
        if (!day) { stats.skippedNoDate++; continue; }
        const when = timestamp(r.Date);
        const comment = text(r.Comments);
        const oldGroup = num(r.GroupId) || 0;
        const paid = num(r.Paid) || 0, fee = num(r.GroupFee) || 0, poly = num(r.Poly) || 0;
        const voucher = (num(r.Voucher) || 0) > 0;

        // Call-ins, under any group
        if (comment && /^call[\s-]*in\b/i.test(comment)) {
            notes.push([client, when, `[Call-In Log]: ${comment.replace(/^call[\s-]*in\s*:?\s*/i, '')}`, 'Call-In']);
            stats.callInNotes++;
            continue;
        }
        // Group 0 entries and payment-only account entries aren't attendance
        const accountOnly = comment && /^account\b/i.test(comment) && fee === 0 && !voucher;
        if (oldGroup === 0 || accountOnly) {
            const amounts = [paid ? `${money(paid)} paid` : '', poly ? `${money(poly)} poly` : ''].filter(Boolean).join(', ');
            if (!comment && !amounts) { stats.skippedEmpty++; continue; }
            notes.push([client, when, `[Old system account entry]${amounts ? ` ${amounts}.` : ''} ${comment || ''}`.trim(), 'Admin']);
            stats.accountNotes++;
            continue;
        }

        const oldName = oldGroupNames.get(oldGroup) || `group ${oldGroup}`;
        const group = groupIds.get(GROUP_MAP[oldGroup]) || null;
        const type = /^assess/i.test(oldName) ? 'Assessment' : /^individual/i.test(oldName) ? 'Individual' : 'Group';
        const extra = [group ? '' : `Old group: ${oldName}.`, poly ? `Poly ${money(poly)}.` : ''].filter(Boolean).join(' ');
        const balance = num(r.AcctTotal) || 0;
        attendance.push([
            client, group, day, paid > 0, fee, paid, NEGATE_BALANCE ? -balance : balance, voucher, type,
            [comment, extra].filter(Boolean).join(' ') || null, when,
        ]);
        stats.attendance++;
    }

    // BIP intake on record for every BIP client, dated their program start
    const bip = (await db.query(`SELECT ClientId, ProgramStartDate FROM Clients WHERE ProgramType = 'BIP'`)).rows;
    const intakeType = (await db.query(`SELECT SessionTypeId FROM SessionTypes WHERE Kind = 'BIP Intake' AND Name = 'BIP Intake'`)).rows[0];
    if (!intakeType) throw new Error('No "BIP Intake" session type found.');
    const intakes = bip.map(c => {
        const start = c.programstartdate instanceof Date ? c.programstartdate.toLocaleDateString('en-CA') : String(c.programstartdate).slice(0, 10);
        return [c.clientid, start, 'Assessment', intakeType.sessiontypeid, 'BIP intake completed in the old system (added by the data import).', `${start} 00:00:00`];
    });
    stats.bipIntakes = intakes.length;

    await insertRows(db, 'Attendance',
        ['Client', '"Group"', 'Date', 'Paid', 'GroupFee', 'AccountPaid', 'AccountTotal', 'VoucherUsed', 'Type', 'Comments', 'CreatedOn'],
        attendance);
    await insertRows(db, 'Attendance', ['Client', 'Date', 'Type', 'SessionTypeId', 'Comments', 'CreatedOn'], intakes);
    await insertRows(db, 'Notes', ['Client', 'Date', 'Comments', 'Category'], notes);

    const summary = `Imported ${stats.attendance} attendance rows, ${stats.callInNotes} call-in notes and ${stats.accountNotes} account notes from ${FOLDER}\\ClientAttendance.csv; added ${stats.bipIntakes} BIP intakes.`;
    await logImport(db, ACTION, summary);
    console.log(summary);
    console.log(stats);
    console.table((await db.query(`SELECT Type, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE "Group" IS NULL)::int AS no_group FROM Attendance GROUP BY 1 ORDER BY 2 DESC`)).rows);
    // Active BIP clients the check-in rules would still block
    const { BIP_CHECKIN_BLOCK } = require('../lib/sql');
    const blocked = (await db.query(`SELECT COUNT(*)::int AS n FROM Clients c WHERE c.ProgramStatus = 'Active' AND (${BIP_CHECKIN_BLOCK}) IS NOT NULL`)).rows[0].n;
    console.log(`Active BIP clients still blocked from group check-in: ${blocked}`);
})
    .catch(err => { console.error('Import failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
