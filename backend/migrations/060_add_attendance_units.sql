-- Federal SO clients use units (tokens granted on their Form 45) for group (6022) and individual (6012) sessions.
-- When the group is closed the counselor picks how long the client attended; the units it used are taken off the
-- client's ClientFederalUnits and recorded here, so deleting the attendance can give them back.
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS DurationBand VARCHAR(20);
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS UnitCode VARCHAR(10);
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS UnitsUsed NUMERIC(10, 2);
