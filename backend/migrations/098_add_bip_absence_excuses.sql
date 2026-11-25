-- A BIP client's missed group week that a Business Administrator (or DEV) excused: it isn't counted as an absence toward
-- the 2-in-a-row or 7-total limits (lib/bipAbsences.js). WeekOf is the Sunday of the week the meeting was in.
CREATE TABLE IF NOT EXISTS BipAbsenceExcuses (
    ExcuseId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    WeekOf DATE NOT NULL,
    Reason VARCHAR(500) NOT NULL,
    ExcusedBy VARCHAR(255) NOT NULL,
    ExcusedOn TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (ClientId, WeekOf)
);
