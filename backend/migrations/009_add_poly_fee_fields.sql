-- Poly fee tracking per client: voucher count (0 or 1), cash paid toward the poly fee, and the poly fee itself (default 250).
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS PolyFeeVoucher INT NOT NULL DEFAULT 0 CHECK (PolyFeeVoucher BETWEEN 0 AND 1);
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS PolyFeePaid NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS PolyFee NUMERIC(10, 2) NOT NULL DEFAULT 250;
