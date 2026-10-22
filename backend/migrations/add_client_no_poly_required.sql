-- Set by Business Administrator override when a client does not need polygraphs
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS NoPolyRequired BOOLEAN NOT NULL DEFAULT FALSE;
