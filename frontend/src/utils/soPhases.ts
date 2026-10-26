// Phase schedule for State SO, Federal SO and Voluntary SO clients, with the treatment fee for each phase
export const SO_PHASES = ['Phase 1 - Weekly', 'Phase 2 - Monthly', 'Phase 3 - Quarterly', 'Phase 4 - Semi Anual'];

export const SO_TREATMENT_FEES: Record<string, number> = {
  'Phase 1 - Weekly': 180,
  'Phase 2 - Monthly': 100,
  'Phase 3 - Quarterly': 180,
  'Phase 4 - Semi Anual': 300,
};

// State SO and Voluntary SO Phase 1 (weekly) and Phase 2 (monthly) clients pay the treatment fee once per calendar month, on their first attendance.
// The server applies the same rule when saving (see isMonthlyFeeClient in backend/lib/attendance.js).
export const isMonthlyFeeClient = (programtype?: string | null, phase?: string | null): boolean =>
  (programtype === 'State SO' || programtype === 'Voluntary SO') && (phase === 'Phase 1 - Weekly' || phase === 'Phase 2 - Monthly');
