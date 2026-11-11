// --- MONTHLY SUPERVISING AGENT (PO) REPORTS ---
// Every active client with a supervising agent gets a monthly PDF (attendance, polygraphs, therapist and call-in notes).
// The PDFs are grouped by agent into an unsent Outlook draft (.eml). Nothing is emailed from here: the draft opens in
// Outlook and someone presses Send. Business Administrators and Office Admins only.
const express = require('express');
const { logAction, pool } = require('../db');
const { requireRole } = require('../lib/auth');
const { NO_POLY_PROGRAM_TYPES } = require('../lib/poly');
const {
    ATTENDED_TYPES, monthLabel, buildClientReportPdf, buildDraftEml, reportFileName, draftFileName,
} = require('../agentReport');

const router = express.Router();
const adminsOnly = requireRole('Business Administrator', 'Office Admin');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
// Case note categories the PO sees: therapist notes, and call-ins (client absences and group closures)
const REPORT_NOTE_CATEGORIES = ['Therapist', 'Call-In'];

// $1 is the month's first day ('YYYY-MM-01'); a value is in the month when IN_MONTH(value) holds
const IN_MONTH = (col) => `(${col} >= $1::date AND ${col} < $1::date + INTERVAL '1 month')`;
const AGENT_KEY = `LOWER(TRIM(c.SupervisingAgent))`;
const REPORTED_CLIENTS = `c.ProgramStatus = 'Active' AND COALESCE(TRIM(c.SupervisingAgent), '') <> ''`;

// Report clients matching the WHERE clause, with what the PDF header needs. Uses $1 (month start).
const clientsSql = (where) => `
    SELECT c.ClientId, c.FirstName, c.MiddleName, c.LastName, c.DOCNumber, c.SupervisingAgent, c.ProgramStatus,
           c.ProgramStartDate, c.NoPolyRequired, COALESCE(c.ProgramType, g.ProgramType, 'State SO') AS ProgramType,
           g.GroupName, g.Counselor,
           -- The group counselor's credentials (e.g. "LPC"), matched by display name or email as receipts do
           (SELECT NULLIF(TRIM(e.Credentials), '') FROM EmployeeRoles e
            WHERE LOWER(TRIM(e.DisplayName)) = LOWER(TRIM(g.Counselor)) OR LOWER(e.EmployeeEmail) = LOWER(TRIM(g.Counselor))
            ORDER BY e.Active DESC NULLS LAST LIMIT 1) AS CounselorCredentials,
           ${AGENT_KEY} AS AgentKey, sa.Name AS AgentName, sa.Email AS AgentEmail,
           (SELECT MAX(a.Date) FROM Attendance a WHERE a.Client = c.ClientId AND a.Type = ANY($2)
                AND a.Date < $1::date + INTERVAL '1 month') AS LastAttended,
           (SELECT MAX(COALESCE(p.PolygraphDateTime::date, p.Date)) FROM PolygraphResults p WHERE p.Client = c.ClientId
                AND COALESCE(p.PolygraphDateTime::date, p.Date) < $1::date + INTERVAL '1 month') AS LastPoly
    FROM Clients c
    LEFT JOIN Groups g ON g.GroupId = c.GroupId
    LEFT JOIN SupervisingAgents sa ON LOWER(TRIM(sa.Name)) = ${AGENT_KEY}
    WHERE ${where}
    ORDER BY c.LastName, c.FirstName, c.ClientId`;

