-- Same table as 018 (which also backfills it). The server created it on every startup before migrations were tracked,
-- so this keeps databases where 018 was never run by hand in step.
CREATE TABLE IF NOT EXISTS ClientChangeLog (
    ChangeId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    ChangedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ChangedBy VARCHAR(255),
    ChangeType VARCHAR(50) NOT NULL,
    OldValue TEXT,
    NewValue TEXT,
    Details TEXT,
    ExpiresOn DATE
);
