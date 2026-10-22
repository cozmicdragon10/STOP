-- History shown on the client Change Log tab (Business Administrators only). The server also creates this table at startup.
CREATE TABLE IF NOT EXISTS ClientChangeLog (
    ChangeId SERIAL PRIMARY KEY,
    ClientId INT NOT NULL REFERENCES Clients(ClientId) ON DELETE CASCADE,
    ChangedOn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ChangedBy VARCHAR(255),
    ChangeType VARCHAR(50) NOT NULL,
    OldValue TEXT,
    NewValue TEXT,
    Details TEXT,
    ExpiresOn DATE
);

-- Backfill what was recorded before the log existed (runs once: skipped when the log already has rows)
INSERT INTO ClientChangeLog (ClientId, ChangedOn, ChangedBy, ChangeType, OldValue, NewValue, Details)
SELECT n.Client, n.Date, n."User", 'No Poly Required',
       CASE WHEN n.Comments LIKE 'No Poly Required checked%' THEN 'Unchecked' ELSE 'Checked' END,
       CASE WHEN n.Comments LIKE 'No Poly Required checked%' THEN 'Checked' ELSE 'Unchecked' END,
       'Business Administrator override.'
FROM Notes n
WHERE n.Comments LIKE 'No Poly Required %checked by Business Administrator override.'
  AND NOT EXISTS (SELECT 1 FROM ClientChangeLog);

INSERT INTO ClientChangeLog (ClientId, ChangedOn, ChangedBy, ChangeType, NewValue, Details, ExpiresOn)
SELECT o.ClientId, o.CreatedOn, o.CreatedBy, 'Fee Override',
       '$' || to_char(o.ReducedFee, 'FM999999990.00') || ' through ' || to_char(o.ExpirationDate, 'MM/DD/YYYY'),
       'Temporary fee override activated.', o.ExpirationDate
FROM TemporaryFeeOverrides o
WHERE NOT EXISTS (SELECT 1 FROM ClientChangeLog WHERE ChangeType = 'Fee Override');
