-- Adds the DEV role (a Business Administrator who also sees the DEV menu; see lib/roles.js) and gives it to
-- Justin Chandler and the Claude test account.
UPDATE EmployeeRoles SET Role = 'DEV' WHERE LOWER(EmployeeEmail) IN ('admin@chandlercbt.com', 'claude.test@stop.local');
