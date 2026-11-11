-- Business Administrators can stop a client from paying by credit card (e.g. after a card payment was disputed).
-- While CardPaymentsBlocked is set the server refuses card payments for the client; cash is still taken.
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS CardPaymentsBlocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS CardBlockReason TEXT;
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS CardBlockedBy VARCHAR(255);
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS CardBlockedOn TIMESTAMP;
