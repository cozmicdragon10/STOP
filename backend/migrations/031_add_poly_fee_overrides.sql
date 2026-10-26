-- The override ends once its last fill has been used (the vouchers spent scheduling a polygraph); PolyFee then goes back
-- to RegularFee. Ending it at the fill itself would leave that payment measured against the regular fee when it's spent.
CREATE TABLE IF NOT EXISTS PolyFeeOverrides (
    OverrideId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    ReducedFee NUMERIC(10, 2) NOT NULL,
    RegularFee NUMERIC(10, 2) NOT NULL,
    FillsAllowed INT NOT NULL,
    FillsUsed INT NOT NULL DEFAULT 0,
    CreatedBy VARCHAR(255),
    CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    EndedOn TIMESTAMP
);
