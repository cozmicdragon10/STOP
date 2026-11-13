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

// Change Log change types in the order their filters are listed, and how each is labelled. The server logs every change to
// an account (backend/lib/changeLog.js); a type not listed here (e.g. a federal unit code) is labelled as stored.
export const CHANGE_LOG_TYPES: { type: string; label: string }[] = [
  { type: 'Client Created', label: 'Client Created' },
  // Information
  { type: 'First Name', label: 'First Name' },
  { type: 'Middle Name', label: 'Middle Name' },
  { type: 'Last Name', label: 'Last Name' },
  // Before names were logged by part
  { type: 'Name', label: 'Name' },
  { type: 'ID #', label: 'ID #' },
  { type: 'ID # Type Set', label: 'ID # Type Set' },
  { type: 'Date of Birth', label: 'Date of Birth' },
  { type: 'Sex', label: 'Sex' },
  { type: 'Race', label: 'Race' },
  { type: 'Address', label: 'Address' },
  { type: 'City', label: 'City' },
  { type: 'County', label: 'County' },
  { type: 'State', label: 'State' },
  { type: 'Zip', label: 'Zip' },
  { type: 'Main Phone', label: 'Main Phone' },
  { type: 'Alt Phone', label: 'Alt Phone' },
  { type: 'Emergency Contact', label: 'Emergency Contact' },
  { type: 'Emergency Contact Phone', label: 'Emergency Contact Phone' },
  { type: 'Comments', label: 'Comments' },
  // Program
  { type: 'Program Status', label: 'Program Status' },
  { type: 'Program Type', label: 'Program Type' },
  { type: 'Program Start Date', label: 'Program Start Date' },
  { type: 'Phase', label: 'Phase' },
  { type: 'Supervising Agent', label: 'Supervising Agent' },
  { type: 'Group', label: 'Group' },
  { type: 'Individual Group', label: 'Individual Group' },
  { type: 'Assessor', label: 'Assessor' },
  { type: 'Outside BIP Assessment', label: 'Outside BIP Assessment' },
  { type: 'Pretrial', label: 'Pretrial' },
  { type: 'Bus Passes', label: 'Bus Passes' },
  { type: 'Bus Pass Refill', label: 'Bus Pass Refill' },
  // Attendance
  { type: 'Attendance Added', label: 'Attendance Added' },
  { type: 'Attendance Deleted', label: 'Attendance Deleted' },
  { type: 'Call-In', label: 'Call-In' },
  // Money
  { type: 'Payment', label: 'Payment' },
  { type: 'Custom Fee', label: 'Custom Fee' },
  { type: 'Payment Adjusted', label: 'Payment Adjusted' },
  { type: 'Payment Refunded', label: 'Payment Refunded' },
  { type: 'Payment Disputed', label: 'Payment Disputed' },
  { type: 'Account Balance', label: 'Account Balance' },
  { type: 'Treatment Fee', label: 'Treatment Fee' },
  { type: 'Fee Override', label: 'Temporary Fee Override' },
  { type: 'Vouchers', label: 'Vouchers' },
  { type: 'Copay', label: 'Copay' },
  { type: 'Card Payments', label: 'Card Payments' },
  // Polygraphs
  { type: 'Polygraph', label: 'Polygraph' },
  { type: 'No Poly Required', label: 'No Poly Required' },
  { type: 'Poly Fee', label: 'Poly Fee' },
  { type: 'Poly Fee Paid', label: 'Poly Fee Paid' },
  { type: 'Poly Fee Vouchers', label: 'Poly Fee Vouchers' },
  { type: 'Poly Fee Override', label: 'Poly Fee Override' },
  // Records
  { type: 'Case Note', label: 'Case Note' },
  { type: 'Attachment', label: 'Attachment' },
];

// The Change Log's filters: only the types this client's log has, in CHANGE_LOG_TYPES order, then any other stored types
// alphabetically
export const changeLogFilters = (changes: { changetype: string }[]) => {
  const present = new Set(changes.map(c => c.changetype));
  const known = CHANGE_LOG_TYPES.filter(t => present.has(t.type));
  const others = [...present].filter(type => !CHANGE_LOG_TYPES.some(t => t.type === type)).sort()
    .map(type => ({ type, label: type }));
  return [...known, ...others];
};

// Programs that use the SO phase schedule
export const SO_PROGRAM_TYPES = ['State SO', 'Federal SO', 'Voluntary SO'];
// Programs that show the last polygraph date
export const POLY_PROGRAM_TYPES = [...SO_PROGRAM_TYPES, 'Poly Only'];
// Programs whose clients can be marked Pretrial. Mirrors PRETRIAL_PROGRAM_TYPES in backend/routes/clients.js.
export const PRETRIAL_PROGRAM_TYPES = ['Federal SO', 'Fed Drug Test'];
// Federal clients can be granted bus passes, up to BUS_PASS_MAX at a time. Mirrors FEDERAL_PROGRAM_TYPES and BUS_PASS_MAX
// in backend/lib/busPasses.js.
export const FEDERAL_PROGRAM_TYPES = ['Federal SO', 'Fed Drug Test', 'Poly Only'];
export const BUS_PASS_MAX = 2;
// Chaperon clients' phase says which kind of chaperon program they are in (the old system's two chaperon phases)
export const CHAPERON_PHASES = ['Chaperon', 'Federal Chaperon'];
// Programs that start at the State SO default treatment fee (Phase 1 - Weekly)
export const STATE_FEE_PROGRAM_TYPES = ['State SO', 'Voluntary SO'];
// BIP clients store a whole-number week (starting at 0) in the phase column instead of an SO phase
export const isWholeNumber = (value: unknown) => /^\d+$/.test(String(value ?? '').trim());
export const formatPhase = (programtype?: string | null, phase?: string | null) =>
  programtype === 'BIP' && isWholeNumber(phase) ? `Week ${phase}` : phase;

