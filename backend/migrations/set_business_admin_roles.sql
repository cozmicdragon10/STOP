-- Moves Bev Chandler and Justin Chandler to the Business Administrator role.
UPDATE EmployeeRoles SET Role = 'Business Administrator' WHERE EmployeeEmail IN ('bev.chandlerandassociates@hotmail.com', 'admin@chandlercbt.com');
