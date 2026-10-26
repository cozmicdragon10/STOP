-- Login sessions (see backend/lib/auth.js). TokenHash is the SHA-256 of the token the browser holds; the token itself is never stored.
CREATE TABLE IF NOT EXISTS Sessions (
    TokenHash CHAR(64) PRIMARY KEY,
    EmployeeEmail VARCHAR(255) NOT NULL,
    CreatedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ExpiresOn TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_employee ON Sessions (LOWER(EmployeeEmail));
