-- Looking up an attendance's note (the latest by NoteId) has to use an index on both columns: with only the AttendanceId
-- index from 082, PostgreSQL walked every note backwards by NoteId instead, and the Closed Groups list took over a minute.
CREATE INDEX IF NOT EXISTS notes_attendanceid_noteid_idx ON Notes (AttendanceId, NoteId) WHERE AttendanceId IS NOT NULL;
DROP INDEX IF EXISTS notes_attendanceid_idx;
