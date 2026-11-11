-- Each time an Outlook draft of the monthly supervising agent (PO) reports is made, so the Reports tab can show which
-- agents have had their draft made for a month. A draft being made doesn't mean it was sent; sending happens in Outlook.
CREATE TABLE IF NOT EXISTS AgentReportDrafts (
    DraftId SERIAL PRIMARY KEY,
    ReportMonth DATE NOT NULL,
    AgentName VARCHAR(255) NOT NULL,
    AgentEmail VARCHAR(255),
    ClientCount INT NOT NULL,
    CreatedBy VARCHAR(255),
    CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS AgentReportDrafts_Month_Idx ON AgentReportDrafts (ReportMonth);
