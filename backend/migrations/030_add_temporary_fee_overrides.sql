-- A reduced treatment fee that applies through ExpirationDate (inclusive); after that the client's regular TreatmentFee applies again.
CREATE TABLE IF NOT EXISTS TemporaryFeeOverrides (
    OverrideId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    ReducedFee NUMERIC(10, 2) NOT NULL,
    ExpirationDate DATE NOT NULL,
    CreatedBy VARCHAR(255),
    CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
