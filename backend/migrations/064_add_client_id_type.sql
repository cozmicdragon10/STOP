-- The client's ID # (stored in DOCNumber) isn't always a DOC number: federal clients have PACTS numbers, BIP clients
-- often court case numbers, and some DHS or OCS numbers. DocType says which kind it is (blank = not set).
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS DocType TEXT
    CHECK (DocType IN ('DOC', 'PACTS', 'Case #', 'DHS', 'OCS'));

-- The same number can belong to two kinds (DOC 1260 and PACTS 1260), so it's unique per kind instead of overall
ALTER TABLE Clients DROP CONSTRAINT IF EXISTS clients_docnumber_key;
DROP INDEX IF EXISTS clients_docnumber_key;
CREATE UNIQUE INDEX IF NOT EXISTS clients_doctype_docnumber_key ON Clients (COALESCE(DocType, ''), DOCNumber);
