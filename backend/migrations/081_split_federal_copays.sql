-- Federal clients (Federal SO, Fed Drug Test, Poly Only) have a copay for each kind of service instead of one Copay:
--   GroupCopay       group attendance (the old Copay column, renamed)
--   IndividualCopay  individual sessions (starts as the old Copay, which used to cover them too)
--   PolyCopay        polygraphs: charged to the account when the polygraph is scheduled, instead of the poly fee
-- Blank or $0.00 means the client pays nothing for that service.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'copay') THEN
        ALTER TABLE Clients RENAME COLUMN Copay TO GroupCopay;
    END IF;
END $$;
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS GroupCopay NUMERIC(10, 2) CHECK (GroupCopay >= 0);
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS IndividualCopay NUMERIC(10, 2) CHECK (IndividualCopay >= 0);
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS PolyCopay NUMERIC(10, 2) CHECK (PolyCopay >= 0);
UPDATE Clients SET IndividualCopay = GroupCopay WHERE IndividualCopay IS NULL AND GroupCopay IS NOT NULL;

-- The polygraph copay charged to the account when the appointment was booked, so a cancellation can credit it back
ALTER TABLE PolygraphAppointments ADD COLUMN IF NOT EXISTS PolyCopayCharged NUMERIC(10, 2) NOT NULL DEFAULT 0;
