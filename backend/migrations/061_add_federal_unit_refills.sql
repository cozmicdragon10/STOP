-- Monthly refill for federal session units (6022 Group Units, 6012 Individual Units), like the bus pass refill: on the
-- 1st of each month an active client's units for the code are set to their refill, replacing what was left.
ALTER TABLE FederalUnitCodes ADD COLUMN IF NOT EXISTS Refillable BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE FederalUnitCodes SET Refillable = TRUE WHERE Code IN ('6022', '6012');

-- A client's refill amount for a code; no row means no refill
CREATE TABLE IF NOT EXISTS ClientFederalUnitRefills (
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    Code VARCHAR(10) NOT NULL REFERENCES FederalUnitCodes(Code),
    Refill NUMERIC(10, 2) NOT NULL CHECK (Refill > 0),
    PRIMARY KEY (ClientId, Code)
);

-- One row per month the refill ran, so it runs once a month however often the server checks
CREATE TABLE IF NOT EXISTS FederalUnitRefillRuns (
    Month DATE PRIMARY KEY,
    Clients INT,
    RanOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
