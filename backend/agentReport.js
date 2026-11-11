// The monthly supervising agent (PO) report: one PDF per client, and an unsent Outlook draft (.eml) per agent with
// that agent's client PDFs attached. Nothing here sends email; the draft opens in Outlook and someone presses Send.
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { LETTERHEAD, formatDate } = require('./dischargeSummary');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// '2026-10' -> 'October 2026'
const monthLabel = (month) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

// Attendance types that count as a session the client attended; Call-In is a called-in absence and
// Closure/Holiday mean the group didn't meet
const ATTENDED_TYPES = ['Group', 'Make-Up', 'Assessment', 'Individual'];
const ATTENDANCE_LABELS = { 'Call-In': 'Called in (absent)', Closure: 'Group closed', Holiday: 'Holiday (no group)' };

const fullName = (c) => [c.firstname, c.middlename, c.lastname].filter(Boolean).join(' ');
// A counselor's name followed by their credentials, e.g. "Belinda Harris, LPC, LADC-MH" (as on receipts)
const withCredentials = (name, credentials) => (name && credentials ? `${name}, ${credentials}` : name || '');
// Drug test clients are seen by an observer, not a therapist
const DRUG_TEST_PROGRAM_TYPES = ['Fed Drug Test'];
const staffTitle = (client) => (DRUG_TEST_PROGRAM_TYPES.includes(client.programtype) ? 'Observer' : 'Therapist');

