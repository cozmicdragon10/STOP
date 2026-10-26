const PDFDocument = require('pdfkit');

// Letterhead printed at the top of every discharge summary
const LETTERHEAD = {
    name: 'Chandler & Associates',
    program: 'Cognitive Restructuring Program',
    address: '300 N Meridian Ave, Oklahoma City OK  73107',
    phones: '(405) 601-8042  /  Fax  (405) 602-0769',
};

// Dates print as MM/DD/YYYY; DATE columns arrive as midnight local time, so local getters keep the right day
const formatDate = (value) => {
    if (!value) return 'None on record';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
};

const treatmentOutcome = (dischargeType) => {
    if (dischargeType === 'Completed') return 'Client successfully completed the program.';
    if (dischargeType === 'Transferred') return 'Client transferred out of the program before completion.';
    if (dischargeType === 'Program Failed') return 'Client did not complete the program and has been discharged as Program Failed.';
    return 'Client did not complete the program.';
};

// Standard reason printed first under Reasons for Discharge, by discharge type and subcategory
const DISCHARGE_REASONS = {
    'Program Failed': {
        'Attendance': 'Client failed to meet the program\'s attendance requirements and did not attend scheduled group sessions as required.',
        'Polys': 'Client failed to meet the program\'s polygraph requirements and did not complete required polygraph examinations.',
        'Not Amenable': 'Client was determined to be not amenable to treatment and unable to make progress in the program.',
    },
};

// Builds the discharge summary PDF and resolves with its bytes.
// info: { client, dischargeType, subcategory, note, dischargedOn, dischargedBy }
// client: a Clients row plus groupname, counselor, lastattended, lastpoly
const buildDischargeSummaryPdf = (info) => new Promise((resolve, reject) => {
    const { client, dischargeType, subcategory, note, dischargedOn, dischargedBy } = info;
    const fullName = [client.firstname, client.middlename, client.lastname].filter(Boolean).join(' ');
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 60, bottom: 60, left: 72, right: 72 }, info: { Title: `Discharge Summary - ${fullName}` } });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    // Letterhead
    doc.font('Times-BoldItalic').fontSize(22).text(LETTERHEAD.name, { align: 'center' });
    doc.font('Times-BoldItalic').fontSize(13).text(LETTERHEAD.program, { align: 'center' });
    doc.font('Times-Roman').fontSize(11).text(LETTERHEAD.address, { align: 'center' });
    doc.text(LETTERHEAD.phones, { align: 'center' });
    doc.moveDown(1.5);
    doc.font('Times-Bold').fontSize(14).text('Discharge Summary', { align: 'center', underline: true });
    doc.moveDown(1.5);

    // Label/value pairs, two to a line
    const fieldRow = (pairs) => {
        const y = doc.y;
        const colWidth = width / pairs.length;
        pairs.forEach(([label, value], i) => {
            doc.font('Times-Bold').fontSize(11).text(`${label}: `, left + i * colWidth, y, { continued: true, width: colWidth - 8 })
                .font('Times-Roman').text(value || 'N/A');
        });
        doc.x = left;
        doc.moveDown(0.4);
    };
    fieldRow([['Participant\'s Name', fullName], ['DOC #', client.docnumber]]);
    fieldRow([['Program', client.programtype], ['Discharge Date', formatDate(dischargedOn)]]);
    fieldRow([['Program Start Date', formatDate(client.programstartdate)], ['Supervising Agent', client.supervisingagent]]);
    fieldRow([['Group', client.groupname], ['Discharge Type', subcategory ? `${dischargeType} (${subcategory})` : dischargeType]]);
    doc.moveDown(1);

    const section = (heading, body) => {
        doc.font('Times-Bold').fontSize(12).text(heading, left, doc.y, { width });
        doc.moveDown(0.3);
        doc.font('Times-Roman').fontSize(11).text(body, left + 36, doc.y, { width: width - 36, lineGap: 4 });
        doc.x = left;
        doc.moveDown(1);
    };
    section('Course of Treatment/Treatment Outcome:', treatmentOutcome(dischargeType));
    const reason = DISCHARGE_REASONS[dischargeType]?.[subcategory];
    section('Reasons for Discharge:',
        `${reason ? `${reason}\n\n` : ''}Last attended: ${formatDate(client.lastattended)}.  Last polygraph: ${formatDate(client.lastpoly)}.\n\n${note}`);

    doc.moveDown(2);
    doc.font('Times-Bold').fontSize(11).text('Therapist: ', left, doc.y, { continued: true }).font('Times-Roman').text(client.counselor || '________________________________');
    doc.moveDown(0.4);
    doc.font('Times-Bold').text('Discharged By: ', { continued: true }).font('Times-Roman').text(dischargedBy || 'N/A');
    doc.end();
});

module.exports = { buildDischargeSummaryPdf };
