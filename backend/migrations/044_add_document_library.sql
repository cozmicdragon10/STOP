-- Blank forms and documents kept for printing (intake paperwork, contracts, releases), on the Forms page. Not tied to
-- a client. The file bytes are stored in Data, like ClientAttachments.
CREATE TABLE IF NOT EXISTS LibraryDocuments (
    DocumentId SERIAL PRIMARY KEY,
    FileName VARCHAR(255) NOT NULL,
    ContentType VARCHAR(255) NOT NULL,
    FileSize INT NOT NULL,
    Data BYTEA NOT NULL,
    Category VARCHAR(100) NOT NULL DEFAULT 'General',
    Description VARCHAR(500),
    UploadedBy VARCHAR(255),
    UploadedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
