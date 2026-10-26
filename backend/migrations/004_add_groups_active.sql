-- Adds the Active flag used to deactivate groups. Existing groups default to active.
ALTER TABLE Groups ADD COLUMN IF NOT EXISTS Active BOOLEAN NOT NULL DEFAULT TRUE;
