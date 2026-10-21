-- Set when a Business Administrator lets an Inconclusive or No Opinion result keep the client in the NDI voucher incentive
ALTER TABLE PolygraphResults ADD COLUMN IF NOT EXISTS IncentiveContinued BOOLEAN NOT NULL DEFAULT FALSE;
