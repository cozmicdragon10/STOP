-- Indexes for looking up a client's history. The original tables were created before migrations and only have their
-- primary keys, so every per-client lookup (ledger, attendance, notes, Last Attended on the roster) read the whole table.

-- Per client, newest first: the account drawer's sections, Last Attended / Last Poly, and the monthly fee rule
CREATE INDEX IF NOT EXISTS idx_attendance_client_date ON Attendance (Client, Date);
CREATE INDEX IF NOT EXISTS idx_financialtransactions_client_date ON FinancialTransactions (Client, Date);
CREATE INDEX IF NOT EXISTS idx_notes_client_date ON Notes (Client, Date);
CREATE INDEX IF NOT EXISTS idx_polygraphresults_client_date ON PolygraphResults (Client, Date);
CREATE INDEX IF NOT EXISTS idx_polygraphappointments_client ON PolygraphAppointments (Client);
CREATE INDEX IF NOT EXISTS idx_eventlog_client ON EventLog (Client);
CREATE INDEX IF NOT EXISTS idx_testing_client ON Testing (Client);
CREATE INDEX IF NOT EXISTS idx_vouchers_client ON Vouchers (Client);
CREATE INDEX IF NOT EXISTS idx_clientchangelog_client ON ClientChangeLog (ClientId);
CREATE INDEX IF NOT EXISTS idx_temporaryfeeoverrides_client ON TemporaryFeeOverrides (ClientId);
CREATE INDEX IF NOT EXISTS idx_polyfeeoverrides_client ON PolyFeeOverrides (ClientId);
CREATE INDEX IF NOT EXISTS idx_outsidebipassessments_client ON OutsideBipAssessments (ClientId);
CREATE INDEX IF NOT EXISTS idx_openindividualsessions_client ON OpenIndividualSessions (ClientId);

-- Group check-in and closed session lookups
CREATE INDEX IF NOT EXISTS idx_attendance_group_date ON Attendance ("Group", Date);
CREATE INDEX IF NOT EXISTS idx_polygraphappointments_slot ON PolygraphAppointments (SlotId);

-- Reports over a date range
CREATE INDEX IF NOT EXISTS idx_attendance_date ON Attendance (Date);
CREATE INDEX IF NOT EXISTS idx_financialtransactions_date ON FinancialTransactions (Date);
CREATE INDEX IF NOT EXISTS idx_notes_date ON Notes (Date);

-- System log, newest first
CREATE INDEX IF NOT EXISTS idx_systemlogs_timestamp ON SystemLogs (Timestamp);
