-- Marks a Federal SO or Fed Drug Test client as pretrial (supervised before trial or sentencing)
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS Pretrial BOOLEAN NOT NULL DEFAULT FALSE;
