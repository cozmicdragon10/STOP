import type { SessionEntry } from './hooks/useGroupCheckIn';
import type { BipCheckInBlock } from './utils/bip';

const API_BASE = 'https://192.168.1.133:5000/api';

// The login session token. Held in memory only, so reloading the page logs out (as before sessions existed).
let sessionToken: string | null = null;
let onSessionEnded: (() => void) | null = null;

// Called when the server refuses the token (expired, logged out elsewhere, or account deactivated)
export function setSessionEndedHandler(handler: (() => void) | null) {
    onSessionEnded = handler;
}

// fetch with the session token attached. Every API call except login goes through this.
async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401 && sessionToken) {
        sessionToken = null;
        onSessionEnded?.();
    }
    return res;
}

// Parses a JSON body. An HTML body means the route is missing, which usually means the backend needs a restart.
async function readJson(res: Response): Promise<unknown> {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}). Restart the backend (node server.js) and try again.`);
    }
}

// Reads the JSON body as T and throws the server's error message on failure
async function jsonResponse<T>(res: Response, fallback: string): Promise<T> {
    const body = await readJson(res);
    if (!res.ok) throw new Error((body as { error?: string } | null)?.error || fallback);
    return body as T;
}

// --- Rows the server sends. Numeric (money) columns arrive as strings; dates and timestamps as ISO strings. ---
export type Money = string | number;

// A Clients table row
export interface ClientColumns {
    clientid: number;
    firstname: string;
    middlename: string | null;
    lastname: string;
    docnumber: string | null;
    supervisingagent: string | null;
    programstartdate: string;
    lastdateattended: string | null;
    programstatus: string;
    // BIP clients keep a whole-number week here instead of a phase
    phase: string;
    groupid: number | null;
    treatmentfee: Money | null;
    // Stored sign: positive = owes
    accountbalance: Money | null;
    vouchers: number | null;
    address: string | null;
    city: string | null;
    county: string | null;
    state: string | null;
    zip: string | null;
    mainphone: string | null;
    altphone: string | null;
    emergencycontact: string | null;
    emergencycontactphone: string | null;
    comments: string | null;
    programtype: string | null;
    polyfeevoucher: number;
    polyfeepaid: Money;
    polyfee: Money;
    nopolyrequired: boolean;
    race: string | null;
    dateofbirth: string | null;
    sex: string | null;
    polyvouchersbeforefill: number | null;
}

// A client on the roster, with its group and the check-in facts the frontend needs
export interface Client extends Omit<ClientColumns, 'programtype'> {
    groupname: string | null;
    // The client's own program type, else the group's, else State SO
    programtype: string;
    lastattended: string | null;
    lastpoly: string | null;
    attendedthismonth: boolean;
    // This period's treatment fee was already charged (month for SO Phase 1 and 2, 3 or 6 months for Phase 3 and 4)
    feealreadycharged: boolean;
    // Unexpired temporary reduced fee; replaces treatmentfee while set
    activefeeoverride: Money | null;
    bipcheckinblock: BipCheckInBlock;
}

// A client on a group's roster
export interface GroupRosterClient extends ClientColumns {
    attendedthismonth: boolean;
    feealreadycharged: boolean;
    activefeeoverride: Money | null;
    lastattended: string | null;
    // Most recent group attendance (not an assessment or individual session)
    lastgroupattended: string | null;
    bipcheckinblock: BipCheckInBlock;
}

export interface Group {
    groupid: number;
    groupname: string;
    location: string;
    counselor: string;
    programtype: string;
    schedule: string;
    address: string;
    active: boolean;
    // A count, sent as text
    clientcount: string;
}

// An account, without its password hash
export interface Employee {
    employeeemail: string;
    displayname: string;
    role: string;
    location: string;
    active: boolean | null;
}

export interface PolygraphSlot {
    slotid: number;
    location: string;
    address: string;
    date: string;
    // HH:MM:SS
    time: string;
    polygrapher: string | null;
    type: string;
    comments: string | null;
    isfilled: boolean | null;
    slotsavailable: number | null;
    // The scheduled appointment, when the slot is booked
    appointmentid: number | null;
    assignedClientId: number | null;
    assignedClientName: string | null;
    // Closed: filled, but the reservation was cancelled after the appointment time
    status: 'Assigned' | 'Closed' | 'Open';
}

// One of the client's attendances: a group session, assessment, or individual session
export interface ClientAttendance {
    attendanceid: number;
    client: number | null;
    Group: number | null;
    date: string;
    paid: boolean | null;
    groupfee: Money | null;
    accountpaid: Money | null;
    accounttotal: Money | null;
    voucherused: boolean | null;
    type: string;
    comments: string | null;
    createdby: string | null;
    createdon: string | null;
    paymentmethod: string | null;
    sessionnumber: number;
    openedby: string | null;
    sessiontypeid: number | null;
    provider: string | null;
    coveredby: string | null;
    // The group's name, or e.g. "Assessment - Psychosexual Assessment"
    groupname: string | null;
    // The group's schedule, or "with <provider>"
    groupschedule: string | null;
}

export interface FinancialTransaction {
    transactionid: number;
    client: number | null;
    date: string | null;
    type: string;
    amount: Money;
    feetype: string | null;
    finalbalance: Money;
    comments: string | null;
    paymentmethod: string | null;
    attendanceid: number | null;
    originalamount: Money | null;
    adjustedby: string | null;
    adjustedon: string | null;
    adjustmentreason: string | null;
    relatedtransactionid: number | null;
    disputestatus: string | null;
}

export interface ClientNote {
    noteid: number;
    client: number | null;
    date: string | null;
    User: string | null;
    comments: string;
    category: string;
    editedby: string | null;
    editedon: string | null;
    // 'Pending' while a Counselor's note waits for a Business Administrator; null when no approval was needed
    approvalstatus: 'Pending' | 'Approved' | 'Denied' | null;
    reviewedby: string | null;
    reviewedon: string | null;
}

// A note awaiting approval, with its client
export interface PendingNote extends ClientNote {
    firstname: string;
    lastname: string;
    docnumber: string | null;
    programtype: string | null;
    authorname: string | null;
    lastattended: string | null;
}

export interface PolygraphResult {
    resultid: number;
    appointmentid: number | null;
    client: number | null;
    date: string;
    type: string;
    results: string;
    polygrapher: string | null;
    notes: string | null;
    // Local wall-clock time (YYYY-MM-DDTHH:MM:SS), so time zones cannot shift it
    polygraphdatetime: string | null;
}

export interface TestResult {
    testid: number;
    client: number | null;
    testtype: string;
    score: string | null;
    notes: string | null;
    date: string | null;
}

// Reduced treatment fee until a date
export interface TempFeeOverride {
    overrideid: number;
    clientid: number;
    reducedfee: Money;
    expirationdate: string;
    createdby: string | null;
    createdon: string | null;
}

export type LoginReply = { success: true; user: Employee; token: string } | { success?: false; error?: string };

export async function loginUser(email: string, password: string): Promise<LoginReply> {
    const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const data = await res.json() as LoginReply;
    if (data.success && data.token) sessionToken = data.token;
    return data;
}

export async function logoutUser() {
    if (!sessionToken) return;
    await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' }).catch(() => {});
    sessionToken = null;
}

// Without options, current clients only (not discharged). status: 'all', 'discharged' (any discharge status), or one
// program status; agent: only that supervising agent's clients.
export async function getClients(options: { status?: string; agent?: string } = {}): Promise<Client[]> {
    const query = new URLSearchParams();
    if (options.status) query.set('status', options.status);
    if (options.agent) query.set('agent', options.agent);
    const res = await apiFetch(`${API_BASE}/clients${query.toString() ? `?${query}` : ''}`);
    return jsonResponse(res, 'Failed to load clients.');
}

export async function getClient(clientId: number): Promise<Client> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}`);
    return jsonResponse(res, 'Failed to load the client.');
}

