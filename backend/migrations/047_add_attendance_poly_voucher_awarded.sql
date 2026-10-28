-- Marks the check-in that earned the client a poly fee voucher (closing an SO group after a last polygraph that earns
-- one), so deleting that attendance can take the voucher back. Check-ins saved before this column existed stay FALSE.
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS PolyVoucherAwarded BOOLEAN NOT NULL DEFAULT FALSE;
