-- Closed assessments and individual sessions are attendance rows of type Assessment or IndividualALTER TABLE Attendance DROP CONSTRAINT IF EXISTS attendance_type_check;
ALTER TABLE Attendance ADD CONSTRAINT attendance_type_check CHECK (Type IN ('Group', 'Call-In', 'Make-Up', 'Holiday', 'Closure', 'Assessment', 'Individual'));
