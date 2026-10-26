-- The Adjusted columns keep what a corrected payment was first recorded as, and who corrected it and why.
ALTER TABLE FinancialTransactions
    ADD COLUMN IF NOT EXISTS AttendanceId INT,
    ADD COLUMN IF NOT EXISTS OriginalAmount NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS AdjustedBy VARCHAR(255),
    ADD COLUMN IF NOT EXISTS AdjustedOn TIMESTAMP,
    ADD COLUMN IF NOT EXISTS AdjustmentReason TEXT;

-- Attendance.CreatedOn orders check-ins against ledger rows; rows saved before it existed stay NULL.
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS CreatedOn TIMESTAMP;
ALTER TABLE Attendance ALTER COLUMN CreatedOn SET DEFAULT CURRENT_TIMESTAMP;

-- Refund, Dispute, and Dispute Won rows point at the credit card payment they belong to; the payment keeps its dispute status
ALTER TABLE FinancialTransactions
    ADD COLUMN IF NOT EXISTS RelatedTransactionId INT,
    ADD COLUMN IF NOT EXISTS DisputeStatus VARCHAR(20);
ALTER TABLE FinancialTransactions DROP CONSTRAINT IF EXISTS financialtransactions_type_check,
    ADD CONSTRAINT financialtransactions_type_check
        CHECK (Type IN ('Payment', 'Charge', 'Adjustment', 'Voucher', 'Refund', 'Dispute', 'Dispute Won'));

-- Vouchers the client had before paying the poly fee in full filled them; NULL while not filled by a payment
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS PolyVouchersBeforeFill INT;
