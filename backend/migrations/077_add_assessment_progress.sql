-- Assessments stay open while the counselor works on them. Beginning one (after the payment is taken) records the
-- attendance on the begin date with its fee and payment, marked In Progress; the counselor adds notes over days or weeks
-- and marks it Completed. Only completed BIP intakes and reinstates clear a BIP client for group (lib/sql.js).
-- Assessments recorded before this change were finished when they were recorded.
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS AssessmentStatus VARCHAR(12)
    CHECK (AssessmentStatus IN ('In Progress', 'Completed'));
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS CompletedOn TIMESTAMP;
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS CompletedBy VARCHAR(255);
UPDATE Attendance SET AssessmentStatus = 'Completed', CompletedOn = COALESCE(CreatedOn, Date::timestamp)
WHERE Type = 'Assessment' AND AssessmentStatus IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_assessment_in_progress ON Attendance (Client) WHERE AssessmentStatus = 'In Progress';

-- An assessment's notes are case notes (category Assessment) linked to its attendance row; deleting the attendance keeps
-- the notes on the client's account
ALTER TABLE Notes ADD COLUMN IF NOT EXISTS AttendanceId INT REFERENCES Attendance(AttendanceId) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notes_attendance ON Notes (AttendanceId) WHERE AttendanceId IS NOT NULL;
