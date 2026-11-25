// Reopening a closed group session (Business Administrators and DEV accounts): every check-in in it is undone the same
// way deleting one is (lib/undoAttendance.js), and the clients go back on an open check-in sheet with the fee, Cash or
// Other payment, poly voucher, approved make-up, Federal SO duration, and comment each one was closed with. Closing the
// sheet again records it all fresh (POST /api/attendance/batch). The sheet keeps the session's opener and covering
// counselor, so the same person is responsible for its cash (lib/cashResponsibility.js).
//
// Reopening is refused when undoing would lose track of money: the session's cash is already on a deposit or waiting in
// a hand-off (Money on Hand), a payment from it was refunded or disputed, or a check-in recorded a card payment (cards
// are taken before closing, so a closed check-in never should).
const { MAKEUP_COMMENT, noteBody } = require('./attendanceNotes');
const { clientRowsSql } = require('./clientRows');
const { logClientChange } = require('./changeLog');
const { groupItemKey } = require('./moneyOnHand');
const { undoAttendance } = require('./undoAttendance');

const cents = (n) => Math.round(Number(n || 0) * 100) / 100;

// Why the session can't be reopened, or null. state: { groupActive, deposited, pendingHandoff, refundedOrDisputed,
// cardPaid (names of clients whose check-in recorded a card payment), twice (names of clients checked in to the session
// more than once, as some old-system sessions were: a sheet holds each client once), openSheet }
const reopenProblem = ({ groupActive, deposited, pendingHandoff, refundedOrDisputed, cardPaid = [], twice = [], openSheet }) => {
    if (!groupActive) return 'This group is inactive, so it can\'t be reopened for check-in.';
    if (openSheet) return 'This group session already has an open check-in. Close or discard it from Open Groups first.';
    if (deposited) return 'The cash from this group session is already on a deposit. Remove it from the deposit first, then reopen the group.';
    if (pendingHandoff) return 'The cash from this group session is waiting in a hand-off on Money on Hand. Accept or cancel the hand-off first, then reopen the group.';
    if (refundedOrDisputed) return 'A payment from this group session was refunded or disputed, so it can\'t be reopened. Fix that client\'s attendance from their account instead.';
    if (twice.length) return `${twice.join('; ')} ${twice.length === 1 ? 'is' : 'are'} checked in to this session more than once. Delete the extra check-in from the client's account, then reopen the group.`;
    if (cardPaid.length) return `${cardPaid.join('; ')}: the check-in recorded a card payment, so this group can't be reopened. Fix that client's attendance from their account instead.`;
    return null;
};

// The open sheet entry for one undone check-in (the shape useGroupCheckIn keeps: frontend/src/hooks/useGroupCheckIn.ts
// SessionEntry). att: the deleted attendance row; client: the client's row after the undo (clientRowsSql); note: the
// Therapist note text made from its comment ('' when none).
const sheetEntryFromAttendance = ({ att, client, note }) => {
    const payment = cents(att.accountpaid);
    const method = payment > 0 ? att.paymentmethod || 'Cash' : 'Cash';
    return {
        client,
        fee: cents(att.groupfee),
        payment,
        paymentMethod: method,
        paymentSubtype: method === 'Other' ? att.paymentsubtype ?? null : null,
        paymentReference: method === 'Other' ? att.paymentreference ?? null : null,
        cardPaid: 0,
        balance: cents(client?.accountbalance),
        voucher: Boolean(att.voucherused),
        comments: note || '',
        ...(String(att.comments || '').startsWith(MAKEUP_COMMENT) ? { makeup: true } : {}),
        ...(att.durationband ? { durationBand: att.durationband } : {}),
    };
};

