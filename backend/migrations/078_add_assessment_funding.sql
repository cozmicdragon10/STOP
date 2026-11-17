-- An assessment a Business Administrator begins without payment because a DHS invoice or a voucher covers it: the
-- client's account is not charged (GroupFee 0), and the price it was billed at is kept here so it can be invoiced.
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS FundedBy VARCHAR(20) CHECK (FundedBy IN ('DHS Invoice', 'Voucher'));
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS FundedPrice NUMERIC(10, 2);
