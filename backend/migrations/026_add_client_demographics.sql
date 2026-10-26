-- Race, date of birth, and sex on the client's Personal Information
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS Race VARCHAR(100);
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS DateOfBirth DATE;
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS Sex VARCHAR(20);
