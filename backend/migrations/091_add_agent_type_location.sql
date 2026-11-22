-- Supervising agent directory: what kind of agent they are (probation, parole, DHS, ...) and where they work
ALTER TABLE SupervisingAgents
    ADD COLUMN IF NOT EXISTS AgentType VARCHAR(100),
    ADD COLUMN IF NOT EXISTS Location VARCHAR(255);
