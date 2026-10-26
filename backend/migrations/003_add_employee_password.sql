-- Password hash for each account (scrypt). NULL means no password is set yet, so the account cannot log in.
ALTER TABLE EmployeeRoles ADD COLUMN IF NOT EXISTS PasswordHash TEXT;
