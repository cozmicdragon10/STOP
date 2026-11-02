// Imports the old system's supervising agent directory (SupervisingAgent.csv) into SupervisingAgents.
//
//   node import/importAgents.js [folder] [--commit]     dry run unless --commit; folder defaults to D:\DataImports
//
// Clients link to agents by name (case and surrounding spaces ignored), so each agent keeps the exact FullName the client
// import used. Names already in the directory are left alone. Safe to re-run: agents it added before are skipped.
const { pool } = require('../db');
const { readCsv, text, insertRows, runImport } = require('./csv');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const FOLDER = args.find(a => !a.startsWith('--')) || 'D:\\DataImports';
const IMPORTED_BY = 'Data Import';

const key = (name) => String(name ?? '').trim().toLowerCase();
const PHONE = /\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}/;

runImport(pool, COMMIT, async (db) => {
    const { rows } = readCsv(FOLDER, 'SupervisingAgent.csv');
    const existing = new Set((await db.query('SELECT Name FROM SupervisingAgents')).rows.map(r => key(r.name)));

    // The old directory lists some agents twice; keep the entry with the most contact details
    const best = new Map();
    for (const r of rows) {
        const name = text(r.FullName);
        // "None 0" and "None None" are placeholders for no agent
        if (!name || /^none\b/i.test(name)) continue;
        const phone = (text(r['Column 5']) || '').match(PHONE)?.[0] || null;
        const agent = { name: name.slice(0, 100), phone, email: (text(r.email) || '').slice(0, 100) || null, region: (text(r.Type) || '').slice(0, 100) || null };
        const score = (a) => (a.phone ? 1 : 0) + (a.email ? 1 : 0) + (a.region ? 1 : 0);
        const prev = best.get(key(name));
        if (!prev || score(agent) > score(prev)) best.set(key(name), agent);
    }
    const toAdd = [...best.entries()].filter(([k]) => !existing.has(k)).map(([, a]) => [a.name, a.phone, a.email, a.region, IMPORTED_BY]);
    await insertRows(db, 'SupervisingAgents', ['Name', 'Phone', 'Email', 'Region', 'CreatedBy'], toAdd);

    const unlisted = (await db.query(`
        SELECT COUNT(DISTINCT LOWER(TRIM(c.SupervisingAgent)))::int AS n FROM Clients c
        WHERE TRIM(COALESCE(c.SupervisingAgent, '')) <> ''
          AND NOT EXISTS (SELECT 1 FROM SupervisingAgents a WHERE LOWER(TRIM(a.Name)) = LOWER(TRIM(c.SupervisingAgent)))`)).rows[0].n;
    const summary = `Added ${toAdd.length} supervising agents from ${FOLDER}\\SupervisingAgent.csv (${rows.length - 1} in the file, ${best.size - toAdd.length} already listed).`;
    await db.query('INSERT INTO SystemLogs (UserEmail, Action, Details, Type) VALUES ($1, $2, $3, $4)', [IMPORTED_BY, 'Agent Import', summary, 'Audit']);
    console.log(summary);
    console.log(`Agent names on client records still not in the directory: ${unlisted}`);
})
    .catch(err => { console.error('Import failed:', err.message); process.exitCode = 1; })
    .finally(() => pool.end());
