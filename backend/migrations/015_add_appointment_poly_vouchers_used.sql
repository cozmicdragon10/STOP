-- Poly fee vouchers a booking used, so cancelling it refunds exactly that many. Bookings made before vouchers stay 0.
ALTER TABLE PolygraphAppointments ADD COLUMN IF NOT EXISTS PolyVouchersUsed INT NOT NULL DEFAULT 0;
