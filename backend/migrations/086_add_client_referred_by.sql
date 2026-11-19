-- Who referred the client: the kind of referral (Criminal Court, DHS, Tribal, Self; lib/clientId.js REFERRAL_TYPES) and
-- the details typed beside it (e.g. the court or caseworker), shown as one field like the ID #. Both optional.
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS ReferredByType VARCHAR(50);
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS ReferredBy TEXT;
