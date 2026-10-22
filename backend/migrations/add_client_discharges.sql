-- One row per discharge, kept even after the client is reactivated, for recidivism reporting by type and subcategory
CREATE TABLE IF NOT EXISTS ClientDischarges (
    DischargeId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    DischargedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    DischargeType VARCHAR(50) NOT NULL,
    Subcategory VARCHAR(50),
    Note TEXT,
    DischargedBy VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_clientdischarges_type ON ClientDischarges (DischargeType, Subcategory);
CREATE INDEX IF NOT EXISTS idx_clientdischarges_client ON ClientDischarges (ClientId);
