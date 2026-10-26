-- When the polygraph took place (the slot's date and time). Date stays the day the result was recorded.
ALTER TABLE PolygraphResults ADD COLUMN IF NOT EXISTS PolygraphDateTime TIMESTAMP;