export async function getGroups(): Promise<Group[]> {
    const res = await apiFetch(`${API_BASE}/groups`);
    return jsonResponse(res, 'Failed to load groups.');
}

export async function getGroupClients(groupId: number): Promise<GroupRosterClient[]> {
    const res = await apiFetch(`${API_BASE}/groups/${groupId}/clients`);
    return jsonResponse(res, 'Could not load the group roster.');
}

// A session of a group on a date (YYYY-MM-DD): session 1 is the day's first, a later number means the group met again.
// closed: attendance was saved; otherwise it is an open sheet (Finish Check-In) and clients is empty.
export interface GroupDaySession {
    date: string;
    sessionNumber: number;
    closed: boolean;
    clients: number[];
}

// Sessions of the group on the date (YYYY-MM-DD), or from `from` through the date, oldest first
export async function getGroupSessions(groupId: number, date: string, from?: string): Promise<GroupDaySession[]> {
    const range = from ? `&from=${encodeURIComponent(from)}` : '';
    const res = await apiFetch(`${API_BASE}/groups/${groupId}/sessions?date=${encodeURIComponent(date)}${range}`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body)) {
        throw new Error(body?.error || (res.status === 404
            ? 'The server needs a restart (node server.js) before group sessions can be checked.'
            : 'Could not check who already attended this group today.'));
    }
    return body.map(s => ({ date: String(s.date ?? date), sessionNumber: Number(s.sessionNumber), closed: s.closed !== false, clients: (s.clients || []).map(Number) }));
}

// Business Administrators only; the server checks the role
export async function setClientNoPolyRequired(clientId: number, noPolyRequired: boolean, user: string): Promise<boolean> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/no-poly-required`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noPolyRequired, user }),
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to update No Poly Required.');
    }
    return body.noPolyRequired;
}

// 'discharge' is Business Administrators only (the server checks the role); 'activate' sets a discharged client
// back to Active or Inactive. Returns the client's new program status.
export async function changeClientProgramStatus(action: 'discharge' | 'activate', clientId: number, status: string, subcategory: string | null, note: string, user: string): Promise<string> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, subcategory, note, user }),
    });
    // An outdated server answers with an HTML error page, not JSON
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body.error || `Failed to ${action} client (server responded ${res.status}).`);
    }
    return body.programStatus;
}

export interface ClientChange {
    changeid: number | null;
    changedon: string;
    changedby: string;
    changetype: string;
    oldvalue: string | null;
    newvalue: string | null;
    details: string | null;
}

// Business Administrators only; the server checks the role
export async function getClientChangeLog(clientId: number, user: string): Promise<ClientChange[]> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/change-log?user=${encodeURIComponent(user)}`);
    const body = await res.json();
    if (!res.ok || !Array.isArray(body)) {
        throw new Error(body?.error || 'Failed to load the change log.');
    }
    return body;
}

// Client fields the client forms send. Inputs may send numbers as text; the server converts them.
export type ClientFields = Partial<Record<keyof ClientColumns, string | number | boolean | null>>;

