-- Allow Discharge case notes, written when a Business Administrator discharges a client
ALTER TABLE Notes DROP CONSTRAINT IF EXISTS notes_category_check;
ALTER TABLE Notes ADD CONSTRAINT notes_category_check CHECK (Category IN ('Therapist', 'Admin', 'Call-In', 'Polygraph', 'Attendance', 'Discharge'));
