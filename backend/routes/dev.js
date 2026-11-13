// The DEV menu: developer information about the running server and database. DEV accounts only (lib/roles.js).
const express = require('express');
const os = require('os');
const { pool, logAction } = require('../db');
const { requireDev } = require('../lib/auth');
const dbSync = require('../lib/dbSync');

const router = express.Router();

router.get('/api/dev/info', requireDev, async (req, res) => {
    try {
        const [db, migrations, sessions, employees] = await Promise.all([
            pool.query(`SELECT current_database() AS name, version() AS version,
                               pg_size_pretty(pg_database_size(current_database())) AS size, NOW() AS now`),
            pool.query('SELECT Name, AppliedOn FROM SchemaMigrations ORDER BY Name DESC'),
            pool.query('SELECT COUNT(*)::int AS n FROM Sessions WHERE ExpiresOn > NOW()'),
            pool.query('SELECT Role, COUNT(*)::int AS n FROM EmployeeRoles WHERE Active = TRUE GROUP BY Role ORDER BY Role'),
        ]);
        res.json({
            server: {
                node: process.version,
                platform: `${os.type()} ${os.release()}`,
                hostname: os.hostname(),
                uptimeSeconds: Math.round(process.uptime()),
                startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
                memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
                environment: process.env.NODE_ENV || 'not set',
            },
            database: { ...db.rows[0], migrationCount: migrations.rows.length, recentMigrations: migrations.rows.slice(0, 10) },
            activeSessions: sessions.rows[0].n,
            activeAccountsByRole: employees.rows,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// The app database and the dev copy side by side, for the Database Sync panel
router.get('/api/dev/sync', requireDev, async (req, res) => {
    try {
        res.json(await dbSync.status());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// pull: the app database is copied over the dev copy. push: the dev copy is copied over the app database, after a
// backup; body.confirm must be the app database's name.
const syncRoute = (direction) => async (req, res) => {
    try {
        const result = await dbSync.sync(direction, { confirm: req.body?.confirm });
        await logAction(req.user.employeeemail, `DEV Database ${direction === 'pull' ? 'Pull' : 'Push'}`,
            `Copied ${result.from} over ${result.to} in ${result.seconds}s${result.backupFile ? `; backup ${result.backupFile}` : ''}`, 'Admin');
        res.json({ ...result, status: await dbSync.status() });
    } catch (err) {
        res.status(err.busy ? 409 : 400).json({ error: err.message });
    }
};
router.post('/api/dev/sync/pull', requireDev, syncRoute('pull'));
router.post('/api/dev/sync/push', requireDev, syncRoute('push'));

module.exports = router;