export async function updateClient(clientId: number, data: ClientFields & { updatedBy: string }) {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const text = await res.text();
    let body: { success?: boolean; client?: Record<string, unknown>; error?: string };
    try {
        body = JSON.parse(text);
    } catch {
        // Express returns an HTML error page when the route is missing, which usually means the backend needs a restart
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}). Restart the backend (node server.js) and try again.`);
    }
    if (!res.ok) {
        throw new Error(body.error || 'Failed to save client information.');
    }
    return body as { success: true; client: Record<string, unknown> };
}

export async function createClient(data: ClientFields & { createdBy: string }) {
    const res = await apiFetch(`${API_BASE}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const text = await res.text();
    let body: { success?: boolean; message?: string; error?: string };
    try {
        body = JSON.parse(text);
    } catch {
        // Express returns an HTML error page when the route is missing, which usually means the backend needs a restart
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}). Restart the backend (node server.js) and try again.`);
    }
    if (!res.ok) {
        throw new Error(body.error || 'Failed to add client.');
    }
    return body as { success: true; clientId: number; message: string };
}

// The server only lets Business Administrators delete clients, and reads who is asking from X-User-Email
export async function deleteClient(clientId: number, userEmail: string) {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-User-Email': userEmail },
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to delete client.');
    }
    return body as { success: true; message: string };
}

export async function updateGroup(groupId: number, data: { groupName: string; location: string; counselor: string; programType: string; schedule: string; address: string; active: boolean }) {
    const res = await apiFetch(`${API_BASE}/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const text = await res.text();
    let body: { success?: boolean; error?: string };
    try {
        body = JSON.parse(text);
    } catch {
        // Express returns an HTML error page when the route is missing, which usually means the backend needs a restart
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}). Restart the backend (node server.js) and try again.`);
    }
    if (!res.ok) {
        throw new Error(body.error || 'Failed to update group.');
    }
    return body;
}

export async function createGroup(data: { groupName: string; location: string; counselor: string; programType: string; schedule: string; address: string }) {
    const res = await apiFetch(`${API_BASE}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const text = await res.text();
    let body: { success?: boolean; message?: string; error?: string };
    try {
        body = JSON.parse(text);
    } catch {
        // Express returns an HTML error page when the route is missing, which usually means the backend needs a restart
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}). Restart the backend (node server.js) and try again.`);
    }
    if (!res.ok) {
        throw new Error(body.error || 'Failed to create group.');
    }
    return body as { success: true; groupId: number; message: string };
}

export async function deleteGroup(groupId: number) {
    const res = await apiFetch(`${API_BASE}/groups/${groupId}`, {
        method: 'DELETE',
    });
    const text = await res.text();
    let body: { success?: boolean; message?: string; error?: string };
    try {
        body = JSON.parse(text);
    } catch {
        // Express returns an HTML error page when the route is missing, which usually means the backend needs a restart
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}). Restart the backend (node server.js) and try again.`);
    }
    if (!res.ok) {
        throw new Error(body.error || 'Failed to delete group.');
    }
    return body as { success: true; message: string };
}

export async function assignClientToGroup(groupId: number, clientId: number, assignedBy: string): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/groups/${groupId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, assignedBy }),
    });
    return jsonResponse(res, 'Could not assign the client.');
}

export interface BatchAttendanceEntry {
    client: number;
    groupFee: number;
    accountPaid: number;
    paymentMethod: 'Cash' | 'Credit Card';
    voucherUsed: boolean;
    comments: string;
}

export interface BatchAttendancePayload {
    group: number;
    date: string;
    sessionNumber: number;
    type: string;
    createdBy: string;
    // Counselor covering the session (employee email); only saved when an Office Admin or Business Administrator closes it
    coveredBy?: string | null;
    entries: BatchAttendanceEntry[];
}

export async function submitBatchAttendance(data: BatchAttendancePayload) {
    const res = await apiFetch(`${API_BASE}/attendance/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to save attendance.');
    }
    // polyVouchersAwarded: SO clients charged the group fee whose last polygraph was NDI earn one poly fee voucher.
    // feeChanges: clients the server charged a different fee than the sheet showed (it works the fee out from the account), and why.
    return body as {
        success: true; count: number; polyVouchersAwarded: number;
        results: { client: number; attendanceId: number; newBalance: number; polyVoucherAwarded: boolean }[];
        feeChanges?: { client: number; name: string; feeSent: number; feeCharged: number; feeReason: string }[];
    };
}

// A group check-in saved with Finish Check-In and not yet closed. entries is the attendance sheet as the frontend built it.
export interface OpenGroupSession {
    opensessionid: number;
    groupid: number;
    groupname: string;
    sessiondate: string;
    sessionnumber: number;
    entries: SessionEntry[];
    createdby: string | null;
    // Counselor covering the session, picked by the office (employee email)
    coveredby?: string | null;
    updatedon: string;
}

// Only the open check-ins this user may see: administrators see all; counselors see their groups' and the ones they opened
export async function getOpenGroups(user: string): Promise<OpenGroupSession[]> {
    const res = await apiFetch(`${API_BASE}/open-groups?user=${encodeURIComponent(user)}`);
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to load open groups.');
    }
    return body;
}

// A closed group session, built from its attendance rows. openedby falls back to the closer for older sessions.
export interface ClosedGroupSession {
    groupid: number;
    groupname: string;
    counselor: string | null;
    sessiondate: string;
    sessionnumber: number;
    openedby: string | null;
    closedby: string | null;
    closedon: string | null;
    entries: { client: number; name: string; groupFee: number; accountPaid: number; paymentMethod: string | null }[];
}

// Only the closed sessions this user may see: Business Administrators see all; others see their groups' and the ones they opened
export async function getClosedGroups(user: string): Promise<ClosedGroupSession[]> {
    const res = await apiFetch(`${API_BASE}/closed-groups?user=${encodeURIComponent(user)}`);
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to load closed groups.');
    }
    return body;
}

export async function saveOpenGroup(data: { group: number; date: string; sessionNumber: number; entries: SessionEntry[]; createdBy: string; coveredBy?: string | null }): Promise<OpenGroupSession> {
    const res = await apiFetch(`${API_BASE}/open-groups`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to save the open group.');
    }
    return body;
}

export async function deleteOpenGroup(openSessionId: number, removedBy: string): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/open-groups/${openSessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removedBy }),
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to discard the open group.');
    }
    return body;
}

// --- Assessments & Individuals ---
export type IndividualCategory = 'Assessment' | 'Individual';

// 'BIP Intake' (BIP Intake, DV Assessment) starts the reinstate clock; a 'BIP Reinstate' costs fee under 6 months after
// the client's last intake, latefee from 6 months to a year, and can't be done after a year
export type SessionTypeKind = 'Standard' | 'BIP Intake' | 'BIP Reinstate';

// A price list entry, kept by Business Administrators in Admin
export interface SessionType {
    sessiontypeid: number;
    category: IndividualCategory;
    name: string;
    fee: string | number;
    active: boolean;
    kind: SessionTypeKind;
    // Only BIP clients can have it (always set for BIP intakes and reinstates)
    biponly: boolean;
    // Only SO clients (State, Federal, Voluntary SO) can have it; never set with biponly
    soonly: boolean;
    latefee: string | number | null;
}

// A client's most recent closed BIP intake on or before a date, and where that date falls for a reinstate
export interface BipIntake {
    intakedate: string;
    intakename: string;
    window: 'early' | 'late' | 'expired';
    // Discharged after an intake done at another provider: no reinstate; our own intake is needed
    needsOurIntake?: boolean;
}

// A completed assessment: done here (an Attendance row) or a BIP intake done at another provider (an outside record)
export interface CompletedAssessment {
    source: 'here' | 'outside';
    id: number;
    name: string;
    kind: SessionTypeKind;
    date: string;
    provider: string | null;
    notes: string | null;
    recordedby: string | null;
    // Done here only
    fee: string | number | null;
    paid: string | number | null;
    paymentmethod: string | null;
}

export interface OpenAssessment {
    opensessionid: number;
    name: string;
    date: string;
    provider: string | null;
    fee: string | number;
    createdby: string | null;
}

// The client's Progress tab. block and lastDischarge are for BIP clients' group check-in clearance.
export interface ClientProgress {
    isBip: boolean;
    block: 'intake' | 'our-intake' | 'reinstate' | null;
    lastDischarge: string | null;
    completed: CompletedAssessment[];
    open: OpenAssessment[];
}

export async function getClientProgress(clientId: number): Promise<ClientProgress> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/progress`);
    return jsonResponse(res, 'Failed to load the client\'s progress.');
}

