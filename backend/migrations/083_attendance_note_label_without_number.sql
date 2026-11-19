-- Attendance notes no longer carry the client's attendance count: "Attendance #58 · Muskogee SO 2 · 11/19/2026: ..."
-- becomes "Attendance · Muskogee SO 2 · 11/19/2026: ..." (likewise "Individual Session #4"). BIP Week numbers stay.
-- Only notes linked to an attendance (migration 082) are changed.
UPDATE Notes
SET Comments = regexp_replace(Comments, '^(Attendance|Individual Session) #[0-9]+ · ', '\1 · ')
WHERE AttendanceId IS NOT NULL AND Comments ~ '^(Attendance|Individual Session) #[0-9]+ · ';
