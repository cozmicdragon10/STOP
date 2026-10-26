-- DOC # and supervising agent are optional when creating a client. Existing rows are unaffected.
ALTER TABLE Clients ALTER COLUMN DOCNumber DROP NOT NULL;
ALTER TABLE Clients ALTER COLUMN SupervisingAgent DROP NOT NULL;