// Business Administrators and Office Admins; the server checks the role
export async function recordOutsideBipAssessment(clientId: number, data: { assessmentType: 'BIP Intake' | 'DV Assessment'; assessmentDate: string; providerName: string; notes: string; user: string }): Promise<{ success: true; id: number }> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/outside-bip-assessments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to record the outside assessment.');
}

// Business Administrators only; the server checks the role
export async function deleteOutsideBipAssessment(id: number, user: string): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/outside-bip-assessments/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user }),
    });
    return jsonResponse(res, 'Failed to remove the outside assessment.');
}

export async function getBipIntake(clientId: number, date: string): Promise<BipIntake | null> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/bip-intake?date=${encodeURIComponent(date)}`);
    return jsonResponse(res, 'Failed to look up the BIP intake.');
}

export async function getSessionTypes(): Promise<SessionType[]> {
    const res = await apiFetch(`${API_BASE}/session-types`);
    return jsonResponse(res, 'Failed to load the price list.');
}

export async function saveSessionType(data: {
    id?: number; category: IndividualCategory; name: string; fee: number; active: boolean;
    kind: SessionTypeKind; bipOnly: boolean; soOnly: boolean; lateFee: number | null; user: string;
}): Promise<SessionType> {
    const res = await apiFetch(`${API_BASE}/session-types${data.id ? `/${data.id}` : ''}`, {
        method: data.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to save the price list entry.');
}

export interface OpenIndividualSession {
    opensessionid: number;
    clientid: number;
    firstname: string;
    lastname: string;
    docnumber: string | null;
    programtype: string | null;
    category: IndividualCategory;
    sessiontypeid: number;
    sessiontypename: string;
    sessiondate: string;
    fee: string | number;
    payment: string | number;
    paymentmethod: 'Cash' | 'Credit Card' | null;
    provider: string | null;
    comments: string | null;
    paymentcomments: string | null;
    createdby: string | null;
    updatedon: string;
}

export interface ClosedIndividualSession {
    attendanceid: number;
    clientid: number;
    firstname: string;
    lastname: string;
    category: IndividualCategory;
    sessiontypename: string | null;
    sessiondate: string;
    fee: string | number;
    payment: string | number;
    paymentmethod: string | null;
    provider: string | null;
    comments: string | null;
    paymentcomments: string | null;
    openedby: string | null;
    closedby: string | null;
    closedon: string | null;
}

// What the session form sends to save (open) or close a session
export interface IndividualSessionPayload {
    openSessionId?: number | null;
    client: number;
    category: IndividualCategory;
    sessionTypeId: number;
    date: string;
    fee: number;
    payment: number;
    paymentMethod: 'Cash' | 'Credit Card';
    provider: string;
    comments: string;
    // Added to the payment's ledger row when the session closes
    paymentComments: string;
    user: string;
    // Closing a BIP intake or reinstate: payment for the assessment and any past due balance taken, then intake paperwork
    // completed (intake) or the BIP Reinstatement Contract signed (reinstate)
    paymentConfirmed?: boolean;
    paperworkCompleted?: boolean;
}

export async function getOpenIndividualSessions(user: string): Promise<OpenIndividualSession[]> {
    const res = await apiFetch(`${API_BASE}/individual-sessions/open?user=${encodeURIComponent(user)}`);
    return jsonResponse(res, 'Failed to load open sessions.');
}

export async function getClosedIndividualSessions(user: string): Promise<ClosedIndividualSession[]> {
    const res = await apiFetch(`${API_BASE}/individual-sessions/closed?user=${encodeURIComponent(user)}`);
    return jsonResponse(res, 'Failed to load closed sessions.');
}

export async function saveOpenIndividualSession(data: IndividualSessionPayload): Promise<OpenIndividualSession> {
    const res = await apiFetch(`${API_BASE}/individual-sessions/open`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to save the session.');
}

export async function deleteOpenIndividualSession(openSessionId: number, user: string): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/individual-sessions/open/${openSessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user }),
    });
    return jsonResponse(res, 'Failed to discard the session.');
}

// Records the attendance, fee, and payment; returns the client's new balance (stored sign: positive = owes)
export async function closeIndividualSession(data: IndividualSessionPayload): Promise<{ attendanceId: number; newBalance: string | number }> {
    const res = await apiFetch(`${API_BASE}/individual-sessions/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to close the session.');
}