// Everything each client's PDF shows, in the order of `clients`
const loadReportData = async (clients, monthStart) => {
    const ids = clients.map(c => c.clientid);
    const [attendance, polygraphs, nextPolys, notes] = await Promise.all([
        pool.query(
            `SELECT a.Client, a.Date, a.Type, g.GroupName FROM Attendance a LEFT JOIN Groups g ON g.GroupId = a."Group"
             WHERE a.Client = ANY($2) AND ${IN_MONTH('a.Date')}
             ORDER BY a.Date, a.SessionNumber, a.AttendanceId`,
            [monthStart, ids]
        ),
        pool.query(
            `SELECT p.Client, COALESCE(p.PolygraphDateTime::date, p.Date) AS Date, p.Type, p.Results FROM PolygraphResults p
             WHERE p.Client = ANY($2) AND ${IN_MONTH('COALESCE(p.PolygraphDateTime::date, p.Date)')}
             ORDER BY 2, p.ResultId`,
            [monthStart, ids]
        ),
        // Next scheduled polygraph as of today (not the report month), as the PO would want to know it now
        pool.query(
            `SELECT DISTINCT ON (a.Client) a.Client, s.Date, to_char(s.Time, 'HH24:MI') AS Time, s.Location, s.Address
             FROM PolygraphAppointments a JOIN PolygraphSlots s ON s.SlotId = a.SlotId
             WHERE a.Client = ANY($1) AND a.Status = 'Scheduled' AND s.Date + COALESCE(s.Time, '23:59') >= NOW()
             ORDER BY a.Client, s.Date, s.Time`,
            [ids]
        ),
        // Pending and denied notes are left out, as they are on the account
        pool.query(
            `SELECT n.Client, n.Date, n.Category, n.Comments, COALESCE(e.DisplayName, n."User") AS Author,
                    NULLIF(TRIM(e.Credentials), '') AS AuthorCredentials
             FROM Notes n LEFT JOIN EmployeeRoles e ON LOWER(e.EmployeeEmail) = LOWER(n."User")
             WHERE n.Client = ANY($2) AND n.Category = ANY($3) AND COALESCE(n.ApprovalStatus, 'Approved') = 'Approved'
               AND ${IN_MONTH('n.Date')}
             ORDER BY n.Date, n.NoteId`,
            [monthStart, ids, REPORT_NOTE_CATEGORIES]
        ),
    ]);
    const byClient = (rows) => {
        const map = new Map();
        for (const r of rows) {
            if (!map.has(r.client)) map.set(r.client, []);
            map.get(r.client).push(r);
        }
        return map;
    };
    const att = byClient(attendance.rows);
    const polys = byClient(polygraphs.rows);
    const next = new Map(nextPolys.rows.map(r => [r.client, r]));
    const caseNotes = byClient(notes.rows);
    return clients.map(c => ({
        client: {
            ...c,
            takespolygraphs: !NO_POLY_PROGRAM_TYPES.includes(c.programtype) && !c.nopolyrequired,
            nextpoly: next.get(c.clientid) || null,
        },
        attendance: att.get(c.clientid) || [],
        polygraphs: polys.get(c.clientid) || [],
        notes: caseNotes.get(c.clientid) || [],
    }));
};

const monthStartOf = (month) => `${month}-01`;
const badMonth = (res) => res.status(400).json({ error: 'Pick a report month (YYYY-MM).' });

