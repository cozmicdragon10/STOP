// One-time cleanup (run after migration 064): sets each client's ID type (DocType) from what was typed into the number,
// and takes that prefix off the number. Only clear patterns are changed; anything else is left exactly as it was with
// no type. Run with --apply to save; without it, it only shows what it would do.
//   node import/splitIdTypes.js           (dry run)
//   node import/splitIdTypes.js --apply
const { pool } = require('../db');
const { logClientChange } = require('../lib/changeLog');

const apply = process.argv.includes('--apply');
const CHANGED_BY = 'ID # cleanup';

// [type, pattern, how to get the number from the match]. The first pattern that matches wins.
const RULES = [
    // "581422"
    ['DOC', /^\s*(\d+)\s*$/, m => m[1]],
    // "DOC 238842", "DOC# 238842", "DOC - 238842"
    ['DOC', /^\s*DOC\s*[#:.\-]*\s*(\d+)\s*$/i, m => m[1]],
    // "Pacts 1423371 PB", "PACTS#: 7708503", "Fed Pacts #6664", "Federal PACTS #26202", "Pacts PB 10011923", "PACT 6592"
    ['PACTS', /^\s*(?:fed(?:eral)?\.?\s+)?pacts?\s*[#:.\-]*\s*([A-Z]{0,2}\s*\d[\w\s\-]*?)\s*$/i, m => m[1].replace(/\s+/g, ' ')],
    // "CM-2019-26340", "CF - 15-152", "CM 2016 - 18": the CM/CF stays on the number
    ['Case #', /^\s*((?:CM|CF)\s*-?\s*\d[\d\s\-]*?)\s*$/i, m => m[1].toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ')],
    // "OCS 8002620", "OCS - 704572" (not "OCS DOC 103994": it could be either, so it is left to set by hand)
    ['OCS', /^\s*OCS\s*[#:.\-]*\s*(\d+)\s*$/i, m => m[1]],
    // "DHS - 2058273"
    ['DHS', /^\s*DHS\s*[#:.\-]*\s*(\d+)\s*$/i, m => m[1]],
];

const classify = (value) => {
    for (const [type, re, num] of RULES) {
        const m = re.exec(value);
        if (m) return { type, number: num(m) };
    }
    return null;
};

(async () => {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const rows = (await db.query(
            `SELECT ClientId, DOCNumber FROM Clients WHERE DocType IS NULL AND COALESCE(TRIM(DOCNumber), '') <> '' ORDER BY ClientId`
        )).rows;
        const plan = [];
        const left = [];
        for (const r of rows) {
            const c = classify(r.docnumber);
            if (c) plan.push({ id: r.clientid, from: r.docnumber, ...c });
            else left.push(r.docnumber);
        }
        // Two clients can't end up with the same type and number; those are left as they were
        const taken = new Map((await db.query(
            `SELECT COALESCE(DocType, '') AS t, DOCNumber FROM Clients WHERE DocType IS NOT NULL`)).rows.map(r => [`${r.t}|${r.docnumber}`, true]));
        const counts = {};
        const clashes = [];
        let changed = 0;
        for (const p of plan) {
            const key = `${p.type}|${p.number}`;
            if (taken.has(key)) { clashes.push(p); continue; }
            taken.set(key, true);
            counts[p.type] = (counts[p.type] || 0) + 1;
            if (apply) {
                await db.query('UPDATE Clients SET DocType = $1, DOCNumber = $2 WHERE ClientId = $3', [p.type, p.number, p.id]);
                await logClientChange(db, {
                    clientId: p.id, changedBy: CHANGED_BY, changeType: 'ID # Type Set',
                    details: `ID # "${p.from}" saved as ${p.type} ${p.number}.`,
                });
            }
            changed++;
        }
        console.log(`${rows.length} numbers without a type; ${changed} ${apply ? 'set' : 'would be set'}:`, counts);
        console.log(`${clashes.length} left alone because another client already has that type and number:`);
        for (const c of clashes) console.log(`   client ${c.id}: "${c.from}" -> ${c.type} ${c.number}`);
        console.log(`${left.length} left alone (no clear type). Examples:`, left.slice(0, 40).join(' | '));
        if (!apply) {
            console.log('\nSamples:');
            for (const t of Object.keys(counts)) {
                plan.filter(p => p.type === t && p.number !== p.from).slice(0, 8).forEach(p => console.log(`   ${t}: "${p.from}" -> "${p.number}"`));
            }
        }
        await db.query(apply ? 'COMMIT' : 'ROLLBACK');
    } catch (err) {
        await db.query('ROLLBACK');
        throw err;
    } finally {
        db.release();
        await pool.end();
    }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