// applyToPolyFee: pay down the client's unpaid poly fee first; any excess goes to the account balance
// newBalance uses the stored sign (positive = owes); polyApplied went to the poly fee, accountApplied to the balance
export interface AccountPaymentResult {
    success: true;
    newBalance: number;
    polyFeePaid: number;
    polyFeeVoucher: number;
    polyApplied: number;
    accountApplied: number;
}

export async function submitAccountPayment(data: { client: number; amount: number; comments: string; createdBy: string; paymentMethod: 'Cash' | 'Credit Card'; applyToPolyFee?: boolean }): Promise<AccountPaymentResult> {
    const res = await apiFetch(`${API_BASE}/financials/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Error recording payment.');
}

export async function submitCustomCharge(data: { client: number; amount: number; comments: string; createdBy: string }): Promise<{ success: true; newBalance: number }> {
    const res = await apiFetch(`${API_BASE}/financials/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Error charging custom fee.');
}

// What a payment correction changed. The poly fields come back only for poly fee payments.
export interface PaymentChangeResult {
    newBalance: number;
    attendanceUpdated: boolean;
    polyFeePaid?: number;
    polyFeeVoucher?: number;
    vouchersRemoved?: number;
    vouchersAdded?: number;
    // Poly fee payments: what poly fee paid couldn't absorb (it never goes below $0), now owed on the account balance
    owedOnAccount?: number;
    // Polygraph the client is already booked into with poly fee vouchers; the change doesn't cancel it
    scheduledPolygraph?: { slotId: number; date: string; time: string | null; location: string | null } | null;
}

// Corrects a cash payment's amount; the server carries the difference through the balance (or poly fee paid and vouchers),
// later ledger and attendance rows, and the check-in it was taken at
export async function adjustCashPayment(transactionId: number, data: { amount: number; reason: string; user: string }): Promise<PaymentChangeResult> {
    const res = await apiFetch(`${API_BASE}/financials/${transactionId}/adjust`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to adjust the payment.');
}

// What deleting a check-in changed on the client
export interface AttendanceDeleteResult {
    newBalance: number;
    phase: string | null;
    polyFeeVoucher: number;
    // The poly fee voucher the check-in earned: removed, kept (attended again later that month), or already used; null if it earned none
    voucher: 'removed' | 'kept' | 'used' | null;
    // The monthly treatment fee the deleted check-in paid, moved to the earliest group check-in left that month
    feeMoved: { amount: number; to: string } | null;
    lastDateAttended: string | null;
    // Latest attendance left (the roster's Last Attended)
    lastAttended: string | null;
    ledgerRowsRemoved: number;
}

// Business Administrators only: deletes a check-in and undoes its fee, payment, and everything they moved
export async function deleteAttendance(attendanceId: number, reason: string): Promise<AttendanceDeleteResult> {
    const res = await apiFetch(`${API_BASE}/attendance/${attendanceId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
    });
    return jsonResponse(res, 'Failed to delete the attendance.');
}

export type CardPaymentAction = 'refund' | 'dispute' | 'dispute-won' | 'dispute-lost';

// Refund (full or partial), dispute, or dispute outcome on a credit card payment
export async function recordCardPaymentAction(transactionId: number, data: { action: CardPaymentAction; amount?: number; reason: string; user: string }): Promise<PaymentChangeResult> {
    const res = await apiFetch(`${API_BASE}/financials/${transactionId}/card-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to record the credit card change.');
}

// reason is one of the call-in reasons (utils/notes.ts); the server refuses any other
export async function submitClientCallIn(data: { client: number; date: Date | string; comment: string; createdBy: string; reason: string | null }): Promise<{ success: true; eventId: number }> {
    const res = await apiFetch(`${API_BASE}/callin/client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Could not log the call-in.');
}

// Logged for every active client in the group. callInDate (YYYY-MM-DD) is the day the call-in is for, when not today;
// forDate comes back set only then.
export async function submitGroupCallIn(data: { group: number; date: Date | string; comment: string; createdBy: string; reason: string | null; callInDate: string | null }): Promise<{ success: true; count: number; forDate: string | null }> {
    const res = await apiFetch(`${API_BASE}/callin/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Could not log the group call-in.');
}

export async function getPolygraphSlots(): Promise<PolygraphSlot[]> {
    const res = await apiFetch(`${API_BASE}/polygraphs/slots`);
    return jsonResponse(res, 'Failed to load polygraph slots.');
}

// polygrapher is the examiner's employee email; date (YYYY-MM-DD) and time (HH:MM) must be in the future
export async function createPolygraphSlot(data: { location: string; address: string; date: string; time: string; polygrapher: string; type: string; comments: string; slots: number }): Promise<{ success: true; slotId: number }> {
    const res = await apiFetch(`${API_BASE}/polygraphs/slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to create slot.');
}

// The server reads the polygraph's date and time from slotId. incentiveContinued is a Business Administrator's choice
// for Inconclusive or No Opinion results.
export async function submitPolygraphResult(data: {
    client: number; date: string; type: string; results: string; polygrapher: string; notes: string;
    slotId: number; incentiveContinued: boolean; user: string;
}): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/polygraphs/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Error completing polygraph slot.');
}

export async function getClientTests(clientId: number): Promise<TestResult[]> {
    const res = await apiFetch(`${API_BASE}/testing/${clientId}`);
    return jsonResponse(res, 'Could not load the test history.');
}

export async function submitTestResult(data: { client: number; testType: string; score: string; notes: string; date: string }): Promise<TestResult> {
    const res = await apiFetch(`${API_BASE}/testing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Could not save the test result.');
}

export interface AgentReportRow {
    clientid: number;
    firstname: string;
    lastname: string;
    docnumber: string | null;
    supervisingagent: string | null;
    accountbalance: Money | null;
    // A count, sent as text
    totalattended: string;
    lastpolydate: string | null;
    lastpolyresult: string | null;
}

export async function getAgentReport(): Promise<AgentReportRow[]> {
    const res = await apiFetch(`${API_BASE}/reports/agent`);
    return jsonResponse(res, 'Failed to load the weekly agent report.');
}

export interface GroupReportRow {
    attendanceid: number;
    groupid: number | null;
    groupname: string;
    counselor: string | null;
    date: string;
    sessionnumber: number;
    type: string;
    groupfee: string | number;
    accountpaid: string | number;
    // null when nothing was paid, or for older rows the payment ledger couldn't match
    paymentmethod: 'Cash' | 'Credit Card' | null;
    voucherused: boolean;
    clientid: number;
    firstname: string;
    lastname: string;
    docnumber: string | null;
}

// from and to are YYYY-MM-DD, inclusive
export async function getGroupReport(from: string, to: string): Promise<GroupReportRow[]> {
    const res = await apiFetch(`${API_BASE}/reports/groups?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return jsonResponse(res, 'Failed to load the group report.');
}

// Bank deposit of one group session's cash
export interface GroupDeposit {
    groupid: number;
    sessiondate: string;
    sessionnumber: number;
    amountdeposited: string | number;
    depositdate: string;
    notes: string | null;
    recordedby: string | null;
    recordedon: string;
}

export interface GroupSessionRef {
    groupId: number;
    sessionDate: string;
    sessionNumber: number;
}

export async function getGroupDeposits(from: string, to: string): Promise<GroupDeposit[]> {
    const res = await apiFetch(`${API_BASE}/reports/group-deposits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return jsonResponse(res, 'Failed to load group deposits.');
}

export async function saveGroupDeposit(data: GroupSessionRef & { amountDeposited: number; depositDate: string; notes: string; user: string }): Promise<GroupDeposit> {
    const res = await apiFetch(`${API_BASE}/reports/group-deposits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to save the deposit.');
}

export async function deleteGroupDeposit(data: GroupSessionRef & { user: string }): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/reports/group-deposits`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to remove the deposit.');
}

// The deposit fields of a session in the group cash deposit report; all null while the cash is still held
export interface GroupCashDropOff {
    amountdeposited: string | number | null;
    depositdate: string | null;
    notes: string | null;
    recordedby: string | null;
    recordedbyname: string | null;
    recordedon: string | null;
}

export interface GroupCashDepositRow extends GroupCashDropOff {
    groupid: number;
    groupname: string;
    counselor: string | null;
    sessiondate: string;
    sessionnumber: number;
    openedby: string | null;
    openedbyname: string | null;
    coveredby: string | null;
    // Who holds the session's cash: the covering counselor, the group's counselor when the office opened it, or the opener
    responsible: string | null;
    responsiblename: string | null;
    closedon: string | null;
    attendance: string | number;
    cash: string | number;
}

// Business Administrators get every closed session that took cash; everyone else gets the ones they are responsible for
export async function getGroupCashDeposits(from: string, to: string, user: string): Promise<GroupCashDepositRow[]> {
    const res = await apiFetch(`${API_BASE}/reports/group-cash-deposits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&user=${encodeURIComponent(user)}`);
    return jsonResponse(res, 'Failed to load group cash deposits.');
}

// A cash payment taken outside a group session, and whether it was dropped off at the bank (deposit fields null while held)
export interface UserCashDepositRow {
    transactionid: number;
    paidon: string;
    amount: string | number;
    feetype: string | null;
    comments: string | null;
    // The employee who took the payment and holds the cash; null for payments from before this was recorded
    enteredby: string | null;
    enteredbyname: string | null;
    clientid: number | null;
    firstname: string | null;
    lastname: string | null;
    docnumber: string | null;
    depositdate: string | null;
    recordedby: string | null;
    recordedbyname: string | null;
    recordedon: string | null;
}

// Business Administrators get every cash payment taken outside a group; everyone else gets the ones they took
export async function getUserCashDeposits(from: string, to: string, user: string): Promise<UserCashDepositRow[]> {
    const res = await apiFetch(`${API_BASE}/reports/user-cash-deposits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&user=${encodeURIComponent(user)}`);
    return jsonResponse(res, 'Failed to load user cash deposits.');
}

// Returns the payment after the change
export async function setUserCashDroppedOff(data: { transactionId: number; droppedOff: boolean; depositDate: string; user: string }): Promise<UserCashDepositRow> {
    const res = await apiFetch(`${API_BASE}/reports/user-cash-deposits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to update the deposit.');
}

// A payment (or a refund or dispute against one) or a client note, with who entered it and when
export interface UserActivityRow {
    kind: 'Payment' | 'Note';
    id: number;
    client: number | null;
    firstname: string | null;
    lastname: string | null;
    docnumber: string | null;
    enteredon: string;
    // Employee email; null for payments entered before who entered them was recorded
    enteredby: string | null;
    enteredbyname: string | null;
    // The ledger type (Payment, Refund, Dispute, Dispute Won) or the note category
    detail: string;
    amount: string | number | null;
    paymentmethod: string | null;
    feetype: string | null;
    comments: string | null;
    editedby: string | null;
    editedbyname: string | null;
    editedon: string | null;
}

// Business Administrators and Office Admins only
export async function getUserActivity(from: string, to: string, user: string): Promise<UserActivityRow[]> {
    const res = await apiFetch(`${API_BASE}/reports/user-activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&user=${encodeURIComponent(user)}`);
    return jsonResponse(res, 'Failed to load the user activity report.');
}

// Returns the session's deposit after the change, or null when it has none
export async function setGroupCashDroppedOff(data: GroupSessionRef & { droppedOff: boolean; depositDate: string; user: string }): Promise<GroupCashDropOff | null> {
    const res = await apiFetch(`${API_BASE}/reports/group-cash-deposits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to update the deposit.');
}

// All-time payments (less refunds and disputes) and charges, with the 50 latest transactions
export interface DepositReport {
    totalRevenue: number;
    totalCharges: number;
    recentTransactions: FinancialTransaction[];
}

export async function getDepositReport(): Promise<DepositReport> {
    const res = await apiFetch(`${API_BASE}/reports/deposit`);
    return jsonResponse(res, 'Failed to load the monthly deposit report.');
}

export async function getEmployees(): Promise<Employee[]> {
    const res = await apiFetch(`${API_BASE}/admin/employees`);
    return jsonResponse(res, 'Failed to load employees.');
}

export async function updateEmployee(email: string, data: { displayName: string; role: string; active: boolean; updatedBy: string; password?: string }) {
    const res = await apiFetch(`${API_BASE}/admin/employees/${encodeURIComponent(email)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to update account.');
    }
    return body as { success: true };
}

export async function addEmployee(data: { employeeEmail: string; displayName: string; role: string; location: string; active: boolean; password: string }) {
    const res = await apiFetch(`${API_BASE}/admin/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body.error || 'Failed to create the account.');
    }
    return body as { success: true };
}

export interface SystemLog {
    logid: number;
    useremail: string;
    action: string;
    details: string | null;
    timestamp: string;
}

// Office Admins and Business Administrators only; the server checks the role
export async function getSystemLogs(): Promise<SystemLog[]> {
    const res = await apiFetch(`${API_BASE}/admin/logs`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body)) {
        throw new Error(body?.error || 'Failed to load the system logs.');
    }
    return body;
}

export interface SupervisingAgent {
    agentid: number;
    name: string;
    phone: string | null;
    email: string | null;
}

export async function getSupervisingAgents(): Promise<SupervisingAgent[]> {
    const res = await apiFetch(`${API_BASE}/agents`);
    return jsonResponse(res, 'Failed to load supervising agents.');
}

// Business Administrators and Office Admins only; the server checks the role. Renaming an agent moves their clients
// to the new name; clientsRenamed counts them (always 0 for a new agent).
export async function saveSupervisingAgent(agentId: number | null, data: { name: string; phone: string; email: string; user: string }): Promise<{ agent: SupervisingAgent; clientsRenamed: number }> {
    const res = await apiFetch(agentId ? `${API_BASE}/agents/${agentId}` : `${API_BASE}/agents`, {
        method: agentId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (agentId) return jsonResponse(res, 'Failed to save the supervising agent.');
    return { agent: await jsonResponse<SupervisingAgent>(res, 'Failed to save the supervising agent.'), clientsRenamed: 0 };
}

// Business Administrators only; the server checks the role
export async function deleteSupervisingAgent(agentId: number, user: string): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/agents/${agentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user }),
    });
    return jsonResponse(res, 'Failed to delete the supervising agent.');
}

// Newest first
export async function getClientAttendance(clientId: number): Promise<ClientAttendance[]> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/attendance`);
    return jsonResponse(res, 'Failed to load attendance.');
}

// Newest first
export async function getClientFinancials(clientId: number): Promise<FinancialTransaction[]> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/financials`);
    return jsonResponse(res, 'Failed to load the ledger.');
}

// Newest first
export async function getClientNotes(clientId: number): Promise<ClientNote[]> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/notes`);
    return jsonResponse(res, 'Failed to load case notes.');
}

export async function addClientNote(clientId: number, data: { user: string; comments: string; category: string }): Promise<ClientNote> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to save the note.');
}

// The note's author or a Business Administrator only; the server checks
export async function updateClientNote(noteId: number, data: { user: string; comments: string }): Promise<ClientNote> {
    const res = await apiFetch(`${API_BASE}/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to save the note.');
}

// Business Administrators only; grouped by client (sorted by client name, then oldest note first)
export async function getPendingNotes(): Promise<PendingNote[]> {
    const res = await apiFetch(`${API_BASE}/notes/pending`);
    return jsonResponse(res, 'Failed to load the notes awaiting approval.');
}

// Business Administrators only. Approving can save edited text with it.
export async function reviewClientNote(noteId: number, data: { decision: 'approve' | 'deny'; comments?: string; user: string }): Promise<ClientNote> {
    const res = await apiFetch(`${API_BASE}/notes/${noteId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to review the note.');
}

export async function deleteClientNote(noteId: number, user: string): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/notes/${noteId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user }),
    });
    return jsonResponse(res, 'Failed to delete the note.');
}

// Newest first
export async function getClientPolygraphs(clientId: number): Promise<PolygraphResult[]> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/polygraphs`);
    return jsonResponse(res, 'Failed to load polygraphs.');
}

export interface ClientAttachment {
    attachmentid: number;
    clientid: number;
    filename: string;
    contenttype: string;
    filesize: number;
    uploadedby: string | null;
    uploadedon: string;
}

// Matches the server's upload limit
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export async function getClientAttachments(clientId: number): Promise<ClientAttachment[]> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/attachments`);
    const body = await res.json();
    if (!res.ok || !Array.isArray(body)) {
        throw new Error(body?.error || 'Could not load attachments.');
    }
    return body;
}

// Sent as raw bytes; the name and real type travel in headers
export async function uploadClientAttachment(clientId: number, file: File, user: string): Promise<ClientAttachment> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/attachments`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
            'X-File-Type': file.type || 'application/octet-stream',
            'X-User': user,
        },
        body: file,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body.error || (res.status === 413 ? 'File is larger than 25 MB.' : `Upload failed (server responded ${res.status}).`));
    }
    return body;
}

