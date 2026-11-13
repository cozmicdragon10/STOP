const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { validDbName, devDbName, withDatabase, databaseName, pgEnv, findPgBin, syncPlan, stamp } = require('../lib/dbSync');

const APP = 'postgres://postgres:p%40ss@localhost:5432/stop_db';

test('only plain lowercase database names are allowed', () => {
    for (const ok of ['stop_dev', 'a', '_x1']) assert.ok(validDbName(ok), ok);
    for (const bad of ['', 'Stop', '1db', 'a-b', 'x"; DROP DATABASE stop_db; --', 'a'.repeat(64), null]) assert.ok(!validDbName(bad), String(bad));
});

test('the dev database is stop_dev unless DEV_DATABASE_NAME names another', () => {
    assert.equal(devDbName({}), 'stop_dev');
    assert.equal(devDbName({ DEV_DATABASE_NAME: 'mine' }), 'mine');
});

test('the dev copy is the same server with another database name', () => {
    assert.equal(databaseName(withDatabase(APP, 'stop_dev')), 'stop_dev');
    assert.equal(new URL(withDatabase(APP, 'stop_dev')).host, 'localhost:5432');
});

test('connection settings go to the tools as environment variables, password decoded', () => {
    assert.deepStrictEqual(pgEnv(APP), { PGHOST: 'localhost', PGPORT: '5432', PGUSER: 'postgres', PGPASSWORD: 'p@ss', PGDATABASE: 'stop_db' });
    assert.equal(pgEnv('postgres://u@db.example/x').PGPORT, '5432');
});

test('pull copies the app over the dev copy and takes no backup', () => {
    const plan = syncPlan('pull', APP, 'stop_dev');
    assert.equal(plan.fromName, 'stop_db');
    assert.equal(plan.toName, 'stop_dev');
    assert.equal(plan.backup, false);
});

test('push copies the dev copy over the app, backs up first, and must be confirmed with the app database name', () => {
    assert.throws(() => syncPlan('push', APP, 'stop_dev'), /stop_db/);
    assert.throws(() => syncPlan('push', APP, 'stop_dev', 'yes'), /stop_db/);
    const plan = syncPlan('push', APP, 'stop_dev', 'stop_db');
    assert.equal(plan.fromName, 'stop_dev');
    assert.equal(plan.toName, 'stop_db');
    assert.equal(plan.backup, true);
});

test('the dev copy can never be the app database, and the direction must be known', () => {
    assert.throws(() => syncPlan('pull', APP, 'stop_db'), /must not be the app/);
    assert.throws(() => syncPlan('pull', APP, 'Bad Name'), /not allowed/);
    assert.throws(() => syncPlan('merge', APP, 'stop_dev'), /Unknown/);
});

test('the newest installed PostgreSQL bin folder is used, or PG_BIN, or PATH', () => {
    const root = 'C:\\Program Files\\PostgreSQL';
    const installed = new Set([path.join(root, '16', 'bin', 'pg_dump.exe'), path.join(root, '18', 'bin', 'pg_dump.exe')]);
    const readdir = () => ['16', '18', 'pgAdmin 4', '9.6'];
    assert.equal(findPgBin({}, (f) => installed.has(f), readdir), path.join(root, '18', 'bin'));
    assert.equal(findPgBin({ PG_BIN: 'D:\\pg\\bin' }, () => false, readdir), 'D:\\pg\\bin');
    assert.equal(findPgBin({}, () => false, () => { throw new Error('missing'); }), '');
});

test('backup file stamps sort by time and are safe in file names', () => {
    assert.equal(stamp(new Date('2026-11-13T14:05:09Z')), '20261113-140509');
});
