-- The counselor a client is waiting to be assessed by (an employee display name). Cleared when an assessment is closed.
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS Assessor VARCHAR(100);
