-- A Therapist note made from a group check-in comment (backend/lib/attendanceNotes.js) is linked to its attendance, so
-- the comment can be updated later from the closed group (Update Attendance Notes). Deleting the attendance keeps the note.
ALTER TABLE Notes ADD COLUMN IF NOT EXISTS AttendanceId INT REFERENCES Attendance(AttendanceId) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notes_attendanceid_idx ON Notes (AttendanceId) WHERE AttendanceId IS NOT NULL;

-- Link the attendance notes written before this column existed. Their text starts with the label, group, and date:
--   "BIP Week 12 · Clinton SO 1 · 11/19/2026: ..." or "Attendance #23 · Clinton SO 1 (session 2) · 11/19/2026: ..."
WITH parsed AS (
    SELECT n.NoteId, n.Client,
           regexp_match(n.Comments, '^(?:BIP Week [0-9]+|Attendance #[0-9]+|Individual Session #[0-9]+) · ([^·]+) · ([0-9]{1,2})/([0-9]{1,2})/([0-9]{4}): ') AS m
    FROM Notes n
    WHERE n.Category = 'Therapist' AND n.AttendanceId IS NULL
), sessions AS (
    SELECT NoteId, Client,
           regexp_replace(m[1], ' \(session [0-9]+\)$', '') AS GroupName,
           COALESCE((regexp_match(m[1], ' \(session ([0-9]+)\)$'))[1]::int, 1) AS SessionNumber,
           make_date(m[4]::int, m[2]::int, m[3]::int) AS SessionDate
    FROM parsed WHERE m IS NOT NULL
)
UPDATE Notes n SET AttendanceId = a.AttendanceId
FROM sessions s
JOIN Attendance a ON a.Client = s.Client AND a.Date = s.SessionDate AND a.SessionNumber = s.SessionNumber
JOIN Groups g ON g.GroupId = a."Group" AND g.GroupName = s.GroupName
WHERE n.NoteId = s.NoteId;
