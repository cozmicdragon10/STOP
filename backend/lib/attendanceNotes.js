// Comments typed for a client on the group check-in review screen go on the client's case notes as a Therapist note,
// not on the attendance. The note says which attendance it is about: a BIP client's BIP week number, otherwise the
// client's attendance count (their Nth group attendance, or Nth individual session in an INDIVIDUAL group).
// The approved make-up flag stays on the attendance (Attendance.Comments) so the week it covers is still marked there.
const { GROUP_ATTENDANCE } = require('./sql');
const { logClientChange } = require('./changeLog');

const MAKEUP_COMMENT = 'Approved make-up attendance';

const dateText = (ymd) => {
    const [y, m, d] = String(ymd).split('-');
    return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : String(ymd);
};

// Splits one sheet entry into what is saved on the attendance and the text of the Therapist note.
// makeup: the client was confirmed as an approved make-up. Sheets saved before the flag existed put the make-up text at
// the start of the comments; it is taken off the note and kept on the attendance.
const splitEntryComments = ({ comments, makeup }) => {
    let text = String(comments ?? '').trim();
    let isMakeup = Boolean(makeup);
    if (text.toLowerCase().startsWith(MAKEUP_COMMENT.toLowerCase())) {
        isMakeup = true;
        text = text.slice(MAKEUP_COMMENT.length).replace(/^[\s.,;:\-–—]+/, '').trim();
    }
    return { attendanceComment: isMakeup ? MAKEUP_COMMENT : null, noteText: text };
};

// Which attendance the note is about, e.g. "BIP Week 12" or "Attendance #23"
const attendanceLabel = ({ bipWeek, count, individual }) =>
    bipWeek ? `BIP Week ${bipWeek}` : individual ? `Individual Session #${count}` : `Attendance #${count}`;

// The full note: "BIP Week 12 · Clinton SO 1 · 11/19/2026: <comment>" (with "session 2" when the group met again that day)
const attendanceNoteText = ({ label, groupName, date, sessionNumber, text }) =>
    `${label} · ${groupName}${sessionNumber > 1 ? ` (session ${sessionNumber})` : ''} · ${dateText(date)}: ${text}`;

// The client's attendance count up to and including this attendance, by date then entry order
const attendanceCount = async (db, { clientId, attendanceId, date, individual }) => {
    const res = await db.query(
        `SELECT COUNT(*)::int AS n FROM Attendance
         WHERE Client = $1 AND ${individual ? `Type = 'Individual'` : GROUP_ATTENDANCE}
           AND (Date < $2::date OR (Date = $2::date AND AttendanceId <= $3))`,
        [clientId, date, attendanceId]
    );
    return res.rows[0].n;
};

// The employee the notes are written as: the covering counselor when one was picked, otherwise the group's usual
// counselor (Groups.Counselor is a display name) when they have an active account, otherwise whoever closed the group.
const noteAuthor = async (db, { coveredBy, groupCounselor, closedBy }) => {
    if (String(coveredBy || '').trim()) return coveredBy;
    if (String(groupCounselor || '').trim()) {
        const res = await db.query(
            `SELECT EmployeeEmail FROM EmployeeRoles WHERE Active = TRUE AND LOWER(TRIM(DisplayName)) = LOWER(TRIM($1))
             ORDER BY EmployeeEmail LIMIT 1`,
            [groupCounselor]
        );
        if (res.rows[0]) return res.rows[0].employeeemail;
    }
    return closedBy;
};

// Adds the Therapist note for one attendance (nothing when there's no comment). Runs inside the closing transaction.
const addAttendanceNote = async (db, { clientId, attendanceId, date, sessionNumber, groupName, bipWeek, individual, text, author, closedBy }) => {
    if (!text) return null;
    const count = bipWeek ? null : await attendanceCount(db, { clientId, attendanceId, date, individual });
    const comments = attendanceNoteText({
        label: attendanceLabel({ bipWeek, count, individual }), groupName, date, sessionNumber, text,
    });
    await db.query(
        `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, 'Therapist')`,
        [clientId, author, comments]
    );
    await logClientChange(db, {
        clientId, changedBy: closedBy || author, changeType: 'Case Note', newValue: 'Added',
        details: `Therapist note from group attendance: ${comments}`,
    });
    return comments;
};

module.exports = { MAKEUP_COMMENT, splitEntryComments, attendanceLabel, attendanceNoteText, noteAuthor, addAttendanceNote };
