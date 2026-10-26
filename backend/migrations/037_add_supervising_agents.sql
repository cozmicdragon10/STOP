-- Probation officer directory. Clients link to an agent by name through Clients.SupervisingAgent (case and spacing ignored).
CREATE TABLE IF NOT EXISTS SupervisingAgents (
    AgentId SERIAL PRIMARY KEY,
    Name VARCHAR(255) NOT NULL,
    Phone VARCHAR(50),
    Email VARCHAR(255),
    CreatedBy VARCHAR(255),
    CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Older databases already had this table without the audit columns
ALTER TABLE SupervisingAgents
    ADD COLUMN IF NOT EXISTS CreatedBy VARCHAR(255),
    ADD COLUMN IF NOT EXISTS CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS SupervisingAgents_Name_Key ON SupervisingAgents (LOWER(TRIM(Name)));
