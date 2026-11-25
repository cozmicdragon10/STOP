-- Ledger rows rebuilt from the old system (import/importLedger.js): fees and payments of imported check-ins and the old
-- system's account-only payments. They have no payment method and are locked: they can't be adjusted, refunded or moved.
ALTER TABLE FinancialTransactions ADD COLUMN IF NOT EXISTS Imported BOOLEAN NOT NULL DEFAULT FALSE;
