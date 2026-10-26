-- One-client sessions that work like a group check-in: saved as open, then closed, which records the attendance, the fee,
-- and any payment. The price list (SessionTypes) is kept by Business Administrators in Admin.
CREATE TABLE IF NOT EXISTS SessionTypes (
    SessionTypeId SERIAL PRIMARY KEY,
    Category VARCHAR(20) NOT NULL CHECK (Category IN ('Assessment', 'Individual')),
    Name VARCHAR(100) NOT NULL,
    Fee NUMERIC(10, 2) NOT NULL CHECK (Fee >= 0),
    Active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (Category, Name)
);

CREATE TABLE IF NOT EXISTS OpenIndividualSessions (
    OpenSessionId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    Category VARCHAR(20) NOT NULL CHECK (Category IN ('Assessment', 'Individual')),
    SessionTypeId INT NOT NULL REFERENCES SessionTypes(SessionTypeId),
    SessionDate DATE NOT NULL,
    Fee NUMERIC(10, 2) NOT NULL DEFAULT 0,
    Payment NUMERIC(10, 2) NOT NULL DEFAULT 0,
    PaymentMethod TEXT,
    Provider VARCHAR(255),
    Comments TEXT,
    CreatedBy VARCHAR(255),
    CreatedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The price list entry and the counselor/therapist (display name) of a closed assessment or individual session
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS SessionTypeId INT REFERENCES SessionTypes(SessionTypeId);
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS Provider VARCHAR(255);
-- Comments for the payment, kept apart from the session's own comments; added to the payment's ledger row on close
ALTER TABLE OpenIndividualSessions ADD COLUMN IF NOT EXISTS PaymentComments TEXT;

-- BipOnly: only BIP clients can have it. Kind: a 'BIP Intake' (BIP Intake, DV Assessment) starts the reinstate clock; a
-- 'BIP Reinstate' is priced by the time since the client's last intake: Fee under 6 months, LateFee from 6 months to a year,
-- and refused after a year (a new intake is needed instead).
ALTER TABLE SessionTypes ADD COLUMN IF NOT EXISTS BipOnly BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS Kind VARCHAR(20) NOT NULL DEFAULT 'Standard' CHECK (Kind IN ('Standard', 'BIP Intake', 'BIP Reinstate')),
    ADD COLUMN IF NOT EXISTS LateFee NUMERIC(10, 2) CHECK (LateFee >= 0);

-- A BIP Intake or DV Assessment a BIP client completed at another provider. It counts as a completed intake for group
-- check-in and starts the reinstate clock like one done here.
CREATE TABLE IF NOT EXISTS OutsideBipAssessments (
    OutsideAssessmentId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    AssessmentType VARCHAR(20) NOT NULL CHECK (AssessmentType IN ('BIP Intake', 'DV Assessment')),
    AssessmentDate DATE NOT NULL,
    ProviderName VARCHAR(255) NOT NULL,
    Notes TEXT,
    RecordedBy VARCHAR(255),
    RecordedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Attendance types now include Assessment and Individual (same as 027, kept here for databases where 027 was never run by hand)
ALTER TABLE Attendance DROP CONSTRAINT IF EXISTS attendance_type_check;
ALTER TABLE Attendance ADD CONSTRAINT attendance_type_check CHECK (Type IN ('Group', 'Call-In', 'Make-Up', 'Holiday', 'Closure', 'Assessment', 'Individual'));
