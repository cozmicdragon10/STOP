-- Retire the plain Discharged status: move its clients to Discharged Supervision (logged on their Change Log), then disallow it
INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details)
SELECT ClientId, 'System', 'Program Status', 'Discharged', 'Discharged Supervision', 'Discharged status retired.'
FROM Clients WHERE ProgramStatus = 'Discharged';
UPDATE Clients SET ProgramStatus = 'Discharged Supervision' WHERE ProgramStatus = 'Discharged';
ALTER TABLE Clients DROP CONSTRAINT IF EXISTS clients_programstatus_check;
ALTER TABLE Clients ADD CONSTRAINT clients_programstatus_check CHECK (ProgramStatus IN ('Active', 'Completed', 'Deceased', 'Discharged Supervision', 'Inactive', 'Program Failed', 'Revoked', 'Terminated', 'Transferred'));
