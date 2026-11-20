-- Other payments (lib/paymentMethods.js): PaymentMethod 'Other' with what kind it was (Check, Money Order, Cashier's
-- Check, Direct Deposit, Tribal, DHS) and an optional reference number (check #, money order #, ...). NULL for cash
-- and card payments. Attendance carries them for payments taken at check-in, like PaymentMethod.
ALTER TABLE FinancialTransactions ADD COLUMN IF NOT EXISTS PaymentSubtype VARCHAR(50);
ALTER TABLE FinancialTransactions ADD COLUMN IF NOT EXISTS PaymentReference VARCHAR(100);
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS PaymentSubtype VARCHAR(50);
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS PaymentReference VARCHAR(100);
