-- The employee (email) who entered a ledger row, shown on the User Activity report. Rows from before this column
-- existed take it from their check-in where they have one; the rest stay NULL (not recorded).
ALTER TABLE FinancialTransactions ADD COLUMN IF NOT EXISTS EnteredBy VARCHAR(255);
UPDATE FinancialTransactions f SET EnteredBy = a.CreatedBy
FROM Attendance a
WHERE f.EnteredBy IS NULL AND f.AttendanceId = a.AttendanceId AND a.CreatedBy IS NOT NULL;
