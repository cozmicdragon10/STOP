-- Federal clients (Federal SO, Fed Drug Test, Poly Only) aren't charged the Individual price for individual sessions;
-- they pay their Copay instead, or nothing when it's blank.
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS Copay NUMERIC(10, 2) CHECK (Copay >= 0);
