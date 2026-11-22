-- The ID # dropdown gets an "Other" kind for numbers that aren't DOC, PACTS, Case #, DHS or OCS
ALTER TABLE Clients DROP CONSTRAINT IF EXISTS clients_doctype_check;
ALTER TABLE Clients ADD CONSTRAINT clients_doctype_check
    CHECK (DocType IN ('DOC', 'PACTS', 'Case #', 'DHS', 'OCS', 'Other'));