// The file as a Blob typed with its saved content type, for viewing, downloading, or printing
export async function fetchClientAttachment(attachment: ClientAttachment): Promise<Blob> {
    const res = await apiFetch(`${API_BASE}/attachments/${attachment.attachmentid}`);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not open the attachment.');
    }
    return new Blob([await res.arrayBuffer()], { type: attachment.contenttype });
}

// The server keeps the original extension if the new name drops it; returns the saved attachment
export async function renameClientAttachment(attachmentId: number, fileName: string, user: string): Promise<ClientAttachment> {
    const res = await apiFetch(`${API_BASE}/attachments/${attachmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, user }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(body.error || 'Failed to rename the attachment.');
    }
    return body;
}

// Business Administrators only; the server checks the role
export async function deleteClientAttachment(attachmentId: number, user: string): Promise<void> {
    const res = await apiFetch(`${API_BASE}/attachments/${attachmentId}`, {
        method: 'DELETE',
        headers: { 'X-User': user },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to delete the attachment.');
    }
}

// A blank form or document on the Forms page (not tied to a client)
export interface LibraryDocument {
    documentid: number;
    filename: string;
    contenttype: string;
    filesize: number;
    category: string;
    description: string | null;
    uploadedby: string | null;
    uploadedon: string;
}

export async function getLibraryDocuments(): Promise<LibraryDocument[]> {
    const res = await apiFetch(`${API_BASE}/documents`);
    return jsonResponse(res, 'Could not load the forms.');
}

// Business Administrators and Office Admins only. Sent as raw bytes; the name, type, and category travel in headers.
export async function uploadLibraryDocument(file: File, category: string): Promise<LibraryDocument> {
    const res = await apiFetch(`${API_BASE}/documents`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
            'X-File-Type': file.type || 'application/octet-stream',
            'X-Category': encodeURIComponent(category),
        },
        body: file,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || (res.status === 413 ? 'File is larger than 25 MB.' : `Upload failed (server responded ${res.status}).`));
    return body;
}

// The file as a Blob typed with its saved content type, for viewing, downloading, or printing
export async function fetchLibraryDocument(doc: LibraryDocument): Promise<Blob> {
    const res = await apiFetch(`${API_BASE}/documents/${doc.documentid}`);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not open the document.');
    }
    return new Blob([await res.arrayBuffer()], { type: doc.contenttype });
}

// Business Administrators and Office Admins only; the server keeps the original extension
export async function updateLibraryDocument(id: number, changes: { fileName?: string; category?: string; description?: string }): Promise<LibraryDocument> {
    const res = await apiFetch(`${API_BASE}/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
    });
    return jsonResponse(res, 'Failed to save the document.');
}

