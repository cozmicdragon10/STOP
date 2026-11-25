-- A client's time on the Assessment Calendar remembers the assessment begun from it (the Attendance row), so the calendar
-- can show it as begun or completed and stop offering Reschedule / Unassign / Cancel on it.
ALTER TABLE AssessmentAppointments ADD COLUMN IF NOT EXISTS AttendanceId INT
    REFERENCES Attendance(AttendanceId) ON DELETE SET NULL;

-- Times already begun before this link existed: a scheduled time whose open session is gone, matched to that client's
-- assessment recorded after the time was made. Each time takes its nearest assessment, and each assessment goes to only
-- one time (the nearest).
WITH candidates AS (
    SELECT ap.AppointmentId, a.AttendanceId, abs(a.Date - ap.ApptDate) AS gap
    FROM AssessmentAppointments ap
    JOIN Attendance a ON a.Client = ap.ClientId AND a.Type = 'Assessment' AND a.AssessmentStatus IS NOT NULL
                     AND COALESCE(a.CreatedOn, a.Date::timestamp) >= ap.CreatedOn::date
    WHERE ap.Status = 'Scheduled' AND ap.ClientId IS NOT NULL AND ap.AttendanceId IS NULL
      AND NOT EXISTS (SELECT 1 FROM OpenIndividualSessions o WHERE o.AssessmentAppointmentId = ap.AppointmentId)
      AND NOT EXISTS (SELECT 1 FROM AssessmentAppointments x WHERE x.AttendanceId = a.AttendanceId)
), nearest AS (
    SELECT DISTINCT ON (AppointmentId) AppointmentId, AttendanceId, gap FROM candidates ORDER BY AppointmentId, gap, AttendanceId
), chosen AS (
    SELECT DISTINCT ON (AttendanceId) AppointmentId, AttendanceId FROM nearest ORDER BY AttendanceId, gap, AppointmentId
)
UPDATE AssessmentAppointments ap SET AttendanceId = chosen.AttendanceId
FROM chosen WHERE chosen.AppointmentId = ap.AppointmentId;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assessmentappointments_attendance
    ON AssessmentAppointments (AttendanceId) WHERE AttendanceId IS NOT NULL;
