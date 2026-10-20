-- Renames the Admin role to Office Admin. Accounts keep their access.
UPDATE EmployeeRoles SET Role = 'Office Admin' WHERE Role = 'Admin';
