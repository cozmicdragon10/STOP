-- 071's check required a client on every time that wasn't Open, so cancelling an open time (no client) was refused.
-- Only Scheduled times need a client; Open and Cancelled times may have none.
ALTER TABLE AssessmentAppointments DROP CONSTRAINT IF EXISTS assessmentappointments_client_check;
ALTER TABLE AssessmentAppointments ADD CONSTRAINT assessmentappointments_client_check
    CHECK (Status <> 'Scheduled' OR ClientId IS NOT NULL);
