-- Approved devices (see docs/device-approval-plan.md). A browser holds a random token in an HTTP-only cookie; only its
-- SHA-256 hash is stored here. A device can use the app only while its Status is 'approved'.
CREATE TABLE IF NOT EXISTS Devices (
    DeviceId SERIAL PRIMARY KEY,
    TokenHash CHAR(64) UNIQUE,
    Status TEXT NOT NULL CHECK (Status IN ('pending', 'approved', 'denied', 'revoked', 'expired')),
    Name TEXT NOT NULL,
    RequestName TEXT,
    RequestEmail TEXT,
    RequestRole TEXT,
    RequestNote TEXT,
    UserAgent TEXT,
    FirstIp TEXT,
    LastIp TEXT,
    LastSeenOn TIMESTAMPTZ,
    RequestedOn TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ExpiresOn TIMESTAMPTZ,
    DecidedOn TIMESTAMPTZ,
    DecidedBy TEXT,
    ApprovalMemo TEXT,
    SetupCodeHash CHAR(64),
    SetupCodeExpiresOn TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_devices_status ON Devices (Status);
