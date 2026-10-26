-- Notes show "edited" once changed; the original text is kept in the system log
ALTER TABLE Notes ADD COLUMN IF NOT EXISTS EditedBy VARCHAR(255), ADD COLUMN IF NOT EXISTS EditedOn TIMESTAMP;
