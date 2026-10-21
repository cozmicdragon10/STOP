-- Group check-ins saved with Finish Check-In and not yet closed. One open sheet per group per session date.
-- Entries holds the attendance sheet (clients, fees, payments, notes) as the frontend built it.
CREATE TABLE IF NOT EXISTS OpenGroupSessions (
    OpenSessionId SERIAL PRIMARY KEY,
    GroupId INTEGER NOT NULL REFERENCES Groups(GroupId) ON DELETE CASCADE,
    SessionDate DATE NOT NULL,
    Entries JSONB NOT NULL,
    CreatedBy VARCHAR(255),
    UpdatedOn TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (GroupId, SessionDate)
);
