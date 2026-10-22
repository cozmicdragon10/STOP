-- Files saved to a client's account (Attachments tab). The file bytes are stored in Data.
CREATE TABLE IF NOT EXISTS ClientAttachments (
    AttachmentId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    FileName VARCHAR(255) NOT NULL,
    ContentType VARCHAR(255) NOT NULL,
    FileSize INT NOT NULL,
    Data BYTEA NOT NULL,
    UploadedBy VARCHAR(255),
    UploadedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_clientattachments_client ON ClientAttachments (ClientId);
