// Rules the server and the browser both apply. The frontend keeps its own copies in frontend/src/utils; these tests
// fail when one side changes without the other.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { isMonthlyFeeClient, feePeriodMonths, FIRST_CHECKIN_MAX_OWED } = require('../lib/attendance');
const { bipCheckInBlockMessage } = require('../lib/sql');

const frontend = (file) => import(pathToFileURL(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', file)).href);

test('first check-in of the month allows the same amount owed', async () => {
    const { FIRST_CHECKIN_MAX_OWED: browser } = await frontend('balance.ts');
    assert.equal(FIRST_CHECKIN_MAX_OWED, browser);
});

test('monthly treatment fee applies to the same programs and phases', async () => {
    const { isMonthlyFeeClient: browser, SO_PHASES } = await frontend('soPhases.ts');
    for (const programtype of ['State SO', 'Federal SO', 'Voluntary SO', 'BIP', null]) {
        for (const phase of [...SO_PHASES, '0', null]) {
            assert.equal(isMonthlyFeeClient({ programtype, phase }), browser(programtype, phase), `${programtype} / ${phase}`);
        }
    }
});

test('Phase 3 and 4 fee periods are the same length', async () => {
    const { feePeriodMonths: browser, SO_PHASES } = await frontend('soPhases.ts');
    for (const programtype of ['State SO', 'Federal SO', 'Voluntary SO', 'BIP', null]) {
        for (const phase of [...SO_PHASES, '0', null]) {
            assert.equal(feePeriodMonths({ programtype, phase }), browser(programtype, phase), `${programtype} / ${phase}`);
        }
    }
});

test('BIP check-in block messages match', async () => {
    const { bipCheckInBlockMessage: browser } = await frontend('bip.ts');
    for (const block of ['intake', 'our-intake', 'reinstate']) {
        assert.equal(bipCheckInBlockMessage(block, 'Pat Doe'), browser(block, 'Pat Doe'));
    }
});

test('call-in reasons match', async () => {
    const { CALL_IN_REASONS: browser } = await frontend('notes.ts');
    const source = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'callins.js'), 'utf8');
    const server = JSON.parse(/CALL_IN_REASONS = (\[[^\]]*\])/.exec(source)[1].replace(/'/g, '"'));
    assert.deepEqual(server, browser);
});
