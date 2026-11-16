-- Case note categories:
-- 'Assessment': taking a client off a scheduled assessment time adds one, with the reason.
-- 'Bus Pass': granting a bus pass adds one (routes/clients.js); the category was missing, so that save was refused.
ALTER TABLE Notes DROP CONSTRAINT IF EXISTS notes_category_check;
ALTER TABLE Notes ADD CONSTRAINT notes_category_check CHECK (Category IN (
    'Therapist', 'Admin', 'Call-In', 'Polygraph', 'Attendance', 'Discharge', 'Activation', 'Group Cancel', 'Group Reschedule',
    'Assessment', 'Bus Pass'));
