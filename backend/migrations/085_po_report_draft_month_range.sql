-- PO report drafts can cover a range of months (Monthly PO Reports > From / To). ReportMonth is the first month and
-- ReportMonthEnd the last (both the 1st of the month); NULL means a single month, as every draft before this was.
ALTER TABLE AgentReportDrafts ADD COLUMN IF NOT EXISTS ReportMonthEnd DATE;
