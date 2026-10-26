-- Confirms the cash collected at one group session was taken to the bank. Over/short is AmountDeposited minus the
-- session's cash; the report works it out from current attendance so later attendance edits show up as a difference.
CREATE TABLE IF NOT EXISTS GroupDeposits (
    DepositId SERIAL PRIMARY KEY,
    GroupId INT NOT NULL REFERENCES Groups(GroupId) ON DELETE CASCADE,
    SessionDate DATE NOT NULL,
    SessionNumber INT NOT NULL DEFAULT 1,
    AmountDeposited NUMERIC(10, 2) NOT NULL,
    DepositDate DATE NOT NULL,
    Notes TEXT,
    RecordedBy VARCHAR(255),
    RecordedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (GroupId, SessionDate, SessionNumber)
);
