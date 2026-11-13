-- Gives Justin Chandler's account the DEV role. Migration 065 named admin@chandlercbt.com, which has no account.
UPDATE EmployeeRoles SET Role = 'DEV' WHERE LOWER(EmployeeEmail) = 'justin.chandlerandassociates@hotmail.com';
