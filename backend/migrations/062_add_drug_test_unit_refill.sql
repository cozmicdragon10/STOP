-- 1010 Drug Test Units get the monthly refill too (like 6022 and 6012); each drug test session uses one unit
UPDATE FederalUnitCodes SET Refillable = TRUE WHERE Code = '1010';
