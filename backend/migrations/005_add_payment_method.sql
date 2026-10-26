-- Records how an account payment was made (Cash or Credit Card). Existing rows stay NULL.
ALTER TABLE FinancialTransactions ADD COLUMN IF NOT EXISTS PaymentMethod TEXT;
