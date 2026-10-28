-- A missed check-in for an earlier session used to set Last Date Attended back to that session's date.
-- Moves it forward to the client's latest attendance wherever it fell behind; later dates are left alone.
UPDATE Clients c
SET LastDateAttended = m.Latest
FROM (SELECT Client, MAX(Date) AS Latest FROM Attendance GROUP BY Client) m
WHERE m.Client = c.ClientId
  AND (c.LastDateAttended IS NULL OR c.LastDateAttended < m.Latest);
