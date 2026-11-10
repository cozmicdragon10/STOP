-- An individual session's cash payment is applied to the account when it is saved as open.
-- PaidOnOpen keeps how much was paid that way, on the open session and then on the closed attendance row.
ALTER TABLE OpenIndividualSessions ADD COLUMN IF NOT EXISTS PaidOnOpen NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS PaidOnOpen NUMERIC(10,2) NOT NULL DEFAULT 0;
