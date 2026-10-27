-- The counselor covering a group session when the office checks it in for them (employee email). Set by an Office Admin
-- or Business Administrator; that counselor is then responsible for the session's cash (see lib/cashResponsibility.js).
ALTER TABLE OpenGroupSessions ADD COLUMN IF NOT EXISTS CoveredBy VARCHAR(255);
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS CoveredBy VARCHAR(255);
