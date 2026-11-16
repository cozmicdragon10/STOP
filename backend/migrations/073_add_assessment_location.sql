-- Where an assessment time is held (an office or town), shown on the Assessments calendar and the counselor's My Day.
-- Times opened before this have none.
ALTER TABLE AssessmentAppointments ADD COLUMN IF NOT EXISTS Location VARCHAR(150);
