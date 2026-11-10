-- A counselor's license credentials (e.g. "LPC"), printed after their name on receipts
ALTER TABLE EmployeeRoles ADD COLUMN IF NOT EXISTS Credentials VARCHAR(100);

-- Starting values: every counselor is an LPC, except Belinda Harris (LPC, LADC-MH) and Marsha Porter (LPC-C)
UPDATE EmployeeRoles SET Credentials = 'LPC' WHERE Role = 'Counselor' AND Credentials IS NULL;
UPDATE EmployeeRoles SET Credentials = 'LPC, LADC-MH' WHERE Role = 'Counselor' AND LOWER(TRIM(DisplayName)) = 'belinda harris';
UPDATE EmployeeRoles SET Credentials = 'LPC-C' WHERE Role = 'Counselor' AND LOWER(TRIM(DisplayName)) = 'marsha porter';
