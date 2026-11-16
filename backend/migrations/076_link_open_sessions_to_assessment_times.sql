-- A client given an assessment time on the Assessment Calendar gets an open Assessment session for that date, with the
-- assessor as its counselor. The assessment type (and so the fee) is chosen when the session is reviewed and closed, so an
-- open session may have no type yet. The link keeps the session in step when the time is unassigned, cancelled or moved.
ALTER TABLE OpenIndividualSessions ALTER COLUMN SessionTypeId DROP NOT NULL;
ALTER TABLE OpenIndividualSessions ADD COLUMN IF NOT EXISTS AssessmentAppointmentId INT
    REFERENCES AssessmentAppointments(AppointmentId) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_openindividualsessions_appointment
    ON OpenIndividualSessions (AssessmentAppointmentId) WHERE AssessmentAppointmentId IS NOT NULL;

-- Clients already scheduled from today on get their open session now
INSERT INTO OpenIndividualSessions (ClientId, Category, SessionTypeId, SessionDate, Fee, Payment, Provider, Comments, CreatedBy, AssessmentAppointmentId)
SELECT a.ClientId, 'Assessment', NULL, a.ApptDate, 0, 0, a.Assessor,
       'From the Assessment Calendar: ' || to_char(a.ApptTime, 'FMHH12:MI AM') || COALESCE(', ' || NULLIF(TRIM(a.Location), ''), '') || '.',
       a.CreatedBy, a.AppointmentId
FROM AssessmentAppointments a
WHERE a.Status = 'Scheduled' AND a.ClientId IS NOT NULL AND a.ApptDate >= CURRENT_DATE
  AND NOT EXISTS (SELECT 1 FROM OpenIndividualSessions o WHERE o.AssessmentAppointmentId = a.AppointmentId);
