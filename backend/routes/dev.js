// The DEV menu: developer information about the running server and database. DEV accounts only (lib/roles.js).
const express = require('express');
const os = require('os');
const { pool, logAction } = require('../db');
const { requireDev, bearerToken, hashToken } = require('../lib/auth');
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

// Logins that have not expired, newest first. Only the hash is stored, so a session is named by its hash; current
// marks the session making the request.
router.get('/api/dev/sessions', requireDev, async (req, res) => {
    try {
        const current = hashToken(bearerToken(req));
        const result = await pool.query(
            `SELECT s.TokenHash, s.EmployeeEmail, e.DisplayName, e.Role, s.CreatedOn, s.ExpiresOn
             FROM Sessions s LEFT JOIN EmployeeRoles e ON LOWER(e.EmployeeEmail) = LOWER(s.EmployeeEmail)
             WHERE s.ExpiresOn > NOW()
             ORDER BY s.CreatedOn DESC`
        );
        res.json(result.rows.map(r => ({
            sessionHash: r.tokenhash.trim(),
            email: r.employeeemail,
            displayName: r.displayname ?? null,
            role: r.role ?? null,
            createdOn: r.createdon,
            expiresOn: r.expireson,
            current: r.tokenhash.trim() === current,
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Signs one session out. The DEV account's own session is refused here: use Log out for that.
router.delete('/api/dev/sessions/:sessionHash', requireDev, async (req, res) => {
    const { sessionHash } = req.params;
    if (!/^[0-9a-f]{64}$/.test(sessionHash)) return res.status(400).json({ error: 'That is not a session.' });
    if (sessionHash === hashToken(bearerToken(req))) {
        return res.status(400).json({ error: 'That is your own session. Use Log out to end it.' });
    }
    try {
        const removed = await pool.query(
            'DELETE FROM Sessions WHERE TokenHash = $1 RETURNING EmployeeEmail', [sessionHash]
        );
        if (removed.rowCount === 0) return res.status(404).json({ error: 'That session has already ended.' });
        const email = removed.rows[0].employeeemail;
        await logAction(req.user.employeeemail, 'DEV Session Ended', `Signed out a session for ${email}.`, 'Admin');
        res.json({ success: true, email });
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
