const { test } = require('node:test');
const assert = require('node:assert/strict');
const { moneyEditProblem, moneyText } = require('../lib/moneyFields');
const { isAllowed, withoutHidden } = require('../lib/polygrapherAccess');

const before = { accountbalance: '50.00', treatmentfee: '180.00', vouchers: 0, polyfeevoucher: 4, polyfeepaid: '0.00', polyfee: '250.00' };
const check = (role, body, { standardFee = 100, voucherMax = 4 } = {}) => moneyEditProblem({ role, body, before, standardFee, voucherMax });

test('only a Business Administrator changes the balance, vouchers or poly fee by hand', () => {
    assert.equal(check('Business Administrator', { accountbalance: 0, vouchers: 3, polyfeepaid: 250 }), null);
    assert.match(check('Office Admin', { accountbalance: 0 }), /Only a Business Administrator can change Account Balance/);
    assert.match(check('Counselor', { vouchers: 3, polyfee: 200 }), /Vouchers, Poly Fee\b/);
});

test('unchanged money fields sent back are not a change', () => {
    assert.equal(check('Counselor', { accountbalance: '50', treatmentfee: 180, polyfeevoucher: '4' }), null);
});

test('the treatment fee may follow the price list for anyone, but not be typed in', () => {
    // Phase changed to Phase 2: the price list says $100
    assert.equal(check('Counselor', { phase: 'Phase 2 - Monthly', treatmentfee: 100 }), null);
    assert.match(check('Counselor', { treatmentfee: 120 }), /Treatment Fee/);
    // A program the price list doesn't price (standardFee null): only a Business Administrator changes it
    assert.match(check('Counselor', { treatmentfee: 100 }, { standardFee: null }), /Treatment Fee/);
});

test('poly fee vouchers may be trimmed to a new phase\'s full set, nothing else', () => {
    assert.equal(check('Counselor', { polyfeevoucher: 2 }, { voucherMax: 2 }), null);
    assert.match(check('Counselor', { polyfeevoucher: 1 }, { voucherMax: 2 }), /Poly Fee Vouchers/);
    assert.match(check('Counselor', { polyfeevoucher: 6 }, { voucherMax: 6 }), /Poly Fee Vouchers/);
});

test('money fields read the way the office reads them in the change log', () => {
    assert.equal(moneyText('accountbalance', '50.00'), '-$50.00');
    assert.equal(moneyText('accountbalance', '-20'), '$20.00');
    assert.equal(moneyText('treatmentfee', '180'), '$180.00');
    assert.equal(moneyText('vouchers', '3'), '3');
    assert.equal(moneyText('polyfee', null), 'None');
});

test('a Polygrapher reaches only their part of the app', () => {
    for (const [m, p] of [['GET', '/api/clients'], ['GET', '/api/clients/12'], ['GET', '/api/clients/12/polygraphs'],
        ['GET', '/api/clients/12/attachments'], ['GET', '/api/attachments/5'], ['POST', '/api/clients/12/attachments'],
        ['POST', '/api/polygraphs/slots'], ['POST', '/api/polygraphs/slots/3/open'], ['POST', '/api/polygraphs/slots/3/reschedule'],
        ['POST', '/api/polygraphs/results'], ['GET', '/api/documents'], ['GET', '/api/documents/7'], ['POST', '/api/auth/logout']]) {
        assert.ok(isAllowed(m, p), `${m} ${p} should be allowed`);
    }
    for (const [m, p] of [['GET', '/api/clients/12/financials'], ['GET', '/api/clients/12/notes'], ['GET', '/api/clients/12/attendance'],
        ['PATCH', '/api/clients/12'], ['POST', '/api/financials/payment'], ['POST', '/api/clients/12/activate'],
        ['POST', '/api/polygraphs/slots/3/assign'], ['DELETE', '/api/polygraphs/slots/3'], ['PATCH', '/api/attachments/5'],
        ['DELETE', '/api/attachments/5'], ['POST', '/api/documents'], ['GET', '/api/reports/agent'], ['GET', '/api/clients/12/change-log']]) {
        assert.ok(!isAllowed(m, p), `${m} ${p} should be refused`);
    }
});

test('client records sent to a Polygrapher leave out money, billing and comments', () => {
    const row = withoutHidden({ clientid: 1, firstname: 'A', mainphone: '555', accountbalance: '50', polyfeepaid: '0', comments: 'x', phase: 'Phase 1 - Weekly' });
    assert.deepEqual(row, { clientid: 1, firstname: 'A', mainphone: '555', phase: 'Phase 1 - Weekly' });
});
