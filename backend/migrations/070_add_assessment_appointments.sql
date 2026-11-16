-- Assessments scheduled for a future date and time, on the Assessments calendar. Assessor is the counselor's display name
-- (as Clients.Assessor). A cancelled appointment stays on record. Closing the assessment itself still happens on the
-- Assessments tab, as a session.
CREATE TABLE IF NOT EXISTS AssessmentAppointments (
    AppointmentId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    Assessor VARCHAR(100) NOT NULL,
    ApptDate DATE NOT NULL,
    ApptTime TIME NOT NULL,
    Notes TEXT,
    Status VARCHAR(12) NOT NULL DEFAULT 'Scheduled' CHECK (Status IN ('Scheduled', 'Cancelled')),
    CreatedBy VARCHAR(255),
    CreatedOn TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assessmentappointments_date ON AssessmentAppointments (ApptDate);
CREATE INDEX IF NOT EXISTS idx_assessmentappointments_client ON AssessmentAppointments (ClientId);
