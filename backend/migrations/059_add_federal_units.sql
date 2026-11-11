-- Federal billing units. FederalUnitCodes lists each billing code, which client programs it's tracked for, and its
-- price (set by Business Administrators under Admin > Billing Federal Units; blank until set). ClientFederalUnits holds
-- each client's number of units for a code; no row means blank.
CREATE TABLE IF NOT EXISTS FederalUnitCodes (
    Code VARCHAR(10) PRIMARY KEY,
    Label VARCHAR(100) NOT NULL,
    Programs TEXT[] NOT NULL,
    Price NUMERIC(10, 2) CHECK (Price >= 0),
    SortOrder INT NOT NULL DEFAULT 0,
    UpdatedBy VARCHAR(255),
    UpdatedOn TIMESTAMP
);

INSERT INTO FederalUnitCodes (Code, Label, Programs, SortOrder) VALUES
    ('6022', 'Group Units', ARRAY['Federal SO'], 1),
    ('6012', 'Individual Units', ARRAY['Federal SO'], 2),
    ('5022', 'Polygraph Units', ARRAY['Federal SO'], 3),
    ('5023', 'Polygraph Units', ARRAY['Federal SO'], 4),
    ('5012', 'SO Eval', ARRAY['Federal SO'], 5),
    ('5025', 'VTR/Able', ARRAY['Federal SO'], 6),
    ('6091', 'Chaperone', ARRAY['Federal SO'], 7),
    ('1010', 'Drug Test Unit', ARRAY['Fed Drug Test'], 8)
ON CONFLICT (Code) DO NOTHING;

CREATE TABLE IF NOT EXISTS ClientFederalUnits (
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    Code VARCHAR(10) NOT NULL REFERENCES FederalUnitCodes(Code),
    Units NUMERIC(10, 2) NOT NULL CHECK (Units >= 0),
    PRIMARY KEY (ClientId, Code)
);
