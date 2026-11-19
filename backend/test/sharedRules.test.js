// Rules the server and the browser both apply. The frontend keeps its own copies in frontend/src/utils; these tests
// fail when one side changes without the other.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { isMonthlyFeeClient, feePeriodMonths, FIRST_CHECKIN_MAX_OWED, checkInPaymentRule, minimumCheckInPayment, federalGroupFee } = require('../lib/attendance');
const { bipCheckInBlockMessage, DISCHARGE_STATUSES } = require('../lib/sql');
const { POLY_VOUCHER_MAX_BY_PHASE } = require('../lib/poly');

const frontend = (file) => import(pathToFileURL(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', file)).href);

// The director's reports count these as discharges (routes/directorReports.js)
test('discharge statuses match', async () => {
    const { DISCHARGE_STATUSES: browser } = await frontend('clients.ts');
    assert.ok(Array.isArray(DISCHARGE_STATUSES) && DISCHARGE_STATUSES.length > 0);
    assert.deepEqual([...DISCHARGE_STATUSES].sort(), [...browser].sort());
});

test('first check-in of the month allows the same amount owed', async () => {
    const { FIRST_CHECKIN_MAX_OWED: browser } = await frontend('balance.ts');
    assert.equal(FIRST_CHECKIN_MAX_OWED, browser);
});

test('the max debt override has the same ceiling', async () => {
    const { MAX_DEBT_LIMIT: browser } = await frontend('balance.ts');
    assert.equal(require('../lib/debtLimits').MAX_DEBT_LIMIT, browser);
});

const PROGRAMS = ['State SO', 'Voluntary SO', 'Federal SO', 'Fed Drug Test', 'Chaperon', 'BIP', 'Poly Only', null];

test('check-in payment rules and minimum payments match', async () => {
    const browser = await frontend('balance.ts');
    for (const p of PROGRAMS) {
        const rule = checkInPaymentRule(p);
        assert.equal(rule, browser.checkInPaymentRule(p), `rule for ${p}`);
        for (const balance of [-20, 0, 0.01, 50, '75.50']) {
            for (const fee of [0, 40, 180]) {
                for (const attended of [false, true]) {
                    for (const maxOwed of [0, null, 100, '250.00']) assert.equal(minimumCheckInPayment(rule, balance, fee, attended, maxOwed), browser.minimumCheckInPayment(rule, balance, fee, attended, maxOwed),
                        `max owed ${maxOwed}`);
                    assert.equal(minimumCheckInPayment(rule, balance, fee, attended), browser.minimumCheckInPayment(rule, balance, fee, attended),
                        `${p} balance ${balance} fee ${fee} attended ${attended}`);
                }
            }
        }
    }
});

test('federal clients are charged the same copay', async () => {
    const browser = await frontend('clients.ts');
    for (const p of PROGRAMS) {
        for (const copay of [null, '', 0, '15.00', 25]) {
            for (const attended of [false, true]) {
                assert.equal(federalGroupFee(p, copay, attended), browser.federalGroupFee(p, copay, attended), `${p} copay ${copay} attended ${attended}`);
            }
        }
    }
});

test('federal polygraph copays need the same payment first', async () => {
    const browser = await frontend('clients.ts');
    const { federalPolyNeeds } = require('../lib/copays');
    for (const copay of [null, '', 0, '25.00', 40]) {
        for (const balance of [-20, 0, 50, '90.00', 500]) {
            for (const maxOwed of [0, null, 100, '250.00']) {
                assert.deepEqual(federalPolyNeeds(copay, balance, maxOwed), browser.federalPolyNeeds(copay, balance, maxOwed), `copay ${copay} balance ${balance} max ${maxOwed}`);
            }
        }
    }
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

test('quarterly and semi-annual clients have the same full set of poly fee vouchers', async () => {
    const { POLY_VOUCHER_MAX_BY_PHASE: browser } = await frontend('soPhases.ts');
    assert.deepEqual(POLY_VOUCHER_MAX_BY_PHASE, browser);
});

test('BIP check-in block messages match', async () => {
    const { bipCheckInBlockMessage: browser } = await frontend('bip.ts');
    for (const block of ['intake', 'our-intake', 'reinstate']) {
        assert.equal(bipCheckInBlockMessage(block, 'Pat Doe'), browser(block, 'Pat Doe'));
    }
});

test('the same programs skip polygraphs', () => {
    const fs = require('fs');
    const list = (file) => JSON.parse(/NO_POLY_PROGRAM_TYPES = (\[[^\]]*\])/.exec(fs.readFileSync(file, 'utf8'))[1].replace(/'/g, '"'));
    assert.deepEqual(
        list(path.join(__dirname, '..', 'lib', 'poly.js')),
        list(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'polygraph.ts')),
    );
});

test('the same federal programs get bus passes, with the same limit', () => {
    const fs = require('fs');
    const read = (file) => {
        const source = fs.readFileSync(file, 'utf8');
        return {
            programs: JSON.parse(/FEDERAL_PROGRAM_TYPES = (\[[^\]]*\])/.exec(source)[1].replace(/'/g, '"')),
            max: Number(/BUS_PASS_MAX = (\d+)/.exec(source)[1]),
        };
    };
    assert.deepEqual(
        read(path.join(__dirname, '..', 'lib', 'busPasses.js')),
        read(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'clients.ts')),
    );
});

test('call-in reasons match', async () => {
    const { CALL_IN_REASONS: browser } = await frontend('notes.ts');
    const source = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'callins.js'), 'utf8');
    const server = JSON.parse(/CALL_IN_REASONS = (\[[^\]]*\])/.exec(source)[1].replace(/'/g, '"'));
    assert.deepEqual(server, browser);
});

test('group schedules are read the same way', async () => {
    const { parseSchedule: browser } = await frontend('schedule.ts');
    const { parseSchedule: server } = require('../lib/groupSchedule');
    for (const s of ['Thursdays @ 5:00 PM', 'monday@ 9:30 am', 'Saturday @ 12:00 PM', 'By Appointment', '', 'Fridays 5 PM', 'Sundays @ 7:05 pm']) {
        assert.deepEqual(server(s), browser(s), s);
    }
});

test('assessment rules match: who works on one, what is due to begin, the paperwork box', async () => {
    const browser = await frontend('assessmentWork.ts');
    const server = require('../lib/assessmentWork');
    assert.deepEqual(browser.ASSESSMENT_WORK_ROLES, server.ASSESSMENT_WORK_ROLES);
    assert.deepEqual(browser.ASSESSMENT_ADMIN_ROLES, server.ASSESSMENT_ADMIN_ROLES);
    assert.deepEqual(browser.PAPERWORK_KINDS, server.PAPERWORK_KINDS);
    assert.equal(browser.NOTE_MAX, server.NOTE_MAX);
    assert.deepEqual([...browser.FUNDING_SOURCES], server.FUNDING_SOURCES);
    assert.equal(browser.FUNDING_ROLE, server.FUNDING_ROLE);
    for (const balance of [-500, -20, 0, 0.01, 50, '75.50', null]) {
        for (const fee of [0, 40, 150.5]) {
            for (const funded of [null, 'DHS Invoice']) {
                for (const maxOwed of [0, 75, '200.00']) assert.equal(browser.amountDueToBegin(balance, fee, funded, maxOwed), server.amountDueToBegin(balance, fee, funded, maxOwed), `balance ${balance} fee ${fee} ${funded} ${maxOwed}`);
            }
        }
    }
    for (const kind of ['Standard', 'BIP Intake', 'BIP Reinstate']) assert.equal(browser.paperworkLabel(kind), server.paperworkLabel(kind));
    for (const role of ['Counselor', 'Office Admin', 'Business Administrator', 'Polygrapher']) {
        for (const displayname of ['Pat Lee', ' pat lee ', 'Sam Ray']) {
            const viewer = { role, displayname };
            assert.equal(browser.worksOnAssessment(viewer, { provider: 'Pat Lee' }), server.worksOnAssessment(viewer, { provider: 'Pat Lee' }), `${role} ${displayname}`);
        }
    }
});