// The month's agents, each with their active clients and a few counts, plus active clients with no agent
router.get('/api/reports/po-monthly', adminsOnly, async (req, res) => {
    try {
        const month = String(req.query.month || '');
        if (!MONTH.test(month)) return badMonth(res);
        const monthStart = monthStartOf(month);
        const clients = await pool.query(
            `SELECT x.*,
                    (SELECT COUNT(*) FROM Attendance a WHERE a.Client = x.ClientId AND a.Type = ANY($2) AND ${IN_MONTH('a.Date')})::int AS Attended,
                    (SELECT COUNT(*) FROM Attendance a WHERE a.Client = x.ClientId AND a.Type = 'Call-In' AND ${IN_MONTH('a.Date')})::int AS CalledIn,
                    (SELECT COUNT(*) FROM Notes n WHERE n.Client = x.ClientId AND n.Category = ANY($3)
                         AND COALESCE(n.ApprovalStatus, 'Approved') = 'Approved' AND ${IN_MONTH('n.Date')})::int AS NoteCount
             FROM (${clientsSql(REPORTED_CLIENTS)}) x
             ORDER BY x.LastName, x.FirstName, x.ClientId`,
            [monthStart, ATTENDED_TYPES, REPORT_NOTE_CATEGORIES]
        );
        const drafts = await pool.query(
            `SELECT DISTINCT ON (LOWER(TRIM(d.AgentName))) LOWER(TRIM(d.AgentName)) AS AgentKey, d.CreatedOn, d.ClientCount,
                    COALESCE(e.DisplayName, d.CreatedBy) AS CreatedByName
             FROM AgentReportDrafts d LEFT JOIN EmployeeRoles e ON LOWER(e.EmployeeEmail) = LOWER(d.CreatedBy)
             WHERE d.ReportMonth = $1
             ORDER BY LOWER(TRIM(d.AgentName)), d.CreatedOn DESC`,
            [monthStart]
        );
        const lastDraft = new Map(drafts.rows.map(d => [d.agentkey, d]));
        const noAgent = await pool.query(
            `SELECT c.ClientId, c.FirstName, c.LastName, c.DOCNumber FROM Clients c
             WHERE c.ProgramStatus = 'Active' AND COALESCE(TRIM(c.SupervisingAgent), '') = ''
             ORDER BY c.LastName, c.FirstName`
        );

        const agents = new Map();
        for (const c of clients.rows) {
            if (!agents.has(c.agentkey)) {
                const d = lastDraft.get(c.agentkey);
                agents.set(c.agentkey, {
                    name: c.agentname || c.supervisingagent.trim(),
                    email: c.agentemail || null,
                    inDirectory: Boolean(c.agentname),
                    lastDraft: d ? { createdOn: d.createdon, createdBy: d.createdbyname, clientCount: d.clientcount } : null,
                    clients: [],
                });
            }
            agents.get(c.agentkey).clients.push({
                clientid: c.clientid, firstname: c.firstname, lastname: c.lastname, docnumber: c.docnumber,
                attended: c.attended, calledin: c.calledin, notecount: c.notecount,
            });
        }
        res.json({
            month,
            agents: [...agents.values()].sort((a, b) => a.name.localeCompare(b.name)),
            noAgent: noAgent.rows,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// One client's PDF, to look over before the draft is made
router.get('/api/reports/po-monthly/client/:id/pdf', adminsOnly, async (req, res) => {
    try {
        const month = String(req.query.month || '');
        if (!MONTH.test(month)) return badMonth(res);
        const monthStart = monthStartOf(month);
        const found = await pool.query(clientsSql('c.ClientId = $3'), [monthStart, ATTENDED_TYPES, req.params.id]);
        if (found.rows.length === 0) return res.status(404).json({ error: 'Client not found.' });
        const [data] = await loadReportData(found.rows, monthStart);
        const pdf = await buildClientReportPdf({ month, ...data });
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `inline; filename="${reportFileName(data.client, month)}"`);
        res.send(pdf);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// An unsent Outlook draft (.eml) to one agent with a PDF for each of their active clients. Making it is recorded;
// nothing is sent.
router.post('/api/reports/po-monthly/draft', adminsOnly, async (req, res) => {
    try {
        const { month, agent, user } = req.body;
        if (!MONTH.test(String(month || ''))) return badMonth(res);
        if (!String(agent || '').trim()) return res.status(400).json({ error: 'Pick a supervising agent.' });
        const monthStart = monthStartOf(month);
        const found = await pool.query(
            clientsSql(`${REPORTED_CLIENTS} AND ${AGENT_KEY} = LOWER(TRIM($3))`),
            [monthStart, ATTENDED_TYPES, agent]
        );
        if (found.rows.length === 0) {
            return res.status(404).json({ error: `${agent} has no active clients to report.` });
        }
        const data = await loadReportData(found.rows, monthStart);
        const attachments = [];
        for (const d of data) {
            attachments.push({ fileName: reportFileName(d.client, month), data: await buildClientReportPdf({ month, ...d }) });
        }
        const first = found.rows[0];
        const agentName = first.agentname || first.supervisingagent.trim();
        const eml = buildDraftEml({
            to: { name: agentName, email: first.agentemail },
            month,
            clients: found.rows,
            attachments,
        });

        await pool.query(
            'INSERT INTO AgentReportDrafts (ReportMonth, AgentName, AgentEmail, ClientCount, CreatedBy) VALUES ($1, $2, $3, $4, $5)',
            [monthStart, agentName, first.agentemail || null, found.rows.length, user]
        );
        await logAction(user, 'PO Report Draft Created',
            `${monthLabel(month)} report draft for ${agentName} (${found.rows.length} client${found.rows.length === 1 ? '' : 's'}).`, 'Audit');

        res.set('Content-Type', 'message/rfc822');
        res.set('Content-Disposition', `attachment; filename="${draftFileName(agentName, month)}"`);
        // The page is on another origin, so it can only read the file name if the header is exposed
        res.set('Access-Control-Expose-Headers', 'Content-Disposition');
        res.send(eml);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
