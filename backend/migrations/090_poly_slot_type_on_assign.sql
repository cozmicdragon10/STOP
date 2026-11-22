-- A polygraph slot's type is chosen when a client is assigned, not when the slot is created.
-- Open slots have no type; existing open slots are cleared so they don't show a type nobody picked.
ALTER TABLE PolygraphSlots ALTER COLUMN Type DROP NOT NULL;
UPDATE PolygraphSlots SET Type = NULL WHERE IsFilled = FALSE;
