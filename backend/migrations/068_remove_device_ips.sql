-- Device IP addresses are no longer kept or shown (the owner doesn't need them). The wrong-attempt lockouts still tell
-- connections apart, in memory only (lib/devices.js).
ALTER TABLE Devices DROP COLUMN IF EXISTS FirstIp;
ALTER TABLE Devices DROP COLUMN IF EXISTS LastIp;
