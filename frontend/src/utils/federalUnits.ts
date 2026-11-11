import { isDrugTestGroup, isIndividualGroup } from './clients';

// Session units (Form 45 tokens). A Federal SO client's group session uses 6022 Group Units and an individual group
// session 6012 Individual Units: when the group is closed the counselor picks how long the client attended, which sets
// the units used. A Fed Drug Test client's drug test (DRUG TEST group) session uses one 1010 Drug Test Unit, and they can
// be drug tested once a day. A client with no units left (blank counts as none) can't be checked in, and only lengths
// they have enough units for are offered. Mirrors backend/lib/federalUnits.js.
export const DURATION_BANDS = [
  { key: 'under16', label: 'Less than 16 minutes', units: 0 },
  { key: '16-30', label: '16–30 minutes', units: 1 },
  { key: '31-60', label: '31–60 minutes', units: 2 },
  { key: '61-90', label: '61–90+ minutes', units: 3 },
] as const;
export type DurationBand = typeof DURATION_BANDS[number]['key'];

const UNIT_LABELS: Record<string, string> = { 6022: 'Group Units', 6012: 'Individual Units', 1010: 'Drug Test Units' };
export const unitCodeLabel = (code: string) => UNIT_LABELS[code] ?? 'Units';

interface UnitClient {
  programtype?: string | null;
  federalunits?: Record<string, number | string> | null;
  // Fed Drug Test clients: date (YYYY-MM-DD) of their latest drug test
  lastdrugtest?: string | null;
}

// The code a client's session in this group uses, or null when it uses none
export const unitCodeFor = (client: UnitClient, groupProgram?: string | null): string | null => {
  if (client.programtype === 'Federal SO') return isIndividualGroup(groupProgram) ? '6012' : '6022';
  if (client.programtype === 'Fed Drug Test' && isDrugTestGroup(groupProgram)) return '1010';
  return null;
};
// Federal SO sessions are counted by how long the client attended; drug tests always use one unit
export const needsDuration = (client: UnitClient, groupProgram?: string | null) => {
  const code = unitCodeFor(client, groupProgram);
  return code === '6022' || code === '6012';
};
// Units left for a code; blank counts as 0
export const unitsLeft = (client: UnitClient, code: string) => Number(client.federalunits?.[code] ?? 0) || 0;
// A client whose session here uses units and who has none left can't be checked in
export const outOfUnits = (client: UnitClient, groupProgram?: string | null) => {
  const code = unitCodeFor(client, groupProgram);
  return code !== null && unitsLeft(client, code) < 1;
};
// The lengths a client has enough units for
export const bandsFor = (client: UnitClient, code: string) => DURATION_BANDS.filter(b => b.units <= unitsLeft(client, code));
// Drug tests are once a day: already tested on this date (YYYY-MM-DD)
export const drugTestedOn = (client: UnitClient, groupProgram: string | null | undefined, date: string) =>
  isDrugTestGroup(groupProgram) && !!client.lastdrugtest && client.lastdrugtest === date;
