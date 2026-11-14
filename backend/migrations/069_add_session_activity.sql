-- When a session was last used, and the approved device it was started on (see backend/lib/auth.js). A session ends
-- after SESSION_IDLE_MINUTES (2 hours) without activity, as well as SESSION_HOURS (12) after login. Existing sessions
-- count as active now and have no device.
ALTER TABLE Sessions ADD COLUMN IF NOT EXISTS LastActiveOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE Sessions ADD COLUMN IF NOT EXISTS DeviceId INT REFERENCES Devices (DeviceId) ON DELETE SET NULL;
