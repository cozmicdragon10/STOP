// Applies the SQL files in migrations/ in filename order, each once, recording them in SchemaMigrations.
// Runs at server startup; `npm run migrate` runs it on its own (add --status to list without applying).
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Migrations up to this one were applied by hand before SchemaMigrations existed. When an existing database is first
// tracked they are recorded as applied without running, since several of them are not safe to run twice.
const LAST_HAND_RUN_MIGRATION = '027_add_assessment_individual_attendance_types.sql';

const migrationFiles = () => fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();

const ensureTable = async (pool) => {
    const existed = await pool.query(`SELECT to_regclass('schemamigrations') IS NOT NULL AS found`);
    if (existed.rows[0].found) return;
    await pool.query(`
        CREATE TABLE SchemaMigrations (
            Name VARCHAR(255) PRIMARY KEY,
            AppliedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            Baselined BOOLEAN NOT NULL DEFAULT FALSE
        )
    `);
    const hasData = await pool.query(`SELECT to_regclass('clients') IS NOT NULL AS found`);
    if (!hasData.rows[0].found) return;
    const handRun = migrationFiles().filter(f => f <= LAST_HAND_RUN_MIGRATION);
    for (const name of handRun) {
        await pool.query('INSERT INTO SchemaMigrations (Name, Baselined) VALUES ($1, TRUE)', [name]);
    }
    console.log(`Existing database: recorded ${handRun.length} hand-run migrations as applied.`);
};

const pendingMigrations = async (pool) => {
    await ensureTable(pool);
    const applied = new Set((await pool.query('SELECT Name FROM SchemaMigrations')).rows.map(r => r.name));
    return migrationFiles().filter(f => !applied.has(f));
};

// Each file runs in its own transaction; a failure rolls that file back and stops the run
const runMigrations = async (pool) => {
    const pending = await pendingMigrations(pool);
    for (const name of pending) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
        const db = await pool.connect();
        try {
            await db.query('BEGIN');
            await db.query(sql);
            await db.query('INSERT INTO SchemaMigrations (Name) VALUES ($1)', [name]);
            await db.query('COMMIT');
            console.log(`Applied migration ${name}`);
        } catch (err) {
            await db.query('ROLLBACK').catch(() => {});
            throw new Error(`Migration ${name} failed: ${err.message}`);
        } finally {
            db.release();
        }
    }
    return pending;
};

module.exports = { runMigrations, pendingMigrations };

if (require.main === module) {
    const { pool } = require('./db');
    const statusOnly = process.argv.includes('--status');
    (statusOnly ? pendingMigrations(pool) : runMigrations(pool))
        .then(names => {
            if (statusOnly) console.log(names.length ? `Pending:\n  ${names.join('\n  ')}` : 'No pending migrations.');
            else if (!names.length) console.log('No pending migrations.');
        })
        .catch(err => { console.error(err.message); process.exitCode = 1; })
        .finally(() => pool.end());
}
