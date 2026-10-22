-- Retire Failed - Non Attendance and Failed - Non Compliance; Program Failed replaces them
ALTER TABLE Clients DROP CONSTRAINT IF EXISTS clients_programstatus_check;
ALTER TABLE Clients ADD CONSTRAINT clients_programstatus_check CHECK (ProgramStatus IN ('Active', 'Completed', 'Deceased', 'Discharged', 'Discharged Supervision', 'Inactive', 'Program Failed', 'Revoked', 'Terminated', 'Transferred'));
