-- A discharge can have more than one subcategory, stored in list order joined by ', ' (e.g. 'Attendance, Polys');
-- widen the column so every combination fits
ALTER TABLE ClientDischarges ALTER COLUMN Subcategory TYPE VARCHAR(255);
