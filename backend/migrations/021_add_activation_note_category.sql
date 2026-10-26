-- Allow Activation case notes, written when a discharged client is set back to Active or Inactive
ALTER TABLE Notes DROP CONSTRAINT IF EXISTS notes_category_check;
ALTER TABLE Notes ADD CONSTRAINT notes_category_check CHECK (Category IN ('Therapist', 'Admin', 'Call-In', 'Polygraph', 'Attendance', 'Discharge', 'Activation'));
