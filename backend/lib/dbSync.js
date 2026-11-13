// DEV database sync: copies the whole database (schema, data, views, sequences) between the app's database
// (DATABASE_URL, e.g. stop_db) and a developer copy on the same PostgreSQL server (DEV_DATABASE_NAME, default stop_dev).
//   pull: app -> dev. The dev copy is replaced; the app's database is only read.
//   push: dev -> app. The app's database is backed up first (backups/<db>-before-push-<stamp>.dump), then replaced.
// A copy is pg_dump of the source, then one psql transaction on the target that drops the public schema and restores
// the dump, so a failed copy leaves the target as it was. Uses pg_dump/psql from PG_BIN, the newest
// C:\Program Files\PostgreSQL\<version>\bin, or PATH.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');

const DEFAULT_DEV_DB = 'stop_dev';
const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');

// Database names are put into SQL and file names, so only plain lowercase identifiers are allowed
const validDbName = (name) => typeof name === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(name);

const devDbName = (env = process.env) => env.DEV_DATABASE_NAME || DEFAULT_DEV_DB;

// The same connection string pointing at another database on the same server
const withDatabase = (url, name) => {
    const u = new URL(url);
    u.pathname = `/${name}`;
    return u.toString();
};

const databaseName = (url) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));

// Connection settings for pg_dump/psql as environment variables, so the password never appears in a command line
const pgEnv = (url) => {
    const u = new URL(url);
    return {
        PGHOST: u.hostname || 'localhost',
        PGPORT: u.port || '5432',
        PGUSER: decodeURIComponent(u.username),
        PGPASSWORD: decodeURIComponent(u.password),
        PGDATABASE: databaseName(url),
    };
};

// Folder holding pg_dump and psql; '' means use PATH
const findPgBin = (env = process.env, exists = fs.existsSync, readdir = fs.readdirSync) => {
    if (env.PG_BIN) return env.PG_BIN;
    const root = 'C:\\Program Files\\PostgreSQL';
    try {
        const versions = readdir(root).filter(v => /^\d+(\.\d+)?$/.test(v)).sort((a, b) => parseFloat(b) - parseFloat(a));
        for (const v of versions) {
            const bin = path.join(root, v, 'bin');
            if (exists(path.join(bin, 'pg_dump.exe'))) return bin;
        }
    } catch { /* not installed there */ }
    return '';
};

const tool = (bin, name) => (bin ? path.join(bin, process.platform === 'win32' ? `${name}.exe` : name) : name);

// Which database is copied over which. Push must be confirmed by typing the app database's name.
const syncPlan = (direction, appUrl, devName, confirm) => {
    if (!validDbName(devName)) throw new Error(`The dev database name "${devName}" is not allowed.`);
    const appName = databaseName(appUrl);
    if (appName === devName) throw new Error('The dev database must not be the app database.');
    const devUrl = withDatabase(appUrl, devName);
    if (direction === 'pull') return { from: appUrl, to: devUrl, fromName: appName, toName: devName, backup: false };
    if (direction === 'push') {
        if (confirm !== appName) throw new Error(`Type the app database's name (${appName}) to confirm the push.`);
        return { from: devUrl, to: appUrl, fromName: devName, toName: appName, backup: true };
    }
    throw new Error('Unknown sync direction.');
};

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// Runs a PostgreSQL tool; rejects with its error output when it fails
const run = (exe, args, url) => new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env: { ...process.env, ...pgEnv(url) }, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(new Error(`Could not run ${path.basename(exe)}: ${err.message}. Set PG_BIN in backend/.env to PostgreSQL's bin folder.`)));
    child.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new Error(`${path.basename(exe)} failed: ${stderr.trim().split('\n').slice(-5).join(' ')}`))));
});

const withClient = async (url, fn) => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try { return await fn(client); } finally { await client.end().catch(() => {}); }
};

const databaseExists = (appUrl, name) => withClient(appUrl, async (c) =>
    (await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount > 0);

const ensureDatabase = async (appUrl, name) => {
    if (!validDbName(name)) throw new Error(`The database name "${name}" is not allowed.`);
    if (await databaseExists(appUrl, name)) return false;
    await withClient(appUrl, (c) => c.query(`CREATE DATABASE "${name}"`));
    return true;
};

// Size and contents of one database, or { exists: false }
const describeDatabase = async (appUrl, name) => {
    if (!(await databaseExists(appUrl, name))) return { name, exists: false };
    return withClient(withDatabase(appUrl, name), async (c) => {
        const { rows: [d] } = await c.query(`
            SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
                   (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
                   (SELECT COUNT(*)::int FROM information_schema.views WHERE table_schema = 'public')
                     + (SELECT COUNT(*)::int FROM pg_matviews WHERE schemaname = 'public') AS views,
                   (SELECT COALESCE(SUM(n_live_tup), 0)::bigint FROM pg_stat_user_tables WHERE schemaname = 'public') AS rows`);
        let migrations = { count: 0, latest: null };
        const has = await c.query(`SELECT to_regclass('public.schemamigrations') IS NOT NULL AS ok`);
        if (has.rows[0].ok) {
            const m = await c.query('SELECT COUNT(*)::int AS count, MAX(Name) AS latest FROM SchemaMigrations');
            migrations = m.rows[0];
        }
        return { name, exists: true, ...d, rows: Number(d.rows), migrations };
    });
};

// The live database is always the app side, even when this server runs against stop_dev (APP_ENV=dev)
const liveUrl = () => require('../db').databaseTarget.liveUrl;

const status = async (appUrl = liveUrl(), devName = devDbName()) => ({
    app: await describeDatabase(appUrl, databaseName(appUrl)),
    dev: await describeDatabase(appUrl, devName),
    pgBin: findPgBin() || '(PATH)',
});

let running = null;

// direction 'pull' or 'push'; returns what was done. One sync at a time.
const sync = async (direction, { confirm, appUrl = liveUrl(), devName = devDbName() } = {}) => {
    const plan = syncPlan(direction, appUrl, devName, confirm);
    if (running) throw Object.assign(new Error(`A ${running} is already running.`), { busy: true });
    running = direction;
    const started = Date.now();
    const bin = findPgBin();
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-sync-'));
    try {
        if (direction === 'pull') await ensureDatabase(appUrl, devName);
        else if (!(await databaseExists(appUrl, devName))) throw new Error(`There is no ${devName} database to push. Pull first.`);

        let backupFile = null;
        if (plan.backup) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
            backupFile = path.join(BACKUP_DIR, `${plan.toName}-before-push-${stamp()}.dump`);
            await run(tool(bin, 'pg_dump'), ['--format=custom', '--file', backupFile], plan.to);
        }

        const dumpFile = path.join(work, 'source.sql');
        await run(tool(bin, 'pg_dump'), ['--format=plain', '--no-owner', '--no-privileges', '--file', dumpFile], plan.from);
        const resetFile = path.join(work, 'reset.sql');
        fs.writeFileSync(resetFile, 'DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n');
        await run(tool(bin, 'psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', resetFile, '-f', dumpFile], plan.to);

        return { direction, from: plan.fromName, to: plan.toName, backupFile, seconds: Math.round((Date.now() - started) / 1000) };
    } finally {
        running = null;
        fs.rmSync(work, { recursive: true, force: true });
    }
};

module.exports = {
    DEFAULT_DEV_DB, BACKUP_DIR, validDbName, devDbName, withDatabase, databaseName, pgEnv, findPgBin, syncPlan, stamp,
    status, sync,
};
