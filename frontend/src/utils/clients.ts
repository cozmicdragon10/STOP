// Client program types, statuses, and roster rules
// Client program statuses. 'Active' is used by group call-ins and the group roster, so keep that exact spelling.
export const PROGRAM_STATUSES = ['Active', 'Completed', 'Deceased', 'Discharged Supervision', 'Inactive', 'Program Failed', 'Revoked', 'Terminated', 'Transferred'];
// Statuses that can be picked when adding or editing a client; the rest are only set through the Discharge button
export const EDITABLE_PROGRAM_STATUSES = ['Active', 'Inactive'];

// Discharge types a Business Administrator can pick; each becomes the client's program status
export const DISCHARGE_STATUSES = ['Completed', 'Deceased', 'Discharged Supervision', 'Program Failed', 'Revoked', 'Transferred', 'Terminated'];
// Discharge types that require a subcategory (recorded on the case note and kept for recidivism reporting)
export const DISCHARGE_SUBCATEGORIES: Record<string, string[]> = {
  'Program Failed': ['Attendance', 'Polys', 'Not Amenable'],
  'Revoked': ['Non Compliance', 'New SO Charge', 'New Criminal Charge'],
  'Terminated': ['Violence', 'New Criminal Charge'],
};

// Change Log filter choices: the stored change type and how it is labelled
export const CHANGE_LOG_TYPES: { type: string; label: string }[] = [
  { type: 'Client Created', label: 'Client Created' },
  { type: 'Program Status', label: 'Program Status' },
  { type: 'Program Type', label: 'Program Type' },
  { type: 'Supervising Agent', label: 'Supervising Agent' },
  { type: 'Group', label: 'Group' },
  { type: 'No Poly Required', label: 'No Poly Required' },
  { type: 'Fee Override', label: 'Temporary Fee Override' },
  { type: 'Poly Fee Override', label: 'Poly Fee Override' },
  { type: 'Payment Adjusted', label: 'Payment Adjusted' },
  { type: 'Payment Refunded', label: 'Payment Refunded' },
  { type: 'Payment Disputed', label: 'Payment Disputed' },
];

// Programs that use the SO phase schedule and show the last polygraph date
export const SO_PROGRAM_TYPES = ['State SO', 'Federal SO', 'Voluntary SO'];
// Programs that start at the State SO default treatment fee (Phase 1 - Weekly)
export const STATE_FEE_PROGRAM_TYPES = ['State SO', 'Voluntary SO'];
// BIP clients store a whole-number week (starting at 0) in the phase column instead of an SO phase
export const isWholeNumber = (value: unknown) => /^\d+$/.test(String(value ?? '').trim());
export const formatPhase = (programtype?: string | null, phase?: string | null) =>
  programtype === 'BIP' && isWholeNumber(phase) ? `Week ${phase}` : phase;

// Client Roster filters start on active clients only
export const DEFAULT_CLIENT_FILTERS = { agent: '', programtype: '', phase: '', currentgroup: '', status: 'Active', feeoverride: '' };
// Dropdown choices for client Information fields; must match the server's lists
export const CLIENT_FIELD_OPTIONS: Record<string, string[]> = {
  race: ['American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino', 'Native Hawaiian or Other Pacific Islander', 'White', 'Two or More Races', 'Other'],
  sex: ['Male', 'Female'],
};

// SO clients are overdue to attend once this many months have passed since their last attendance, by phase
export const SO_ATTENDANCE_LIMIT_MONTHS: Record<string, number> = {
  'Phase 1 - Weekly': 1,
  'Phase 2 - Monthly': 2,
  'Phase 3 - Quarterly': 4,
  'Phase 4 - Semi Anual': 7,
};
// True when an SO client's last attendance is more than their phase allows. Clients who never attended, or without an SO phase, aren't flagged.
export const isAttendanceOverdue = (client: any, today = new Date()) => {
  const limit = SO_ATTENDANCE_LIMIT_MONTHS[client.phase];
  // The latest attendance row's date, or the stored last date attended when that isn't loaded
  const lastValue = client.lastattended ?? client.lastdateattended;
  if (!SO_PROGRAM_TYPES.includes(client.programtype) || !limit || !lastValue) return false;
  const last = new Date(lastValue);
  if (isNaN(last.getTime())) return false;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return startOfToday > new Date(last.getFullYear(), last.getMonth() + limit, last.getDate());
};

// Group program types offered for each client program type. Programs not listed see every group.
export const GROUP_TYPES_BY_PROGRAM: Record<string, string[]> = {
  'State SO': ['SO', 'FED SO'],
  'Federal SO': ['SO', 'FED SO'],
  'Voluntary SO': ['SO', 'FED SO'],
  'BIP': ['BIP'],
};
// Whether a client of this program can be put in a group of this program type: BIP groups take BIP clients, SO groups
// take SO clients. A group without a program type takes anyone. Mirrors the server's check on assignment.
export const clientFitsGroup = (clientProgram?: string | null, groupProgram?: string | null) => {
  const groupType = (groupProgram || '').trim().toUpperCase();
  return !groupType || (GROUP_TYPES_BY_PROGRAM[clientProgram || ''] ?? []).includes(groupType);
};
