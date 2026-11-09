-- Bus passes a federal client may be granted (0 to 2). Granting one takes it off the count and adds a Bus Pass case note.
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS BusPasses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Clients ADD CONSTRAINT clients_buspasses_range CHECK (BusPasses BETWEEN 0 AND 2);
