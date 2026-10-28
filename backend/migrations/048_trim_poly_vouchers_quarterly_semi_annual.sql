-- Phase 3 (Quarterly) clients now hold at most 2 poly fee vouchers and Phase 4 (Semi Anual) clients at most 1 (see
-- POLY_VOUCHER_MAX_BY_PHASE in lib/poly.js). Clients already over their phase's full set are trimmed to it, with the
-- change on each account's change log.
INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details)
SELECT ClientId, 'System', 'Poly Fee Vouchers', PolyFeeVoucher::text,
       (CASE Phase WHEN 'Phase 3 - Quarterly' THEN 2 ELSE 1 END)::text,
       'Poly fee vouchers trimmed to the full set for ' || Phase || ' clients.'
FROM Clients
WHERE (Phase = 'Phase 3 - Quarterly' AND PolyFeeVoucher > 2)
   OR (Phase = 'Phase 4 - Semi Anual' AND PolyFeeVoucher > 1);

UPDATE Clients SET PolyFeeVoucher = CASE Phase WHEN 'Phase 3 - Quarterly' THEN 2 ELSE 1 END
WHERE (Phase = 'Phase 3 - Quarterly' AND PolyFeeVoucher > 2)
   OR (Phase = 'Phase 4 - Semi Anual' AND PolyFeeVoucher > 1);
