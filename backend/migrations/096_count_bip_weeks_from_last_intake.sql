-- BIP clients came over from the old system at week 0, since it didn't track weeks. A BIP client's week is the number of
-- group attendances dated on or after their last BIP intake: a completed BIP Intake or DV Assessment done here, or one
-- recorded from another provider (lib/sql.js BIP_WEEKS). Every BIP client is counted that way once; each change is on the
-- account's change log. From here on check-ins and deletions keep it up to date (lib/bipWeeks.js).
CREATE TEMP TABLE BipWeekCounts ON COMMIT DROP AS
SELECT c.ClientId, c.Phase AS Before, (
    SELECT COUNT(*) FROM Attendance w
    WHERE w.Client = c.ClientId AND w.Type NOT IN ('Assessment', 'Individual')
      AND w.Date >= COALESCE((
          SELECT MAX(x.Done) FROM (
              SELECT a.Date AS Done FROM Attendance a JOIN SessionTypes st ON st.SessionTypeId = a.SessionTypeId
              WHERE a.Client = c.ClientId AND st.Kind = 'BIP Intake' AND a.AssessmentStatus IS DISTINCT FROM 'In Progress'
              UNION ALL
              SELECT o.AssessmentDate FROM OutsideBipAssessments o WHERE o.ClientId = c.ClientId
          ) x), '-infinity'::date)
)::text AS After
FROM Clients c
WHERE c.ProgramType = 'BIP';

INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details)
SELECT ClientId, 'System', 'Phase', CASE WHEN Before IS NOT NULL THEN 'Week ' || TRIM(Before) END, 'Week ' || After,
       'BIP week counted from the group attendances since the last intake.'
FROM BipWeekCounts WHERE TRIM(COALESCE(Before, '')) <> After;

UPDATE Clients c SET Phase = b.After
FROM BipWeekCounts b
WHERE c.ClientId = b.ClientId AND TRIM(COALESCE(c.Phase, '')) <> b.After;
