-- Private Pay is now Voluntary SO, which follows the State SO phase schedule and fees
UPDATE Clients SET ProgramType = 'Voluntary SO' WHERE ProgramType = 'Private Pay';
UPDATE Clients SET Phase = 'Phase 1 - Weekly'
WHERE ProgramType = 'Voluntary SO'
  AND COALESCE(Phase, '') NOT IN ('Phase 1 - Weekly', 'Phase 2 - Monthly', 'Phase 3 - Quarterly', 'Phase 4 - Semi Anual');
