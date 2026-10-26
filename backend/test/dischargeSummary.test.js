const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildDischargeSummaryPdf } = require('../dischargeSummary');

test('builds a PDF discharge summary', async () => {
    const pdf = await buildDischargeSummaryPdf({
        client: {
            firstname: 'Test', lastname: 'Client', docnumber: '12345', programtype: 'State SO',
            programstartdate: '2025-01-06', supervisingagent: 'Agent Smith', groupname: 'Monday PM',
            counselor: 'Counselor One', lastattended: '2026-10-01', lastpoly: null,
        },
        dischargeType: 'Program Failed',
        subcategory: 'Attendance',
        note: 'Missed four consecutive sessions.',
        dischargedOn: '2026-10-26',
        dischargedBy: 'admin@example.com',
    });
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 1000);
});