// Client Roster filters: each list holds the values picked (empty = all). They start on active clients only.
export interface ClientFilters {
  agent: string[];
  programtype: string[];
  phase: string[];
  currentgroup: string[];
  status: string[];
  feeoverride: '' | 'active' | 'none';
  pretrial: '' | 'yes' | 'no';
  docnumber: '' | 'has' | 'missing';
}
export const DEFAULT_CLIENT_FILTERS: ClientFilters = { agent: [], programtype: [], phase: [], currentgroup: [], status: ['Active'], feeoverride: '', pretrial: '', docnumber: '' };
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

// A counselor's individual-session group; it takes clients of any program
export const INDIVIDUAL_GROUP_TYPE = 'INDIVIDUAL';
export const isIndividualGroup = (groupProgram?: string | null) => (groupProgram || '').trim().toUpperCase() === INDIVIDUAL_GROUP_TYPE;
// The Admin price list's Individual price that an individual group check-in charges: the active Individual entry named
// "Individual", else the first active one; null when there is none. Mirrors individualPrice in backend/lib/attendance.js.
// What one client is charged for an individual session: federal clients pay their copay (nothing when blank), everyone
// else the Admin Individual price. Mirrors the batch check-in in backend/routes/attendance.js.
// A client's ID # (docnumber) isn't always a DOC number; doctype says which kind it is. Mirrors backend lib/clientId.js.
export const ID_TYPES = ['DOC', 'PACTS', 'Case #', 'DHS', 'OCS'];
// The ID # as shown, with its type in front when set: "PACTS 1423371 PB", "DOC 581422", or just the number
export const idText = (c: { docnumber?: string | null; doctype?: string | null } | null | undefined) => {
  const number = String(c?.docnumber ?? '').trim();
  if (!number) return '';
  return c?.doctype ? `${c.doctype} ${number}` : number;
};
export const individualSessionFee = (client: { programtype?: string | null; copay?: number | string | null }, individualPrice: number) =>
  FEDERAL_PROGRAM_TYPES.includes(client.programtype || '') ? Number(client.copay || 0) : individualPrice;
export const individualPriceFrom = (types: { sessiontypeid: number; category: string; name: string; fee: number | string; active: boolean }[]): number | null => {
  const active = types.filter(t => t.category === 'Individual' && t.active)
    .sort((a, b) => Number(b.name === 'Individual') - Number(a.name === 'Individual') || a.sessiontypeid - b.sessiontypeid);
  return active.length ? Number(active[0].fee) : null;
};
// Group program types offered for each client program type's Group field. Programs not listed see every group. SO
// clients pick their individual group in a separate Individual Group field (individualgroupid) instead.
export const GROUP_TYPES_BY_PROGRAM: Record<string, string[]> = {
  'State SO': ['SO', 'FED SO'],
  'Federal SO': ['SO', 'FED SO'],
  'Voluntary SO': ['SO', 'FED SO'],
  'BIP': ['BIP', INDIVIDUAL_GROUP_TYPE],
  'Fed Drug Test': ['DRUG TEST', INDIVIDUAL_GROUP_TYPE],
  'Chaperon': ['CHAPERON', 'FED CHAPERON', INDIVIDUAL_GROUP_TYPE],
};
// Drug-test groups are run by an observer, who is an Office Admin or Business Administrator, instead of a counselor.
// The observer is kept in the group's Counselor field.
export const isDrugTestGroup = (groupProgram?: string | null) => (groupProgram || '').trim().toUpperCase() === 'DRUG TEST';
// Chaperon classes: CHAPERON groups, and FED CHAPERON groups for federal (USPO-billed) chaperon clients
export const CHAPERON_GROUP_TYPES = ['CHAPERON', 'FED CHAPERON'];
export const isChaperonGroup = (groupProgram?: string | null) => CHAPERON_GROUP_TYPES.includes((groupProgram || '').trim().toUpperCase());
// Drug-test groups, chaperon classes and individual groups meet when booked, so their schedule can be By Appointment
export const allowsByAppointment = (groupProgram?: string | null) =>
  isDrugTestGroup(groupProgram) || isChaperonGroup(groupProgram) || isIndividualGroup(groupProgram);
export const groupLeadLabel = (groupProgram?: string | null) => (isDrugTestGroup(groupProgram) ? 'Observer' : 'Counselor');
export const OBSERVER_ROLES = ['Office Admin', 'Business Administrator'];
// Whether a client of this program can be put in a group of this program type: BIP groups take BIP clients, SO groups
// take SO clients, DRUG TEST groups take Fed Drug Test clients, CHAPERON and FED CHAPERON groups take Chaperon clients. A group without a program type,
// or an INDIVIDUAL group, takes anyone. Mirrors the server's check on assignment.
export const clientFitsGroup = (clientProgram?: string | null, groupProgram?: string | null) => {
  const groupType = (groupProgram || '').trim().toUpperCase();
  return !groupType || groupType === INDIVIDUAL_GROUP_TYPE || (GROUP_TYPES_BY_PROGRAM[clientProgram || ''] ?? []).includes(groupType);
};