// '14:30' -> '2:30 PM'
const formatTime = (hhmm) => {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// Builds one client's monthly report PDF and resolves with its bytes.
// info: { month: 'YYYY-MM', client, attendance, polygraphs, notes }
//   client: Clients row plus groupname, counselor, programtype, lastattended (as of month end), lastpoly,
//           nextpoly ({ date, time, location, address } or null), takespolygraphs
//   attendance: [{ date, type, groupname }]   polygraphs: [{ date, type, results }]
//   notes: [{ date, category, author, comments }]
const buildClientReportPdf = (info) => new Promise((resolve, reject) => {
    const { month, client, attendance, polygraphs, notes } = info;
    const name = fullName(client);
    const doc = new PDFDocument({
        size: 'LETTER', bufferPages: true,
        margins: { top: 60, bottom: 60, left: 72, right: 72 },
        info: { Title: `Monthly Progress Report - ${name} - ${monthLabel(month)}` },
    });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    // Starts a new page when fewer than `height` points are left
    const ensureRoom = (height) => { if (doc.y + height > bottom()) doc.addPage(); };

    doc.font('Times-BoldItalic').fontSize(22).text(LETTERHEAD.name, { align: 'center' });
    doc.font('Times-BoldItalic').fontSize(13).text(LETTERHEAD.program, { align: 'center' });
    doc.font('Times-Roman').fontSize(11).text(LETTERHEAD.address, { align: 'center' });
    doc.text(LETTERHEAD.phones, { align: 'center' });
    doc.moveDown(1.2);
    doc.font('Times-Bold').fontSize(14).text('Monthly Progress Report', { align: 'center', underline: true });
    doc.font('Times-Roman').fontSize(12).text(monthLabel(month), { align: 'center' });
    doc.moveDown(1.2);

    const fieldRow = (pairs) => {
        const y = doc.y;
        const colWidth = width / pairs.length;
        let lowest = y;
        pairs.forEach(([label, value], i) => {
            doc.font('Times-Bold').fontSize(11).text(`${label}: `, left + i * colWidth, y, { continued: true, width: colWidth - 8 })
                .font('Times-Roman').text(value || 'N/A');
            lowest = Math.max(lowest, doc.y);
        });
        doc.x = left;
        doc.y = lowest;
        doc.moveDown(0.3);
    };
    fieldRow([['Participant', name], ['DOC #', client.docnumber]]);
    fieldRow([['Program', client.programtype], ['Program Start Date', formatDate(client.programstartdate)]]);
    fieldRow([['Group', client.groupname], [staffTitle(client), withCredentials(client.counselor, client.counselorcredentials)]]);
    fieldRow([['Supervising Agent', client.supervisingagent], ['Status', client.programstatus]]);
    doc.moveDown(0.8);

    const heading = (text) => {
        ensureRoom(60);
        doc.font('Times-Bold').fontSize(12).text(text, left, doc.y, { width });
        doc.moveTo(left, doc.y + 1).lineTo(left + width, doc.y + 1).lineWidth(0.5).stroke();
        doc.moveDown(0.5);
    };
    const line = (text, opts = {}) => {
        doc.font(opts.bold ? 'Times-Bold' : 'Times-Roman').fontSize(11).text(text, left + 18, doc.y, { width: width - 18, lineGap: 2 });
    };
    // A table with fixed column widths (fractions of the page width); rows that don't fit start a new page
    const table = (columns, rows) => {
        const xs = [];
        let x = left + 18;
        const usable = width - 18;
        columns.forEach(c => { xs.push(x); x += c.share * usable; });
        const drawRow = (cells, font) => {
            doc.font(font).fontSize(10.5);
            const h = Math.max(...cells.map((t, i) => doc.heightOfString(String(t ?? ''), { width: columns[i].share * usable - 8 })));
            ensureRoom(h + 4);
            const y = doc.y;
            cells.forEach((t, i) => doc.text(String(t ?? ''), xs[i], y, { width: columns[i].share * usable - 8 }));
            doc.x = left;
            doc.y = y + h + 3;
        };
        drawRow(columns.map(c => c.label), 'Times-Bold');
        rows.forEach(r => drawRow(r, 'Times-Roman'));
        doc.moveDown(0.6);
    };

    // Attendance
    heading('Attendance');
    const attended = attendance.filter(a => ATTENDED_TYPES.includes(a.type)).length;
    const calledIn = attendance.filter(a => a.type === 'Call-In').length;
    const closed = attendance.filter(a => a.type === 'Closure' || a.type === 'Holiday').length;
    line(`Sessions attended: ${attended}     Called in: ${calledIn}     Group closed/holiday: ${closed}`, { bold: true });
    if (attended === 0) line(`Last date attended: ${formatDate(client.lastattended)}`);
    doc.moveDown(0.4);
    if (attendance.length > 0) {
        table(
            [{ label: 'Date', share: 0.2 }, { label: 'Group', share: 0.45 }, { label: 'Session', share: 0.35 }],
            attendance.map(a => [formatDate(a.date), a.groupname || '', ATTENDANCE_LABELS[a.type] || a.type])
        );
    } else {
        line('No attendance recorded this month.');
        doc.moveDown(0.6);
    }

    // Polygraphs
    heading('Polygraphs');
    if (!client.takespolygraphs) {
        line('Polygraphs are not required for this client.');
        doc.moveDown(0.6);
    } else {
        if (polygraphs.length > 0) {
            table(
                [{ label: 'Date', share: 0.2 }, { label: 'Type', share: 0.4 }, { label: 'Result', share: 0.4 }],
                polygraphs.map(p => [formatDate(p.date), p.type, p.results])
            );
        } else {
            line(`No polygraph this month. Last polygraph: ${formatDate(client.lastpoly)}.`);
            doc.moveDown(0.3);
        }
        const next = client.nextpoly;
        line(next
            ? `Next scheduled polygraph: ${formatDate(next.date)}${next.time ? ` at ${formatTime(next.time)}` : ''}${next.location ? `, ${next.location}` : ''}`
            : 'Next scheduled polygraph: None scheduled');
        doc.moveDown(0.8);
    }

    // Case notes: therapist notes, and call-in notes (absences and group closures)
    heading('Case Notes');
    const title = staffTitle(client);
    if (notes.length === 0) {
        line(`No ${title.toLowerCase()} or call-in notes this month.`);
    }
    notes.forEach(n => {
        doc.font('Times-Roman').fontSize(11);
        const body = String(n.comments || '').trim();
        ensureRoom(Math.min(doc.heightOfString(body, { width: width - 18 }) + 20, 120));
        const author = withCredentials(n.author, n.authorcredentials);
        line(`${formatDate(n.date)}  -  ${n.category === 'Call-In' ? 'Call-In' : `${title} Note`}${author ? `  -  ${author}` : ''}`, { bold: true });
        line(body);
        doc.moveDown(0.6);
    });

    // Footer on every page. The bottom margin is lifted while it's written so PDFKit doesn't start another page.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const marginBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font('Times-Italic').fontSize(9).fillColor('#555555').text(
            `CONFIDENTIAL  -  ${name}  -  ${monthLabel(month)}  -  Page ${i - range.start + 1} of ${range.count}`,
            left, doc.page.height - 40, { width, align: 'center', lineBreak: false }
        );
        doc.fillColor('black');
        doc.page.margins.bottom = marginBottom;
    }
    doc.end();
});

