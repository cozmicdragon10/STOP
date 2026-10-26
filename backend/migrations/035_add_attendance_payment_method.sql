-- Payment method (Cash or Credit Card) taken at check-in, for the group income report. Rows saved before this column
-- existed are filled in from the payment ledger when exactly one payment matches; the rest stay unrecorded.
ALTER TABLE Attendance ADD COLUMN IF NOT EXISTS PaymentMethod TEXT;

UPDATE Attendance a SET PaymentMethod = m.PaymentMethod
FROM (
    SELECT a2.AttendanceId, MIN(f.PaymentMethod) AS PaymentMethod
    FROM Attendance a2
    JOIN FinancialTransactions f ON f.Client = a2.Client AND f.Type = 'Payment'
        AND f.Comments = 'Payment applied during ' || a2.Type || ' session on ' || to_char(a2.Date, 'YYYY-MM-DD') || '.'
    WHERE a2.AccountPaid > 0 AND a2.PaymentMethod IS NULL
    GROUP BY a2.AttendanceId
    HAVING COUNT(*) = 1
) m
WHERE a.AttendanceId = m.AttendanceId AND m.PaymentMethod IS NOT NULL;
