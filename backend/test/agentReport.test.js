const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildClientReportPdf, buildDraftEml, reportFileName, draftFileName, monthLabel, staffTitle } = require('../agentReport');

test('drug test clients have an observer; everyone else has a therapist', () => {
    assert.equal(staffTitle({ programtype: 'Fed Drug Test' }), 'Observer');
    assert.equal(staffTitle({ programtype: 'Federal SO' }), 'Therapist');
    assert.equal(staffTitle({ programtype: 'BIP' }), 'Therapist');
});

const client = {
    clientid: 1, firstname: 'Test', middlename: null, lastname: 'Client', docnumber: '12345', programtype: 'State SO',
    programstatus: 'Active', programstartdate: '2025-01-06', supervisingagent: 'Agent Smith', groupname: 'Monday PM',
    counselor: 'Counselor One', lastattended: '2026-10-27', lastpoly: '2026-08-01', takespolygraphs: true,
    nextpoly: { date: '2026-12-02', time: '14:30', location: 'OKC', address: '300 N Meridian' },
};

test('month labels read as the month name and year', () => {
    assert.equal(monthLabel('2026-10'), 'October 2026');
    assert.equal(monthLabel('2027-01'), 'January 2027');
});

test('builds a client monthly report PDF, including one that runs past a page', async () => {
    const pdf = await buildClientReportPdf({
        month: '2026-10',
        client,
        attendance: [
            { date: '2026-10-06', type: 'Group', groupname: 'Monday PM' },
            { date: '2026-10-13', type: 'Call-In', groupname: 'Monday PM' },
            { date: '2026-10-20', type: 'Closure', groupname: 'Monday PM' },
        ],
        polygraphs: [{ date: '2026-10-15', type: 'Maintenance', results: 'No Deception Indicated' }],
        notes: Array.from({ length: 40 }, (_, i) => ({
            date: '2026-10-06', category: i % 2 ? 'Call-In' : 'Therapist', author: 'Counselor One',
            comments: 'Client participated in group and discussed relapse prevention plan. '.repeat(4),
        })),
    });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert.ok(pages > 1, `expected several pages, got ${pages}`);
});

test('builds a report for a client with nothing this month and no polygraphs', async () => {
    const pdf = await buildClientReportPdf({
        month: '2026-10', client: { ...client, takespolygraphs: false, nextpoly: null }, attendance: [], polygraphs: [], notes: [],
    });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('file names are safe for Windows', () => {
    assert.equal(reportFileName(client, '2026-10'), 'Client, Test - DOC 12345 - October 2026.pdf');
    assert.equal(reportFileName({ ...client, lastname: 'O"Brien/Jr', docnumber: null }, '2026-10'), 'O Brien Jr, Test - October 2026.pdf');
    assert.equal(draftFileName('J. Smith: OKC', '2026-10'), 'PO Reports - J. Smith OKC - October 2026.eml');
});

test('the Outlook draft is unsent, addressed to the agent, and carries each PDF', () => {
    const pdf = Buffer.from('%PDF-1.3 fake');
    const eml = buildDraftEml({
        to: { name: 'Agent Smith', email: 'smith@doc.example' },
        month: '2026-10',
        clients: [client, { ...client, firstname: 'Other', docnumber: '999' }],
        attachments: [{ fileName: 'a.pdf', data: pdf }, { fileName: 'b.pdf', data: pdf }],
    }).toString('utf8');
    const [headers] = eml.split('\r\n\r\n');
    assert.match(headers, /^X-Unsent: 1$/m);
    assert.match(headers, /^To: "Agent Smith" <smith@doc\.example>$/m);
    assert.match(headers, /^Subject: Monthly Client Reports - October 2026$/m);
    assert.doesNotMatch(headers, /^From:/m);
    assert.equal((eml.match(/Content-Disposition: attachment/g) || []).length, 2);
    assert.ok(eml.includes(pdf.toString('base64')));
    const boundary = /boundary="([^"]+)"/.exec(headers)[1];
    assert.ok(eml.trimEnd().endsWith(`--${boundary}--`));
    // The body lists each client
    const bodyB64 = eml.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
    const body = Buffer.from(bodyB64.replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.match(body, /Client, Test \(DOC 12345\)/);
    assert.match(body, /Client, Other \(DOC 999\)/);
});

test('a draft for an agent with no email leaves To blank for Outlook to fill in', () => {
    const eml = buildDraftEml({ to: { name: 'José Núñez', email: null }, month: '2026-10', clients: [client], attachments: [] }).toString('utf8');
    assert.match(eml, /^To: $/m);
});
