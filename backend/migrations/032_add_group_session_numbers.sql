-- Session numbers let a group meet more than once a day. Existing rows are session 1. Open sheets become unique per
-- group, date, and session (was per group and date).
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS SessionNumber INT NOT NULL DEFAULT 1;
ALTER TABLE OpenGroupSessions ADD COLUMN IF NOT EXISTS SessionNumber INT NOT NULL DEFAULT 1;
ALTER TABLE OpenGroupSessions DROP CONSTRAINT IF EXISTS opengroupsessions_groupid_sessiondate_key;
CREATE UNIQUE INDEX IF NOT EXISTS OpenGroupSessions_Session_Key ON OpenGroupSessions (GroupId, SessionDate, SessionNumber);
-- Employee who opened the group check-in this attendance was closed from; NULL on older rows (treated as CreatedBy)
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS OpenedBy VARCHAR(255);
