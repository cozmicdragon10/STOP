-- A counselor (or the office) cancels or reschedules one upcoming meeting of a group from My Day. One change per meeting
-- (group and original date). A reschedule moves that meeting to NewDate at NewTime.
CREATE TABLE IF NOT EXISTS GroupScheduleChanges (
    ChangeId SERIAL PRIMARY KEY,
    GroupId INT NOT NULL REFERENCES Groups(GroupId) ON DELETE CASCADE,
    OriginalDate DATE NOT NULL,
    Action VARCHAR(12) NOT NULL CHECK (Action IN ('Cancelled', 'Rescheduled')),
    NewDate DATE,
    NewTime TIME,
    Reason TEXT,
    CreatedBy VARCHAR(255),
    CreatedOn TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (GroupId, OriginalDate),
    CHECK (Action = 'Cancelled' OR (NewDate IS NOT NULL AND NewTime IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_groupschedulechanges_original ON GroupScheduleChanges (OriginalDate);
CREATE INDEX IF NOT EXISTS idx_groupschedulechanges_new ON GroupScheduleChanges (NewDate);

-- Each client in the group gets a Group Cancel or Group Reschedule case note. The note keeps the change it came from, so
-- undoing the change removes its notes.
ALTER TABLE Notes DROP CONSTRAINT IF EXISTS notes_category_check;
ALTER TABLE Notes ADD CONSTRAINT notes_category_check CHECK (Category IN (
    'Therapist', 'Admin', 'Call-In', 'Polygraph', 'Attendance', 'Discharge', 'Activation', 'Group Cancel', 'Group Reschedule'));
ALTER TABLE Notes ADD COLUMN IF NOT EXISTS ScheduleChangeId INT REFERENCES GroupScheduleChanges(ChangeId) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notes_schedule_change ON Notes (ScheduleChangeId) WHERE ScheduleChangeId IS NOT NULL;
