// Phase schedule for State SO, Federal SO and Voluntary SO clients, with the treatment fee for each phase
export const SO_PHASES = ['Phase 1 - Weekly', 'Phase 2 - Monthly', 'Phase 3 - Quarterly', 'Phase 4 - Semi Anual'];

// State SO / Voluntary SO price for each phase and the BIP price. Business Administrators set them in Admin (ProgramFees);
// App loads them at sign-in with applyProgramFees, which updates these objects in place. Until then the old fixed
// prices below are used.
export const SO_TREATMENT_FEES: Record<string, number> = {
  'Phase 1 - Weekly': 180,
  'Phase 2 - Monthly': 100,
  'Phase 3 - Quarterly': 180,
  'Phase 4 - Semi Anual': 300,
};
export const BIP_FEE_KEY = 'BIP';
const otherProgramFees: Record<string, number> = { [BIP_FEE_KEY]: 35 };
// The current BIP treatment fee for new BIP clients
export const bipTreatmentFee = () => otherProgramFees[BIP_FEE_KEY];
export const applyProgramFees = (fees: { feekey: string; fee: number | string }[]) => {
  for (const { feekey, fee } of fees) {
    const value = Number(fee);
    if (!Number.isFinite(value)) continue;
    if (feekey in SO_TREATMENT_FEES) SO_TREATMENT_FEES[feekey] = value;
    else otherProgramFees[feekey] = value;
  }
};

// State SO and Voluntary SO Phase 1 (weekly) and Phase 2 (monthly) clients pay the treatment fee once per calendar month, on their first attendance.
// The server applies the same rule when saving (see isMonthlyFeeClient in backend/lib/attendance.js).
export const isMonthlyFeeClient = (programtype?: string | null, phase?: string | null): boolean =>
  (programtype === 'State SO' || programtype === 'Voluntary SO') && (phase === 'Phase 1 - Weekly' || phase === 'Phase 2 - Monthly');

// State SO and Voluntary SO Phase 3 (quarterly) and Phase 4 (semi-annual) clients pay the treatment fee once per this
// many months, rolling from their last charged group attendance. null for everyone else.
// The server applies the same rule (see feePeriodMonths in backend/lib/attendance.js).
export const FEE_PERIOD_MONTHS: Record<string, number> = { 'Phase 3 - Quarterly': 3, 'Phase 4 - Semi Anual': 6 };
// Quarterly and semi-annual clients are charged less often, so their full set of poly fee vouchers is smaller (see
// polyVoucherMax in ./polygraph.ts). The server keeps the same map (POLY_VOUCHER_MAX_BY_PHASE in backend/lib/poly.js).
export const POLY_VOUCHER_MAX_BY_PHASE: Record<string, number> = { 'Phase 3 - Quarterly': 2, 'Phase 4 - Semi Anual': 1 };
export const feePeriodMonths =(programtype?: string | null, phase?: string | null): number | null =>
  ((programtype === 'State SO' || programtype === 'Voluntary SO') && FEE_PERIOD_MONTHS[phase ?? '']) || null;
