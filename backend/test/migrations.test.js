const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'migrations');
const files = fs.readdirSync(dir);

test('every migration is named NNN_description.sql', () => {
    for (const f of files) assert.match(f, /^\d{3}_[a-z0-9_]+\.sql$/, `${f} does not follow NNN_description.sql`);
});

test('migration numbers are unique and have no gaps', () => {
    const numbers = files.map(f => Number(f.slice(0, 3))).sort((a, b) => a - b);
    numbers.forEach((n, i) => assert.equal(n, i + 1, `expected migration ${String(i + 1).padStart(3, '0')}`));
});

test('the last hand-run migration still exists', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'migrate.js'), 'utf8');
    const name = /LAST_HAND_RUN_MIGRATION = '([^']+)'/.exec(source)[1];
    assert.ok(files.includes(name), `${name} is missing from migrations/`);
});
