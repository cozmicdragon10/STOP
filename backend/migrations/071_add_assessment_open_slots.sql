-- Open availability on the Assessments calendar, like polygraph slots: a counselor opens a time with no client (status
-- Open), and a client is assigned to it later (status Scheduled). Scheduled rows always have a client.
ALTER TABLE AssessmentAppointments ALTER COLUMN ClientId DROP NOT NULL;
ALTER TABLE AssessmentAppointments DROP CONSTRAINT IF EXISTS assessmentappointments_status_check;
ALTER TABLE AssessmentAppointments ADD CONSTRAINT assessmentappointments_status_check
    CHECK (Status IN ('Open', 'Scheduled', 'Cancelled'));
ALTER TABLE AssessmentAppointments DROP CONSTRAINT IF EXISTS assessmentappointments_client_check;
ALTER TABLE AssessmentAppointments ADD CONSTRAINT assessmentappointments_client_check
    CHECK (Status = 'Open' OR ClientId IS NOT NULL);
