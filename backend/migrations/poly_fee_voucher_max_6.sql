-- Poly fee voucher now runs 0-6; a fully paid poly fee fills it to 6.
ALTER TABLE Clients DROP CONSTRAINT IF EXISTS clients_polyfeevoucher_check;
ALTER TABLE Clients ADD CONSTRAINT clients_polyfeevoucher_check CHECK (PolyFeeVoucher BETWEEN 0 AND 6);
