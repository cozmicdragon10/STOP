// Puts the old system's money on clients' Financial Ledgers. Run after importAttendance.js (and the server start that
// adds FinancialTransactions.Imported, migration 095). Can only be committed once.
//
//   node --max-old-space-size=6144 import/importLedger.js [folder] [--commit]     dry run unless --commit
//
// Adds locked ledger rows marked Imported (no payment method; they can't be adjusted, refunded or moved):
//   - each imported check-in's fee and payment (Attendance rows with no CreatedBy and no ledger row yet), linked to it
//   - the old system's account-only entries from ClientAttendance.csv (payments with no check-in), which the attendance
//     import turned into Admin case notes; the notes stay
// Balances are not changed: account balances came from the old system already, and each row's balance after is the old
// system's balance after that entry (lib/oldLedger.js).
const { pool } = require('../db');
const { readCsv, text, num, date, timestamp, insertRows, ensureNotImported, logImport, runImport } = require('./csv');
const { checkInRows, accountRows } = require('../lib/oldLedger');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const ACTION = 'Ledger Import';
// The old system stored balances as payments minus charges (positive = credit); here a positive balance is owed
const owedFromOld = (acctTotal) => -(num(acctTotal) || 0);

const COLUMNS = ['Client', 'Date', 'Type', 'Amount', 'FeeType', 'FinalBalance', 'Comments', 'AttendanceId', 'Imported'];

runImport(pool, COMMIT, async (db) => {
    await ensureNotImported(db, ACTION);
    const hasColumn = (await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'financialtransactions' AND column_name = 'imported'`)).rows.length;
    if (!hasColumn) throw new Error('FinancialTransactions.Imported is missing: start the server once (migration 095) first.');

    const stats = { checkIns: 0, checkInRows: 0, accountEntries: 0, accountRows: 0, skippedNoClient: 0, skippedNoDate: 0 };
    const rows = [];
    const add = (client, at, attendanceId, built) => {
        for (const r of built) rows.push({ at, row: [client, at, r.type, r.amount, r.feeType, r.finalBalance, r.comments, attendanceId, true] });
    };

    // Imported check-ins (no CreatedBy) with money and no ledger row yet
    const checkIns = (await db.query(
        `SELECT a.AttendanceId, a.Client, COALESCE(a.Type, 'Group') AS Type, to_char(a.Date, 'YYYY-MM-DD') AS Day,
                to_char(COALESCE(a.CreatedOn, a.Date), 'YYYY-MM-DD HH24:MI:SS') AS At,
                a.GroupFee, a.AccountPaid, a.AccountTotal
         FROM Attendance a
         WHERE a.CreatedBy IS NULL AND (COALESCE(a.GroupFee, 0) <> 0 OR COALESCE(a.AccountPaid, 0) <> 0)
           AND NOT EXISTS (SELECT 1 FROM FinancialTransactions f WHERE f.AttendanceId = a.AttendanceId)`)).rows;
    for (const a of checkIns) {
        const built = checkInRows({ type: a.type, day: a.day, fee: a.groupfee, paid: a.accountpaid, finalOwed: a.accounttotal });
        if (!built.length) continue;
        add(a.client, a.at, a.attendanceid, built);
        stats.checkIns++;
        stats.checkInRows += built.length;
    }

    // Account-only entries, picked out by the same rules importAttendance.js used to turn them into notes
    const clientIds = new Set((await db.query('SELECT ClientId FROM Clients')).rows.map(r => r.clientid));
    for (const r of readCsv(FOLDER, 'ClientAttendance.csv', { freeText: 'Comments' }).rows) {
        const comment = text(r.Comments);
        if (comment && /^call[\s-]*in\b/i.test(comment)) continue;
        const fee = num(r.GroupFee) || 0, paid = num(r.Paid) || 0;
        const voucher = (num(r.Voucher) || 0) > 0;
        const accountOnly = comment && /^account\b/i.test(comment) && fee === 0 && !voucher;
        if ((num(r.GroupId) || 0) !== 0 && !accountOnly) continue;
        if (fee === 0 && paid === 0) continue;
        const client = num(r.ClientId);
        if (!clientIds.has(client)) { stats.skippedNoClient++; continue; }
        if (!date(r.Date)) { stats.skippedNoDate++; continue; }
        const built = accountRows({ fee, paid, finalOwed: owedFromOld(r.AcctTotal), comment });
        add(client, timestamp(r.Date), null, built);
        stats.accountEntries++;
        stats.accountRows += built.length;
    }

    // Oldest first, so each entry's rows keep their order and later rows get later IDs
    rows.sort((a, b) => a.at.localeCompare(b.at));
    await insertRows(db, 'FinancialTransactions', COLUMNS, rows.map(r => r.row));

    const summary = `Added ${stats.checkInRows} ledger rows for ${stats.checkIns} imported check-ins and ${stats.accountRows} for `
        + `${stats.accountEntries} old account entries from ${FOLDER}\\ClientAttendance.csv (marked Imported, locked).`;
    await logImport(db, ACTION, summary);
    console.log(summary);
    console.log(stats);
    console.table((await db.query(
        `SELECT Type, FeeType, COUNT(*)::int AS n, SUM(Amount)::numeric(14,2) AS amount
         FROM FinancialTransactions WHERE Imported GROUP BY 1, 2 ORDER BY 1, 2`)).rows);
})
    .catch(err => { console.error('Import failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
