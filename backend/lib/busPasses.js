const { logAction } = require('../db');
const { logClientChange } = require('./changeLog');

// Federal clients can be granted bus passes, up to BUS_PASS_MAX at a time. Mirrors FEDERAL_PROGRAM_TYPES and BUS_PASS_MAX
// in frontend/src/utils/clients.ts.
const FEDERAL_PROGRAM_TYPES = ['Federal SO', 'Fed Drug Test', 'Poly Only'];
const BUS_PASS_MAX = 2;

// First day of the calendar month (local time) as YYYY-MM-DD
const monthStart = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
const monthName = (month) => new Date(`${month}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// The monthly refill, inside the caller's transaction: active federal clients with a refill get their bus passes set to it,
// replacing what was left. Runs once per month: returns null when this month was already done.
const refillBusPasses = async (db, month) => {
    const claimed = await db.query('INSERT INTO BusPassRefills (Month) VALUES ($1) ON CONFLICT DO NOTHING RETURNING Month', [month]);
    if (claimed.rows.length === 0) return null;
    const rows = (await db.query(
        `UPDATE Clients c SET BusPasses = c.BusPassRefill
         FROM (SELECT ClientId, BusPasses AS before FROM Clients
               WHERE BusPassRefill > 0 AND ProgramStatus = 'Active' AND ProgramType = ANY($1) FOR UPDATE) b
         WHERE c.ClientId = b.ClientId
         RETURNING c.ClientId, b.before, c.BusPasses`, [FEDERAL_PROGRAM_TYPES])).rows;
    for (const r of rows) {
        if (Number(r.before) === Number(r.buspasses)) continue;
        await logClientChange(db, {
            clientId: r.clientid, changedBy: 'System', changeType: 'Bus Passes', oldValue: String(r.before), newValue: String(r.buspasses),
            details: `Monthly bus pass refill for ${monthName(month)}.`,
        });
    }
    await db.query('UPDATE BusPassRefills SET Clients = $1 WHERE Month = $2', [rows.length, month]);
    return { month, clients: rows.length };
};

// Runs this month's refill in its own transaction if it hasn't run yet
const runMonthlyRefill = async (pool, now = new Date()) => {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const done = await refillBusPasses(db, monthStart(now));
        await db.query('COMMIT');
        if (done) {
            await logAction('System', 'Bus Pass Refill', `Monthly bus pass refill for ${monthName(done.month)}: ${done.clients} client(s) refilled.`);
            console.log(`Bus pass refill for ${monthName(done.month)}: ${done.clients} client(s).`);
        }
        return done;
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        db.release();
    }
};

// Checks at startup and then every hour, so the refill happens on the 1st (or as soon as the server is back up)
const startMonthlyRefills = (pool) => {
    const run = () => runMonthlyRefill(pool).catch(err => console.error('Bus pass refill failed:', err.message));
    run();
    setInterval(run, 60 * 60 * 1000).unref();
};

module.exports = { FEDERAL_PROGRAM_TYPES, BUS_PASS_MAX, monthStart, refillBusPasses, runMonthlyRefill, startMonthlyRefills };
