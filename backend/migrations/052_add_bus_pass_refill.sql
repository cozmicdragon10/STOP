-- Monthly bus pass refill: at the start of each calendar month a federal client with a refill (1 or 2) has their bus passes
-- set to that number, replacing whatever was left. 0 means no refill.
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS BusPassRefill INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Clients ADD CONSTRAINT clients_buspassrefill_range CHECK (BusPassRefill BETWEEN 0 AND 2);

-- One row per month the refill has run, so it runs once a month even if the server restarts or was off on the 1st
CREATE TABLE IF NOT EXISTS BusPassRefills (
    Month DATE PRIMARY KEY,
    RanOn TIMESTAMP NOT NULL DEFAULT NOW(),
    Clients INTEGER NOT NULL DEFAULT 0
);
