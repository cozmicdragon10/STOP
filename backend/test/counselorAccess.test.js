const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isCounselorAllowed } = require('../lib/counselorAccess');

test('a Counselor can check in, take payments, and see every client', () => {
    for (const [m, p] of [['GET', '/api/clients'], ['GET', '/api/clients/12'], ['PATCH', '/api/clients/12'],
        ['GET', '/api/clients/12/financials'], ['GET', '/api/clients/12/notes'], ['GET', '/api/clients/12/attendance'],
        ['GET', '/api/clients/12/discharges'], ['POST', '/api/attendance/batch'],['POST', '/api/financials/payment'],
        ['GET', '/api/clients/covered-by-me'], ['GET', '/api/my-sessions'], ['GET', '/api/open-groups'], ['PUT', '/api/open-groups'], ['POST', '/api/callin/client'],
        ['GET', '/api/individual-sessions/open'], ['POST', '/api/individual-sessions/close'],
        ['GET', '/api/polygraphs/slots'], ['GET', '/api/clients/12/polygraphs'], ['GET', '/api/clients/12/attachments'],
        ['POST', '/api/clients/12/attachments'], ['GET', '/api/attachments/5'], ['POST', '/api/clients/12/notes'],
        ['PUT', '/api/notes/9'], ['DELETE', '/api/notes/9'], ['GET', '/api/reports/user-cash-deposits'],
        ['PUT', '/api/reports/group-cash-deposits'], ['PUT', '/api/reports/user-cash-deposits'], ['GET', '/api/agents'], ['GET', '/api/documents/7'], ['GET', '/api/auth/me']]) {
        assert.ok(isCounselorAllowed(m, p), `${m} ${p} should be allowed`);
    }
});

test('a Counselor cannot correct money, set overrides, or delete', () => {
    for (const [m, p] of [['PUT', '/api/financials/4/adjust'], ['POST', '/api/financials/4/card-action'],
        ['POST', '/api/financials/charge'], ['PUT', '/api/clients/12/card-payments'], ['POST', '/api/clients/12/fee-override'],
        ['DELETE', '/api/clients/12/fee-override'], ['POST', '/api/clients/12/poly-fee-override'],
        ['DELETE', '/api/clients/12'], ['GET', '/api/clients/12/change-log'], ['GET', '/api/clients/12/deletable'],
        ['PATCH', '/api/attachments/5'], ['DELETE', '/api/attachments/5'], ['DELETE', '/api/attendance/3'],
        ['POST', '/api/clients/12/discharge']]) {
        assert.ok(!isCounselorAllowed(m, p), `${m} ${p} should be refused`);
    }
});

test('a Counselor opens their own assessment times but cannot cancel all open times', () => {
    assert.ok(isCounselorAllowed('POST', '/api/assessment-appointments/slots'));
    assert.ok(isCounselorAllowed('POST', '/api/assessment-appointments'));
    assert.ok(!isCounselorAllowed('POST', '/api/assessment-appointments/cancel-open'));
});

test('a Counselor cannot book, open, reschedule, cancel or record polygraphs', () => {
    for (const [m, p] of [['POST', '/api/polygraphs/slots'], ['POST', '/api/polygraphs/slots/3/assign'],
        ['POST', '/api/polygraphs/slots/3/open'], ['POST', '/api/polygraphs/slots/3/reschedule'],
        ['DELETE', '/api/polygraphs/slots/3'], ['POST', '/api/polygraphs/results']]) {
        assert.ok(!isCounselorAllowed(m, p), `${m} ${p} should be refused`);
    }
});

test('a Counselor cannot edit agents, groups, prices, or reports beyond cash deposits', () => {
    for (const [m, p] of [['POST', '/api/agents'], ['PUT', '/api/agents/3'], ['DELETE', '/api/agents/3'],
        ['PUT', '/api/groups/3'], ['POST', '/api/groups'], ['DELETE', '/api/groups/3'],
        ['PUT', '/api/program-fees/X'], ['POST', '/api/federal-units'], ['GET', '/api/reports/agent'],
        ['GET', '/api/reports/group-deposits'], ['GET', '/api/admin/logs'], ['GET', '/api/notes/pending'],
        ['POST', '/api/notes/9/review'], ['GET', '/api/dev/info']]) {
        assert.ok(!isCounselorAllowed(m, p), `${m} ${p} should be refused`);
    }
});
