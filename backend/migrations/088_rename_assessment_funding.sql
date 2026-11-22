-- Assessment funding sources are named 'DHS Voucher' and 'Invoice' (were 'Voucher' and 'DHS Invoice'). From now on the
-- client's account is charged the assessment fee when one of them is used; it only lets the assessment begin unpaid.
-- Assessments begun before this were not charged and stay as they are.
DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT con.conname FROM pg_constraint con
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
        WHERE con.conrelid = 'attendance'::regclass AND con.contype = 'c' AND att.attname = 'fundedby'
    LOOP
        EXECUTE format('ALTER TABLE Attendance DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

UPDATE Attendance SET FundedBy = 'DHS Voucher' WHERE FundedBy = 'Voucher';
UPDATE Attendance SET FundedBy = 'Invoice' WHERE FundedBy = 'DHS Invoice';
ALTER TABLE Attendance ADD CONSTRAINT attendance_fundedby_check CHECK (FundedBy IN ('DHS Voucher', 'Invoice'));
