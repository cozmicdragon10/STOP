-- Add the discharge statuses and fix the Transfered spelling. Older statuses stay allowed so existing rows remain valid.
ALTER TABLE Clients DROP CONSTRAINT IF EXISTS clients_programstatus_check;
UPDATE Clients SET ProgramStatus = 'Transferred' WHERE ProgramStatus = 'Transfered';
ALTER TABLE Clients ADD CONSTRAINT clients_programstatus_check CHECK (ProgramStatus IN ('Active', 'Completed', 'Deceased', 'Discharged', 'Discharged Supervision', 'Failed - Non Attendance', 'Failed - Non Compliance', 'Inactive', 'Program Failed', 'Revoked', 'Terminated', 'Transferred'));
