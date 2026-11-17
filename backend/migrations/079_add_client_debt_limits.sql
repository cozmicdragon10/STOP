-- Max Debt Override (Business Administrators): through its expiration date the client may owe up to MaxOwed and still
-- attend. It raises the balance a group or individual check-in allows (normally $0.00 at the first one of the month,
-- each one for Chaperon clients) and lets an assessment begin with up to that much owed after its fee. The newest
-- unexpired row is the one in effect; removing an override deletes it, as with TemporaryFeeOverrides.
CREATE TABLE IF NOT EXISTS ClientDebtLimits (
    DebtLimitId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    MaxOwed NUMERIC(10, 2) NOT NULL CHECK (MaxOwed > 0),
    ExpirationDate DATE NOT NULL,
    CreatedBy VARCHAR(255),
    CreatedOn TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clientdebtlimits_client ON ClientDebtLimits (ClientId, ExpirationDate);
