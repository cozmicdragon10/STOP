import { isIndividualGroup } from './clients';

// Session units (Form 45 tokens). A Federal SO client's group session uses 6022 Group Units and an individual group
// session 6012 Individual Units. When the group is closed the counselor picks how long the client attended, which sets
// the units used. A client with no units left (blank counts as none) can't be checked in, and only lengths they have
// enough units for are offered. Mirrors backend/lib/federalUnits.js.
export const UNIT_PROGRAMS = ['Federal SO'];
export const DURATION_BANDS = [
  { key: 'under16', label: 'Less than 16 minutes', units: 0 },
  { key: '16-30', label: '16–30 minutes', units: 1 },
  { key: '31-60', label: '31–60 minutes', units: 2 },
  { key: '61-90', label: '61–90+ minutes', units: 3 },
] as const;
export type DurationBand = typeof DURATION_BANDS[number]['key'];

export const unitCodeForGroup = (groupProgram?: string | null) => (isIndividualGroup(groupProgram) ? '6012' : '6022');
export const unitCodeLabel = (code: string) => (code === '6012' ? 'Individual Units' : 'Group Units');

interface UnitClient {
  programtype?: string | null;
  federalunits?: Record<string, number | string> | null;
}
export const usesUnits = (client: UnitClient) => UNIT_PROGRAMS.includes(client.programtype || '');
// Units left for a code; blank counts as 0
export const unitsLeft = (client: UnitClient, code: string) => Number(client.federalunits?.[code] ?? 0) || 0;
// A Federal SO client with no units left for this code can't be checked in
export const outOfUnits = (client: UnitClient, code: string) => usesUnits(client) && unitsLeft(client, code) < 1;
// The lengths a client has enough units for
export const bandsFor = (client: UnitClient, code: string) => DURATION_BANDS.filter(b => b.units <= unitsLeft(client, code));
