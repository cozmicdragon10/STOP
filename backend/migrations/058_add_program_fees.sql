-- Standard treatment fees kept by Business Administrators in Admin: the State SO / Voluntary SO price for each phase
-- and the BIP price. A client's own TreatmentFee is set from these when they're added or change phase (or program);
-- the Admin screen can also move clients still on the old price to a new one.
CREATE TABLE IF NOT EXISTS ProgramFees (
    FeeKey VARCHAR(50) PRIMARY KEY,
    Label VARCHAR(100) NOT NULL,
    Fee NUMERIC(10, 2) NOT NULL CHECK (Fee >= 0),
    SortOrder INT NOT NULL DEFAULT 0,
    UpdatedBy VARCHAR(255),
    UpdatedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The prices the app used before they were editable
INSERT INTO ProgramFees (FeeKey, Label, Fee, SortOrder) VALUES
    ('Phase 1 - Weekly', 'State SO Phase 1 - Weekly', 180, 1),
    ('Phase 2 - Monthly', 'State SO Phase 2 - Monthly', 100, 2),
    ('Phase 3 - Quarterly', 'State SO Phase 3 - Quarterly', 180, 3),
    ('Phase 4 - Semi Anual', 'State SO Phase 4 - Semi Anual', 300, 4),
    ('BIP', 'BIP', 35, 5)
ON CONFLICT (FeeKey) DO NOTHING;
