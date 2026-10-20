-- Date a group call-in is for, when it differs from the day it was submitted. NULL means submitted for that day.
ALTER TABLE EventLog ADD COLUMN IF NOT EXISTS CallInDate DATE;
