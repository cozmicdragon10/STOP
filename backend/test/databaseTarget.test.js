const test = require('node:test');
const assert = require('node:assert');
const { chooseDatabase } = require('../lib/databaseTarget');

const LIVE = 'postgresql://postgres:secret@localhost:5432/stop_db';
const DEV = 'postgresql://postgres:secret@localhost:5432/stop_dev';

test('with APP_ENV unset the live database is used, as the deployed server needs', () => {
    const t = chooseDatabase({ DATABASE_URL: LIVE, DEV_DATABASE_URL: DEV });
    assert.equal(t.appEnv, 'production');
    assert.equal(t.url, LIVE);
    assert.equal(t.name, 'stop_db');
});

test('APP_ENV=production also uses the live database', () => {
    assert.equal(chooseDatabase({ APP_ENV: 'Production ', DATABASE_URL: LIVE }).url, LIVE);
});

test('APP_ENV=dev uses the stop_dev database and never the live one', () => {
    const t = chooseDatabase({ APP_ENV: 'dev', DATABASE_URL: LIVE, DEV_DATABASE_URL: DEV });
    assert.equal(t.url, DEV);
    assert.equal(t.name, 'stop_dev');
    assert.equal(t.liveUrl, LIVE);
});

test('APP_ENV=dev without DEV_DATABASE_URL stops rather than falling back to the live database', () => {
    assert.throws(() => chooseDatabase({ APP_ENV: 'dev', DATABASE_URL: LIVE }), /DEV_DATABASE_URL/);
});

test('DEV_DATABASE_URL pointing at the live database is refused', () => {
    assert.throws(() => chooseDatabase({ APP_ENV: 'dev', DATABASE_URL: LIVE, DEV_DATABASE_URL: LIVE }), /must not point/);
});

test('an unknown APP_ENV is refused', () => {
    assert.throws(() => chooseDatabase({ APP_ENV: 'staging', DATABASE_URL: LIVE }), /APP_ENV must be/);
});
