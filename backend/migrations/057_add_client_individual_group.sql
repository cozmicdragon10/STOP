-- SO clients (State, Federal and Voluntary SO) can be in a regular group and/or a counselor's INDIVIDUAL group. The
-- individual group is kept apart from GroupId so a client can have both. Other programs still use GroupId for any group.
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS IndividualGroupId INT REFERENCES Groups(GroupId);
CREATE INDEX IF NOT EXISTS idx_clients_individualgroupid ON Clients(IndividualGroupId);

-- SO clients placed in an individual group's GroupId (by import/individualGroups.js) move to the new field
INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details)
SELECT c.ClientId, 'Data Import', 'Group', g.GroupName, NULL,
       'Moved to the new Individual Group field (' || g.GroupName || '); the regular group is now open.'
FROM Clients c JOIN Groups g ON g.GroupId = c.GroupId
WHERE UPPER(TRIM(g.ProgramType)) = 'INDIVIDUAL' AND c.ProgramType IN ('State SO', 'Federal SO', 'Voluntary SO');

UPDATE Clients c SET IndividualGroupId = c.GroupId, GroupId = NULL
FROM Groups g
WHERE g.GroupId = c.GroupId AND UPPER(TRIM(g.ProgramType)) = 'INDIVIDUAL'
  AND c.ProgramType IN ('State SO', 'Federal SO', 'Voluntary SO');