// Business Administrators only
export async function deleteLibraryDocument(id: number): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
    return jsonResponse(res, 'Failed to delete the document.');
}

// A booking refusal the page acts on is marked with a code; any other refusal has only the error
export type PolyAssignReply =
    | { success: true; message: string; code?: undefined; error?: undefined }
    // Inside the waiting period after a No Deception Indicated result; a Business Administrator can bypass it
    | { success?: false; code: 'POLY_TOO_SOON'; error: string; lastPolyDate: string; earliestDate: string }
    | { success?: false; code: 'POLY_ALREADY_SCHEDULED'; error: string; slotId: number }
    // Short on poly fee vouchers or owing a balance; the client's current figures come back for the payment prompt
    | {
        success?: false; code: 'POLY_SCHEDULING_REQUIREMENTS'; error: string;
        vouchers: number; polyFeePaid: number; polyFee: number; accountBalance: number; amountDue: number; balanceDue: number;
    }
    | { success?: false; code?: undefined; error: string };

// bypassWaitPeriod: a Business Administrator's confirmed choice to schedule inside the post-NDI waiting period.
// Refusals come back as the reply instead of being thrown, so the caller can offer a payment or the bypass.
export async function assignPolygraphSlot(slotId: number, clientId: number, type: string, user: string, comments: string, bypassWaitPeriod = false): Promise<PolyAssignReply> {
    const res = await apiFetch(`${API_BASE}/polygraphs/slots/${slotId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, type, user, comments, bypassWaitPeriod }),
    });
    const body = await readJson(res) as PolyAssignReply;
    if (!res.ok && !body?.error) return { error: 'Failed to assign client to slot.' };
    return body;
}

// reopened is false when the appointment time had passed, so the slot was closed instead of reopened
export async function reopenPolygraphSlot(slotId: number, cancellation: { reason: string; notes: string; returnVouchers: boolean; overrideVoucherRule: boolean; user: string }): Promise<{ success: true; reopened: boolean; message: string }> {
    const res = await apiFetch(`${API_BASE}/polygraphs/slots/${slotId}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cancellation),
    });
    return jsonResponse(res, 'Failed to cancel the reservation.');
}

