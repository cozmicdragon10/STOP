-- Allow the full program status list. Terminated stays allowed so existing rows remain valid.
ALTER TABLE Clients DROP CONSTRAINT IF EXISTS clients_programstatus_check;
ALTER TABLE Clients ADD CONSTRAINT clients_programstatus_check CHECK (ProgramStatus IN ('Active', 'Completed', 'Deceased', 'Discharged', 'Failed - Non Attendance', 'Failed - Non Compliance', 'Inactive', 'Revoked', 'Transfered', 'Terminated'));