// --- Outlook draft (.eml) ---
// X-Unsent: 1 makes Outlook open the file as a new, unsent message. There's no From header, so Outlook sends it from
// the account that opens it.

// RFC 2047 encoding for header text that isn't plain ASCII
const headerText = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
// Quoted display name for an address header
const displayName = (s) => (/^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/["\\]/g, '')}"` : headerText(s));
// A file name safe for Windows and email headers
const safeFileName = (s) => s.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
const base64Lines = (buf) => buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');

// The PDF's file name: 'Last, First - DOC 123456 - October 2026.pdf'
const reportFileName = (client, month) =>
    `${safeFileName(`${client.lastname}, ${client.firstname}${client.docnumber ? ` - DOC ${client.docnumber}` : ''} - ${monthLabel(month)}`)}.pdf`;

const draftSubject = (month) => `Monthly Client Reports - ${monthLabel(month)}`;

const draftBody = ({ agentName, month, clients }) => [
    `${agentName},`,
    '',
    `Attached are the ${monthLabel(month)} monthly progress reports for the following client${clients.length === 1 ? '' : 's'} under your supervision:`,
    '',
    ...clients.map(c => `  - ${c.lastname}, ${c.firstname}${c.docnumber ? ` (DOC ${c.docnumber})` : ''}`),
    '',
    'Please let us know if you have any questions.',
    '',
    LETTERHEAD.name,
    LETTERHEAD.program,
    LETTERHEAD.phones,
].join('\r\n');

// draft: { to: { name, email }, month, clients, attachments: [{ fileName, data }] } -> Buffer of the .eml file
const buildDraftEml = ({ to, month, clients, attachments }) => {
    const boundary = `----=_STOP_${crypto.randomBytes(12).toString('hex')}`;
    const parts = [
        'X-Unsent: 1',
        `To: ${to.email ? `${displayName(to.name)} <${to.email}>` : ''}`,
        `Subject: ${headerText(draftSubject(month))}`,
        `Date: ${new Date().toUTCString()}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        'This is a multi-part message in MIME format.',
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="utf-8"',
        'Content-Transfer-Encoding: base64',
        '',
        base64Lines(Buffer.from(draftBody({ agentName: to.name, month, clients }), 'utf8')),
    ];
    for (const a of attachments) {
        parts.push(
            `--${boundary}`,
            `Content-Type: application/pdf; name="${a.fileName}"`,
            `Content-Disposition: attachment; filename="${a.fileName}"`,
            'Content-Transfer-Encoding: base64',
            '',
            base64Lines(a.data),
        );
    }
    parts.push(`--${boundary}--`, '');
    return Buffer.from(parts.join('\r\n'), 'utf8');
};

const draftFileName = (agentName, month) => `${safeFileName(`PO Reports - ${agentName} - ${monthLabel(month)}`)}.eml`;

module.exports = {
    ATTENDED_TYPES, monthLabel, staffTitle, buildClientReportPdf, buildDraftEml, reportFileName, draftFileName, draftSubject,
};
