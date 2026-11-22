-- BIP clients brought over from the old system with a $150.00 or $75.00 treatment fee (the old system kept other prices,
-- such as the assessment price, in that field). The treatment fee is the per-attendance group fee, so these clients
-- take the BIP price from the price list (ProgramFees). Each change is on the account's change log.
INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details)
SELECT c.ClientId, 'System', 'Treatment Fee', '$' || to_char(c.TreatmentFee, 'FM999990.00'), '$' || to_char(f.Fee, 'FM999990.00'),
       'Treatment fee from the old system set to the BIP group fee.'
FROM Clients c
JOIN ProgramFees f ON f.FeeKey = 'BIP'
WHERE c.ProgramType = 'BIP' AND c.TreatmentFee IN (150, 75) AND c.TreatmentFee <> f.Fee;

UPDATE Clients c SET TreatmentFee = f.Fee
FROM ProgramFees f
WHERE f.FeeKey = 'BIP' AND c.ProgramType = 'BIP' AND c.TreatmentFee IN (150, 75) AND c.TreatmentFee <> f.Fee;
