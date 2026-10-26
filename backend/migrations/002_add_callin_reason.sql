-- Optional reason recorded with each call-in. Existing rows stay NULL.
ALTER TABLE EventLog ADD COLUMN IF NOT EXISTS CallInReason TEXT;