export async function deletePolygraphSlot(slotId: number): Promise<{ success: true; message: string }> {
    const res = await apiFetch(`${API_BASE}/polygraphs/slots/${slotId}`, {
        method: 'DELETE',
    });
    return jsonResponse(res, 'Failed to delete slot.');
}

export async function fetchClientFeeOverride(clientId: number): Promise<{ override: TempFeeOverride | null }> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/fee-override`);
    return jsonResponse(res, 'Fee override request failed.');
}

export async function saveClientFeeOverride(clientId: number, reducedFee: number, expirationDate: string, createdBy: string): Promise<{ override: TempFeeOverride }> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/fee-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reducedFee, expirationDate, createdBy }),
    });
    return jsonResponse(res, 'Fee override request failed.');
}

export async function deleteClientFeeOverride(clientId: number, removedBy: string): Promise<{ success: true; message: string }> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/fee-override`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removedBy }),
    });
    return jsonResponse(res, 'Fee override request failed.');
}

// Reduced poly fee for a number of fills (times the poly fee is paid in full and the vouchers fill), not a date
export interface PolyFeeOverride {
    overrideid: number;
    reducedfee: string | number;
    regularfee: string | number;
    fillsallowed: number;
    fillsused: number;
    createdby: string | null;
    createdon: string;
}

// The client's poly fields after an override change; a lower fee can fill the vouchers, a higher one can take them back
export interface PolyFeeOverrideResult {
    override?: PolyFeeOverride;
    polyFeePaid: number;
    polyFee: number;
    polyFeeVoucher: number;
    vouchersRemoved: number;
    vouchersAdded: number;
}

export async function fetchPolyFeeOverride(clientId: number) {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/poly-fee-override`);
    return jsonResponse<{ override: PolyFeeOverride | null }>(res, 'Failed to load the poly fee override.');
}

export async function savePolyFeeOverride(clientId: number, data: { reducedFee: number; fills: number; user: string }): Promise<PolyFeeOverrideResult> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/poly-fee-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to save the poly fee override.');
}

export async function deletePolyFeeOverride(clientId: number, user: string): Promise<PolyFeeOverrideResult> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/poly-fee-override`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user }),
    });
    return jsonResponse(res, 'Failed to remove the poly fee override.');
}