// Reopens the session inside the caller's transaction. Throws an error with .status when it can't. Returns
// { openSessionId, clients } (clients: how many were put back on the sheet).
const reopenGroupSession = async (db, { group, date, sessionNumber, user, reason }) => {
    const rows = (await db.query(
        `SELECT a.AttendanceId, a.Client, a.AccountPaid, a.PaymentMethod, COALESCE(a.OpenedBy, a.CreatedBy) AS OpenedBy, a.CoveredBy,
                c.LastName || ', ' || c.FirstName AS Name
         FROM Attendance a JOIN Clients c ON c.ClientId = a.Client
         WHERE a."Group" = $1 AND a.Date = $2::date AND a.SessionNumber = $3 AND a.Type = 'Group'
         ORDER BY a.AttendanceId FOR UPDATE OF a`,
        [group, date, sessionNumber]
    )).rows;
    // Already back on an open sheet (reopened on another screen, say): its check-ins are gone, so say that rather than "not found"
    const openSheet = (await db.query('SELECT 1 FROM OpenGroupSessions WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3',
        [group, date, sessionNumber])).rows.length > 0;
    if (rows.length === 0 && !openSheet) throw Object.assign(new Error('That closed group session was not found.'), { status: 404 });
    const ids = rows.map(r => r.attendanceid);

    const groupRow = (await db.query('SELECT GroupName, Active FROM Groups WHERE GroupId = $1', [group])).rows[0];
    const key = groupItemKey(group, date, sessionNumber);
    const problem = reopenProblem({
        groupActive: groupRow?.active !== false,
        openSheet,
        deposited: (await db.query('SELECT 1 FROM GroupDeposits WHERE GroupId = $1 AND SessionDate = $2 AND SessionNumber = $3',
            [group, date, sessionNumber])).rows.length > 0,
        pendingHandoff: (await db.query(
            `SELECT 1 FROM CashHandoffItems hi JOIN CashHandoffs ho ON ho.HandoffId = hi.HandoffId WHERE hi.ItemKey = $1 AND ho.Status = 'Pending'`,
            [key])).rows.length > 0,
        refundedOrDisputed: (await db.query(
            `SELECT 1 FROM FinancialTransactions r JOIN FinancialTransactions p ON p.TransactionId = r.RelatedTransactionId
             WHERE p.AttendanceId = ANY($1::int[])`, [ids])).rows.length > 0,
        cardPaid: rows.filter(r => cents(r.accountpaid) > 0 && r.paymentmethod === 'Credit Card').map(r => r.name),
        twice: [...new Set(rows.filter((r, i) => rows.findIndex(x => x.client === r.client) !== i).map(r => r.name))],
    });
    if (problem) throw Object.assign(new Error(problem), { status: 409 });

    // Each client's Therapist note from the check-in goes back on the sheet as its comment (closing again writes it anew)
    const notes = new Map();
    for (const id of ids) {
        const linked = (await db.query('SELECT NoteId, Comments FROM Notes WHERE AttendanceId = $1 ORDER BY NoteId DESC', [id])).rows;
        notes.set(id, linked[0] ? noteBody(linked[0].comments).trim() : '');
        if (linked.length) await db.query('DELETE FROM Notes WHERE NoteId = ANY($1::int[])', [linked.map(n => n.noteid)]);
    }

    const why = `Group reopened for changes: ${reason}`;
    const undone = [];
    for (const r of rows) {
        const result = await undoAttendance(db, { attendanceId: r.attendanceid, user, reason: why });
        const note = notes.get(r.attendanceid);
        if (note) {
            await logClientChange(db, {
                clientId: r.client, changedBy: user, changeType: 'Case Note', newValue: 'Deleted',
                details: `Therapist note from the group attendance moved back to the reopened group's check-in sheet: ${note}`,
            });
        }
        undone.push({ att: result.att, note });
    }

    const clients = new Map((await db.query(clientRowsSql('WHERE c.ClientId = ANY($1::int[])'), [rows.map(r => r.client)])).rows
        .map(c => [c.clientid, c]));
    const entries = undone
        .map(({ att, note }) => sheetEntryFromAttendance({ att, client: clients.get(att.client), note }))
        .sort((a, b) => String(a.client?.lastname ?? '').localeCompare(String(b.client?.lastname ?? ''), undefined, { sensitivity: 'base' })
            || String(a.client?.firstname ?? '').localeCompare(String(b.client?.firstname ?? ''), undefined, { sensitivity: 'base' }));

    const openedBy = rows.map(r => r.openedby).filter(Boolean).sort()[0] || user;
    const coveredBy = rows.find(r => r.coveredby)?.coveredby || null;
    const saved = await db.query(
        `INSERT INTO OpenGroupSessions (GroupId, SessionDate, SessionNumber, Entries, CreatedBy, CoveredBy, UpdatedOn)
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (GroupId, SessionDate, SessionNumber) DO NOTHING RETURNING OpenSessionId`,
        [group, date, sessionNumber, JSON.stringify(entries), openedBy, coveredBy]
    );
    if (!saved.rows[0]) throw Object.assign(new Error('This group session was just opened on another screen. Refresh Open Groups.'), { status: 409 });
    return { openSessionId: saved.rows[0].opensessionid, clients: entries.length, groupName: groupRow?.groupname };
};

module.exports = { reopenProblem, sheetEntryFromAttendance, reopenGroupSession };
