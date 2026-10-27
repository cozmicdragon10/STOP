-- SoOnly: only SO clients (State SO, Federal SO, Voluntary SO) can have this price list entry. Never set with BipOnly.
ALTER TABLE SessionTypes ADD COLUMN IF NOT EXISTS SoOnly BOOLEAN NOT NULL DEFAULT FALSE;
