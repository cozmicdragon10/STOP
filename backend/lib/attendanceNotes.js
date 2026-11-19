// Comments typed for a client on the group check-in review screen go on the client's case notes as a Therapist note,
// not on the attendance. The note says which attendance it is about: a BIP client's BIP week number, otherwise just
// "Attendance" (or "Individual Session" in an INDIVIDUAL group), with the group and the date it took place.
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

// Which attendance the note is about: "BIP Week 12", "Attendance", or "Individual Session"
const attendanceLabel = ({ bipWeek, individual }) =>
    bipWeek ? `BIP Week ${bipWeek}` : individual ? 'Individual Session' : 'Attendance';

// The full note: "BIP Week 12 · Clinton SO 1 · 11/19/2026: <comment>" (with "session 2" when the group met again that day)
const attendanceNoteText = ({ label, groupName, date, sessionNumber, text }) =>
    `${label} · ${groupName}${sessionNumber > 1 ? ` (session ${sessionNumber})` : ''} · ${dateText(date)}: ${text}`;

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

// The label, group, and date at the start of an attendance note ("BIP Week 12 · Clinton SO 1 · 11/19/2026: "). Notes
// written on 2026-11-19 before the label change carried a number ("Attendance #23"); migration 083 takes it off.
const NOTE_HEADING = /^((?:BIP Week \d+|Attendance(?: #\d+)?|Individual Session(?: #\d+)?) ·[^·]+ · \d{1,2}\/\d{1,2}\/\d{4}: )/;

// The comment part of an attendance note, without its heading (the whole text when it has none)
const noteBody = (comments) => String(comments ?? '').replace(NOTE_HEADING, '');

// The note with its comment replaced and its heading kept
const replaceNoteBody = (comments, text) => {
    const heading = NOTE_HEADING.exec(String(comments ?? ''));
    return `${heading ? heading[1] : ''}${text}`;
};

// A BIP client's week number at an earlier attendance: the week stored now (Phase) less the group attendances after it,
// since each one added a week (lib/attendance.js). null when Phase isn't a week number or the result makes no sense.
const bipWeekAt = async (db, { clientId, attendanceId, date }) => {
    const res = await db.query(
        `SELECT c.ProgramType, TRIM(c.Phase) AS Phase,
                (SELECT COUNT(*)::int FROM Attendance WHERE Client = c.ClientId AND ${GROUP_ATTENDANCE}
                   AND (Date > $2::date OR (Date = $2::date AND AttendanceId > $3))) AS later
         FROM Clients c WHERE c.ClientId = $1`,
        [clientId, date, attendanceId]
    );
    const row = res.rows[0];
    if (!row || row.programtype !== 'BIP' || !/^\d+$/.test(String(row.phase ?? ''))) return null;
    const week = Number(row.phase) - row.later;
    return week >= 1 ? String(week) : null;
};

// Adds the Therapist note for one attendance (nothing when there's no comment), linked to the attendance
// (Notes.AttendanceId) so it can be updated from the closed group. Runs inside the caller's transaction.
const addAttendanceNote = async (db, { clientId, attendanceId, date, sessionNumber, groupName, bipWeek, individual, text, author, closedBy }) => {
    if (!text) return null;
    const comments = attendanceNoteText({
        label: attendanceLabel({ bipWeek, individual }), groupName, date, sessionNumber, text,
    });
    await db.query(
        `INSERT INTO Notes (Client, Date, "User", Comments, Category, AttendanceId) VALUES ($1, NOW(), $2, $3, 'Therapist', $4)`,
        [clientId, author, comments, attendanceId]
    );
    await logClientChange(db, {
        clientId, changedBy: closedBy || author, changeType: 'Case Note', newValue: 'Added',
        details: `Therapist note from group attendance: ${comments}`,
    });
    return comments;
};

module.exports = {
    MAKEUP_COMMENT, splitEntryComments, attendanceLabel, attendanceNoteText, noteAuthor, addAttendanceNote,
    noteBody, replaceNoteBody, bipWeekAt,
};
