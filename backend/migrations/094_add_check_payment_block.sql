-- Business Administrators can stop a client from paying by check (e.g. after one of their checks bounced or was denied).
-- While CheckPaymentsBlocked is set the server refuses check payments for the client (lib/checkBlock.js); cash, card,
-- money orders and cashier's checks are still taken.
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS CheckPaymentsBlocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS CheckBlockReason TEXT;
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS CheckBlockedBy VARCHAR(255);
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS CheckBlockedOn TIMESTAMP;
