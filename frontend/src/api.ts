import type { SessionEntry } from './hooks/useGroupCheckIn';
import type { PaymentMethod } from './utils/paymentMethods';
import type { BipCheckInBlock } from './utils/bip';
import type { ClientCalendarData } from './utils/clientCalendar';

// The built site calls the API on its own address (the server answers /api on the site's port too; see
// backend/frontendServer.js), so it works at any address it is opened by: inside the office or from outside. The Vite
// dev server (5174) has no API of its own, so it uses the local backend on the same machine: port 5100 (VITE_API_PORT in
// frontend/.env.development, matching `npm start` in backend/). The live API on 5000 is not used by the dev server.
const API_BASE = import.meta.env.DEV ? `https://${globalThis.location?.hostname || 'localhost'}:${String(import.meta.env.VITE_API_PORT || '5100')}/api` : '/api';

// The login session token. Saved in the browser's storage, so refreshing keeps you logged in and every window and tab
// of the browser shares one login; logging out in one logs out all. The server ends the session 12 hours after login or
// after 2 hours without activity (backend/lib/auth.js). The holder is kept on the page's global object rather than in
// this module, so a copy of this module loaded by a live code update still sends the same token.
const SESSION_KEY = 'stop.session';
interface SessionHolder {
    token: string | null;
    onEnded: (() => void) | null;
    onDeviceBlocked?: (() => void) | null;
    onStarted?: (() => void) | null;
    listening?: boolean;
}
// Storage can be blocked (private window, site data cleared); the login then lasts until the page reloads
const readSavedToken = (): string | null => {
    try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
};
const session: SessionHolder = ((globalThis as { __stopSession?: SessionHolder }).__stopSession ??= { token: readSavedToken(), onEnded: null });

const setToken = (token: string | null) => {
    session.token = token;
    try {
        if (token) localStorage.setItem(SESSION_KEY, token);
        else localStorage.removeItem(SESSION_KEY);
    } catch { /* storage blocked: this window still works */ }
};

// Another window logged in or out: follow it
if (!session.listening && typeof window !== 'undefined') {
    session.listening = true;
    window.addEventListener('storage', (e) => {
        if (e.key !== SESSION_KEY && e.key !== null) return;
        const saved = readSavedToken();
        if (saved === session.token) return;
        const hadToken = session.token !== null;
        session.token = saved;
        if (saved) session.onStarted?.();
        else if (hadToken) session.onEnded?.();
    });
}

// True when this browser has a saved login to restore (checked with getCurrentUser)
export const hasSavedSession = () => session.token !== null;

// Called when the server refuses the token (expired, logged out elsewhere, or account deactivated)
export function setSessionEndedHandler(handler: (() => void) | null) {
    session.onEnded = handler;
}

// Called when another window of this browser logs in
export function setSessionStartedHandler(handler: (() => void) | null) {
    session.onStarted = handler;
}

// Called when the server refuses this device (its approval was removed while someone was using it)
export function setDeviceBlockedHandler(handler: (() => void) | null) {
    session.onDeviceBlocked = handler;
}

// fetch with the session token attached. Every API call except login goes through this. credentials: 'include' sends
// the device cookie (backend/lib/devices.js), which the dev server needs because its API is on another port.
// background: a timed refresh nobody asked for, which must not count as activity (X-Background, backend/lib/auth.js).
async function apiFetch(url: string, init: RequestInit = {}, { background = false } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (session.token) headers.set('Authorization', `Bearer ${session.token}`);
    if (background) headers.set('X-Background', '1');
    const res = await fetch(url, { ...init, headers, credentials: 'include' });
    if (res.status === 401 && session.token) {
        setToken(null);
        session.onEnded?.();
    }
    if (res.status === 403) {
        const body = await res.clone().json().catch(() => null) as { code?: string } | null;
        if (body?.code === 'device') {
            setToken(null);
            session.onDeviceBlocked?.();
        }
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
    doctype?: string | null;
    // Who referred the client (utils/clients.ts REFERRAL_TYPES) and the details typed beside it
    referredbytype?: string | null;
    referredby?: string | null;
    supervisingagent: string | null;
    programstartdate: string;
    lastdateattended: string | null;
    programstatus: string;
    // BIP clients keep a whole-number week here instead of a phase
    phase: string;
    groupid: number | null;
    // SO clients only: a counselor's INDIVIDUAL group, held apart from the regular group
    individualgroupid?: number | null;
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
    pretrial: boolean;
    race: string | null;
    dateofbirth: string | null;
    sex: string | null;
    polyvouchersbeforefill: number | null;
    // The counselor the client is waiting to be assessed by; cleared when an assessment is closed
    assessor: string | null;
    // Bus passes a federal client may still be granted (0 to 2)
    buspasses: number;
    // Bus passes set at the start of each calendar month, replacing what's left (0 = no refill)
    buspassrefill: number;
    // Card payments blocked by a Business Administrator (e.g. after a dispute): cash only. See utils/cardBlock.ts.
    cardpaymentsblocked: boolean;
    cardblockreason: string | null;
    cardblockedby: string | null;
    cardblockedon: string | null;
    // Check payments blocked by a Business Administrator (e.g. after a bounced check). See utils/checkBlock.ts.
    checkpaymentsblocked: boolean;
    checkblockreason: string | null;
    checkblockedby: string | null;
    checkblockedon: string | null;
}

export type CardBlock = Pick<ClientColumns, 'cardpaymentsblocked' | 'cardblockreason' | 'cardblockedby' | 'cardblockedon'>;
export type CheckBlock = Pick<ClientColumns, 'checkpaymentsblocked' | 'checkblockreason' | 'checkblockedby' | 'checkblockedon'>;

// A client on the roster, with its group and the check-in facts the frontend needs
export interface Client extends Omit<ClientColumns, 'programtype'> {
    groupname: string | null;
    individualgroupname?: string | null;
    // Federal billing units by code ({ '6022': 4 }); a code with no entry is blank
    federalunits?: Record<string, number | string> | null;
    // Monthly refills by code ({ '6022': 8 }): on the 1st the code's units are set to this
    federalunitrefills?: Record<string, number | string> | null;
    // Federal clients: what they pay instead of the regular fee (blank = nothing): Group Copay for group attendance,
    // Individual Copay for individual sessions, Polygraph Copay charged to the account when a polygraph is scheduled
    groupcopay?: Money | null;
    individualcopay?: Money | null;
    polycopay?: Money | null;
    // The client's own program type, else the group's, else State SO
    programtype: string;
    lastattended: string | null;
    lastpoly: string | null;
    // Day (YYYY-MM-DD) of the next scheduled polygraph, today or later; null when none is booked
    nextpoly?: string | null;
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
    // A counselor's license credentials, e.g. "LPC, LADC-MH" (printed after their name on receipts)
    credentials?: string | null;
    // The signed-in user only (backend/lib/auth.js sessionUser): a DEV account, which opens the DEV menu
    isdev?: boolean;
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
    // Other payments (utils/paymentMethods.ts): the kind and reference #
    paymentsubtype?: string | null;
    paymentreference?: string | null;
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
    // Other payments (utils/paymentMethods.ts): the kind and reference #
    paymentsubtype?: string | null;
    paymentreference?: string | null;
    attendanceid: number | null;
    originalamount: Money | null;
    adjustedby: string | null;
    adjustedon: string | null;
    adjustmentreason: string | null;
    relatedtransactionid: number | null;
    disputestatus: string | null;
    // On a client's ledger: the fee charged at the check-in this payment was taken at (a check-in has one ledger
    // row, its payment); null on every other row
    sessionfee?: Money | null;
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
    doctype?: string | null;
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
        credentials: 'include',
    });
    const data = await res.json() as LoginReply & { code?: string };
    if (res.status === 403 && data.code === 'device') session.onDeviceBlocked?.();
    if (data.success && data.token) setToken(data.token);
    return data;
}

// The employee for the saved login, or null when there is none or it has ended (12 hours, or 2 hours idle)
export async function getCurrentUser(): Promise<Employee | null> {
    if (!session.token) return null;
    const res = await apiFetch(`${API_BASE}/auth/me`);
    if (res.status === 401 || res.status === 403) return null;
    return (await jsonResponse<{ user: Employee }>(res, 'Could not restore the login.')).user;
}

// --- Device approval (backend/lib/devices.js). These work before the device is approved. ---
export type DeviceState = 'none' | 'pending' | 'approved' | 'denied' | 'revoked' | 'expired';

async function devicePost(path: string, body: unknown, fallback: string): Promise<{ state: DeviceState }> {
    const res = await fetch(`${API_BASE}/devices/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
    });
    return jsonResponse(res, fallback);
}

export async function getDeviceStatus(): Promise<DeviceState> {
    const res = await fetch(`${API_BASE}/devices/status`, { credentials: 'include' });
    return (await jsonResponse<{ state: DeviceState }>(res, 'Could not check this device.')).state;
}

export const requestDeviceAccess = (request: { name: string; email: string; note: string }) =>
    devicePost('request', request, 'Could not send the request.');

export const redeemSetupCode = (code: string) => devicePost('redeem', { code }, 'Could not use that setup code.');

// A device as the DEV tab shows it
export interface DeviceRow {
    deviceId: number;
    status: DeviceState;
    name: string;
    requestName: string | null;
    requestEmail: string | null;
    requestRole: string | null;
    requestNote: string | null;
    userAgent: string | null;
    lastSeenOn: string | null;
    requestedOn: string;
    expiresOn: string | null;
    decidedOn: string | null;
    decidedBy: string | null;
    approvalMemo: string | null;
    current: boolean;
}

export async function getDevices(): Promise<DeviceRow[]> {
    return jsonResponse(await apiFetch(`${API_BASE}/devices`), 'Failed to load the devices.');
}

async function deviceAction(deviceId: number, action: string, body: unknown, fallback: string) {
    const res = await apiFetch(`${API_BASE}/devices/${deviceId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return jsonResponse<{ success: true }>(res, fallback);
}

export const approveDevice = (deviceId: number, memo: string, name?: string) =>
    deviceAction(deviceId, 'approve', { memo, name }, 'Failed to approve the device.');
export const denyDevice = (deviceId: number, memo: string) =>
    deviceAction(deviceId, 'deny', { memo }, 'Failed to deny the request.');
export const revokeDevice = (deviceId: number) => deviceAction(deviceId, 'revoke', {}, 'Failed to remove the device.');
export const renameDevice = (deviceId: number, name: string) =>
    deviceAction(deviceId, 'rename', { name }, 'Failed to rename the device.');

export async function logoutUser() {
    if (!session.token) return;
    await apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' }).catch(() => {});
    setToken(null);
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

// A client a counselor covered a group session for in the last 30 days (the signed-in counselor's own covers)
export interface CoveredClient {
    clientid: number;
    lastcovered: string;
}

export async function getCoveredByMe(): Promise<CoveredClient[]> {
    const res = await apiFetch(`${API_BASE}/clients/covered-by-me`);
    return jsonResponse(res, 'Failed to load the clients you covered.');
}

// The signed-in employee's group sessions in one month ("YYYY-MM"): closed ones and open sheets, with what they did
export interface MyClosedSession {
    groupid: number;
    groupname: string;
    sessiondate: string;
    sessionnumber: number;
    clients: number;
    openedbyme: boolean;
    closedbyme: boolean;
    coveredforme: boolean;
}

export interface MyOpenSession {
    groupid: number;
    groupname: string;
    sessiondate: string;
    sessionnumber: number;
    openedbyme: boolean;
    coveredforme: boolean;
}

// One cancelled or rescheduled meeting of a group (My Day). newdate/newtime (HH:MM) are set for a reschedule; notes is
// how many clients got a Group Cancel or Group Reschedule case note.
export interface GroupScheduleChange {
    changeid: number;
    groupid: number;
    groupname: string;
    originaldate: string;
    action: 'Cancelled' | 'Rescheduled';
    newdate: string | null;
    newtime: string | null;
    reason: string | null;
    createdby: string | null;
    notes: number;
}

// Changes whose original or new date is in the month (YYYY-MM)
export async function getGroupScheduleChanges(month: string): Promise<GroupScheduleChange[]> {
    const res = await apiFetch(`${API_BASE}/group-schedule-changes?month=${encodeURIComponent(month)}`);
    return jsonResponse(res, 'Failed to load group schedule changes.');
}

// Picking a group to check in on a day (YYYY-MM-DD) that isn't its regular day: offer says whether to ask about moving
// that week's meeting (scheduledDate) there, at newTime (HH:MM, its regular time)
export interface GroupOffDay {
    offDay: boolean;
    scheduledDate?: string;
    newTime?: string;
    offer?: boolean;
    groupName?: string;
    scheduleDay?: string;
    clients?: number;
}
export async function getGroupOffDay(groupId: number, date: string): Promise<GroupOffDay> {
    const res = await apiFetch(`${API_BASE}/groups/${groupId}/off-day?date=${encodeURIComponent(date)}`);
    return jsonResponse(res, 'Failed to check the group\'s schedule.');
}

// Cancel or reschedule one meeting; every active client in the group gets a case note
export async function changeGroupMeeting(groupId: number | string, data: { originalDate: string; action: 'Cancelled' | 'Rescheduled'; newDate?: string; newTime?: string; reason: string }): Promise<{ success: true; changeId: number; notes: number }> {
    const res = await apiFetch(`${API_BASE}/groups/${groupId}/schedule-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, createdBy: '' }),
    });
    return jsonResponse(res, 'Failed to change the meeting.');
}

// Undo a cancel or reschedule; its case notes are removed
export async function undoGroupScheduleChange(changeId: number): Promise<{ success: true; notesRemoved: number }> {
    const res = await apiFetch(`${API_BASE}/group-schedule-changes/${changeId}`, { method: 'DELETE' });
    return jsonResponse(res, 'Failed to undo the change.');
}

// One of the counselor's own assessment times (Assessments calendar): open availability, or a scheduled client
export interface MyAssessment {
    appointmentid: number;
    apptdate: string;
    appttime: string;
    location: string | null;
    status: 'Open' | 'Scheduled';
    // As stored, so a reschedule from My Day keeps the same counselor and note
    assessor: string;
    notes: string | null;
    firstname: string | null;
    lastname: string | null;
}

// counselor (a display name): another counselor's month, for the Calendars tab (office roles only)
// groupDays: every day the counselor's groups had a check-in (whoever ran it), over the whole weeks the month shows
export interface MyGroupDay {
    groupid: number;
    sessiondate: string;
}
export async function getMySessions(month: string, counselor?: string): Promise<{ closed: MyClosedSession[]; open: MyOpenSession[]; assessments: MyAssessment[]; groupDays?: MyGroupDay[] }> {
    const res = await apiFetch(`${API_BASE}/my-sessions?month=${encodeURIComponent(month)}${counselor ? `&counselor=${encodeURIComponent(counselor)}` : ''}`);
    return jsonResponse(res, 'Failed to load your sessions for this month.');
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

// Business Administrators only (the server checks the role): block or allow card payments for a client. Blocking needs a reason.
export async function setClientCardPayments(clientId: number, blocked: boolean, reason: string): Promise<CardBlock> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/card-payments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked, reason }),
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to change card payments for this client.');
    }
    return body;
}

// Business Administrators only (the server checks the role): block or allow check payments for a client. Blocking needs a reason.
export async function setClientCheckPayments(clientId: number, blocked: boolean, reason: string): Promise<CheckBlock> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/check-payments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked, reason }),
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to change check payments for this client.');
    }
    return body;
}

// Grants one of a federal client's bus passes; returns how many are left and the Bus Pass case note it added
export async function grantBusPass(clientId: number, busPassNumber: string, user: string): Promise<{ busPasses: number; note: ClientNote }> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/bus-pass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ busPassNumber, user }),
    });
    return jsonResponse(res, 'Failed to grant the bus pass.');
}

// 'discharge' is Business Administrators only (the server checks the role); 'activate' sets a discharged client
// back to Active or Inactive. Returns the client's new program status.
export async function changeClientProgramStatus(action: 'discharge' | 'activate', clientId: number, status: string, subcategories: string[], note: string, user: string): Promise<string> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, subcategories, note, user }),
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

// A save refused because someone else changed the same thing first (HTTP 409). current is the record as it is now.
export class EditConflictError<T> extends Error {
    current: T;
    constructor(message: string, current: T) {
        super(message);
        this.name = 'EditConflictError';
        this.current = current;
    }
}

// Like jsonResponse, but a save refused because the record changed on another screen since it was loaded (409 with
// conflict, or with the note as it is now) throws EditConflictError so the screen can reload it
async function savedResponse<T>(res: Response, fallback: string): Promise<T> {
    if (res.status !== 409) return jsonResponse(res, fallback);
    const body = await readJson(res) as { error?: string; conflict?: boolean; note?: unknown } | null;
    if (body?.conflict || body?.note) throw new EditConflictError(body.error || fallback, body.note ?? null);
    throw new Error(body?.error || fallback);
}

// Sends only the changed fields; expected holds each one's value as shown when it was first changed (see
// backend/lib/editConflicts.js). Throws EditConflictError when someone else changed one of them meanwhile.
// PATCH, not PUT: a server not restarted since this came in has no PATCH route, so it refuses (asking for a restart)
// instead of treating the fields not sent as blank.
export async function updateClient(clientId: number, data: ClientFields & { updatedBy: string; expected?: Record<string, unknown> }) {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const text = await res.text();
    let body: { success?: boolean; client?: Record<string, unknown>; error?: string; conflicts?: string[] };
    try {
        body = JSON.parse(text);
    } catch {
        // Express returns an HTML error page when the route is missing, which usually means the backend needs a restart
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}). Restart the backend (node server.js) and try again.`);
    }
    if (res.status === 409 && body.conflicts && body.client) {
        throw new EditConflictError(body.error || 'This client was changed on another screen.', { client: body.client, conflicts: body.conflicts });
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

// Whether the client could be deleted now (nothing kept on record still points at them). Business Administrators only.
export async function getClientDeletable(clientId: number): Promise<boolean> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/deletable`);
    const body = await jsonResponse<{ deletable: boolean }>(res, 'Failed to check whether the client can be deleted.');
    return body.deletable;
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

// expected: the group as the form loaded it; throws EditConflictError when it was changed on another screen since
export async function updateGroup(groupId: number, data: { groupName: string; location: string; counselor: string; programType: string; schedule: string; address: string; active: boolean; expected?: Record<string, unknown> }) {
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
    if (res.status === 409 && (body as { conflict?: boolean }).conflict) {
        throw new EditConflictError(body.error || 'This group was changed on another screen.', null);
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

export interface BatchAttendanceEntry {
    client: number;
    groupFee: number;
    accountPaid: number;
    paymentMethod: PaymentMethod;
    // Other payments: the kind (Check, DHS, ...) and an optional reference #
    paymentSubtype?: string | null;
    paymentReference?: string | null;
    voucherUsed: boolean;
    // Goes on the client's case notes as a Therapist note naming the BIP week or attendance count (backend lib/attendanceNotes.js)
    comments: string;
    // An approved make-up attendance; marked on the attendance itself
    makeup?: boolean;
    // Federal SO clients: how long they attended, which sets the 6022 / 6012 units used (utils/federalUnits.ts)
    durationBand?: string;
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
        // How many comments were added to case notes as Therapist notes
        notesAdded?: number;
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
    // note: the client's Therapist note from this attendance, without its heading (null when none)
    entries: {
        client: number; name: string; groupFee: number; accountPaid: number; paymentMethod: string | null;
        paymentSubtype?: string | null; paymentReference?: string | null;
        attendanceId: number; programType: string | null; note: string | null;
    }[];
}

// Update Attendance Notes on a closed group. Each change sends the note as it was shown (original, null when the client
// had none); if one was changed on another screen meanwhile, nothing is saved and this throws with the server's message.
export async function updateClosedGroupNotes(data: {
    group: number; date: string; sessionNumber: number;
    notes: { attendanceId: number; text: string; original: string | null }[];
}): Promise<{ added: number; updated: number; removed: number }> {
    const res = await apiFetch(`${API_BASE}/closed-groups/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to update the attendance notes.');
    }
    return body;
}

// Only the closed sessions this user may see: Business Administrators see all; others see their groups' and the ones they opened
// range: session dates (YYYY-MM-DD) to include; an empty end means no limit that way. The server sends at most 500.
export const CLOSED_GROUPS_MAX = 500;
export async function getClosedGroups(user: string, range: { from: string; to: string } = { from: '', to: '' }): Promise<ClosedGroupSession[]> {
    const q = new URLSearchParams({ user });
    if (range.from) q.set('from', range.from);
    if (range.to) q.set('to', range.to);
    const res = await apiFetch(`${API_BASE}/closed-groups?${q}`);
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
    // Other payments (utils/paymentMethods.ts): the kind and reference #
    paymentsubtype?: string | null;
    paymentreference?: string | null;
}

export interface OpenAssessment {
    // The open session's id while Scheduled; the attendance id once In Progress
    opensessionid: number;
    status: 'Scheduled' | 'In Progress';
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
    // The entry as the form loaded it (edits); throws EditConflictError when it was changed on another screen since
    expected?: Record<string, unknown>;
}): Promise<SessionType> {
    const res = await apiFetch(`${API_BASE}/session-types${data.id ? `/${data.id}` : ''}`, {
        method: data.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return savedResponse(res, 'Failed to save the price list entry.');
}

// Standard treatment fees kept in Admin: feekey is an SO phase (State SO / Voluntary SO price) or 'BIP'
export interface ProgramFee {
    feekey: string;
    label: string;
    fee: Money;
    updatedby: string | null;
    updatedon: string;
}

export async function getProgramFees(): Promise<ProgramFee[]> {
    const res = await apiFetch(`${API_BASE}/program-fees`);
    return jsonResponse(res, 'Failed to load the treatment fees.');
}

// applyToClients: also move current clients still on the old price to the new one
export async function saveProgramFee(data: { feekey: string; fee: number; applyToClients: boolean; user: string }): Promise<{ fee: ProgramFee; clientsUpdated: number }> {
    const res = await apiFetch(`${API_BASE}/program-fees/${encodeURIComponent(data.feekey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to save the price.');
}

// A federal billing code (Admin > Billing Federal Units). programs: the client programs that track its units.
export interface FederalUnitCode {
    code: string;
    label: string;
    programs: string[];
    // Clients can have a monthly refill for it (6022, 6012)
    refillable: boolean;
    // Blank (null) until a Business Administrator sets it
    price: Money | null;
    updatedby: string | null;
    updatedon: string | null;
}

export async function getFederalUnitCodes(): Promise<FederalUnitCode[]> {
    const res = await apiFetch(`${API_BASE}/federal-units`);
    return jsonResponse(res, 'Failed to load the federal billing units.');
}

// A blank price (null) clears it
export async function saveFederalUnitPrice(data: { code: string; price: number | null; user: string }): Promise<FederalUnitCode> {
    const res = await apiFetch(`${API_BASE}/federal-units/${encodeURIComponent(data.code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to save the price.');
}

export interface OpenIndividualSession {
    opensessionid: number;
    clientid: number;
    firstname: string;
    lastname: string;
    docnumber: string | null;
    doctype?: string | null;
    programtype: string | null;
    category: IndividualCategory;
    // null for an assessment opened from the Assessment Calendar until its type is chosen
    sessiontypeid: number | null;
    sessiontypename: string | null;
    sessiondate: string;
    fee: string | number;
    payment: string | number;
    paymentmethod: 'Cash' | 'Credit Card' | null;
    provider: string | null;
    comments: string | null;
    paymentcomments: string | null;
    // Cash already applied to the account when the session was saved as open (individual sessions)
    paidonopen: string | number;
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
    // Other payments (utils/paymentMethods.ts): the kind and reference #
    paymentsubtype?: string | null;
    paymentreference?: string | null;
    paidonopen: string | number;
    provider: string | null;
    comments: string | null;
    paymentcomments: string | null;
    openedby: string | null;
    // For an assessment: who completed it and when; for other sessions, who recorded them
    closedby: string | null;
    closedon: string | null;
    begunby: string | null;
    begunon: string | null;
    fundedby: 'DHS Voucher' | 'Invoice' | null;
    fundedprice: string | number | null;
    notecount: number;
}

// An assessment begun (paid) and being worked on; the attendance row, dated the day it was begun
export interface AssessmentInProgress {
    attendanceid: number;
    clientid: number;
    firstname: string;
    lastname: string;
    docnumber: string | null;
    doctype: string | null;
    programtype: string | null;
    sessiontypeid: number | null;
    sessiontypename: string;
    kind: SessionTypeKind;
    beganon: string;
    daysopen: number;
    provider: string | null;
    fee: string | number;
    paid: string | number;
    paymentmethod: string | null;
    // Other payments (utils/paymentMethods.ts): the kind and reference #
    paymentsubtype?: string | null;
    paymentreference?: string | null;
    openedby: string | null;
    begunby: string | null;
    assessmentstatus: 'In Progress' | 'Completed';
    // Begun on a DHS invoice or voucher: the client wasn't charged (fee 0) and fundedprice is what it was billed at
    fundedby: 'DHS Voucher' | 'Invoice' | null;
    fundedprice: string | number | null;
    notecount: number;
    lastnoteon: string | null;
}

export interface AssessmentNote {
    noteid: number;
    date: string;
    User: string | null;
    comments: string;
    editedby: string | null;
    editedon: string | null;
}

export interface AssessmentDetail extends AssessmentInProgress {
    notes: AssessmentNote[];
}

export interface BeginAssessmentPayload {
    // The scheduled assessment being begun, or null to begin one on the spot
    openSessionId: number | null;
    client: number;
    sessionTypeId: number;
    // Used only for a Business Administrator; everyone else is charged the price list's
    fee: number;
    payment: number;
    provider: string;
    // The first note on the assessment (optional)
    comments: string;
    paymentComments: string;
    // The payment for the fee and any past due balance was received
    paymentConfirmed: boolean;
    // Business Administrators only: a DHS voucher or invoice lets it begin without paying the fee (still charged to the account), with a required note
    fundedBy: 'DHS Voucher' | 'Invoice' | null;
    fundingNote: string;
    user: string;
}

// Takes the payment, charges the fee and records the attendance today, In Progress
export async function beginAssessment(data: BeginAssessmentPayload): Promise<{ attendanceId: number; newBalance: string | number }> {
    const res = await apiFetch(`${API_BASE}/assessments/begin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to begin the assessment.');
}

export async function getAssessmentsInProgress(): Promise<AssessmentInProgress[]> {
    const res = await apiFetch(`${API_BASE}/assessments/in-progress`);
    return jsonResponse(res, 'Failed to load the assessments in progress.');
}

export async function getAssessment(attendanceId: number): Promise<AssessmentDetail> {
    const res = await apiFetch(`${API_BASE}/assessments/${attendanceId}`);
    return jsonResponse(res, 'Failed to load the assessment.');
}

export async function addAssessmentNote(attendanceId: number, comments: string, user: string): Promise<AssessmentNote> {
    const res = await apiFetch(`${API_BASE}/assessments/${attendanceId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments, user }),
    });
    return jsonResponse(res, 'Failed to add the note.');
}

// paperworkCompleted: BIP intakes (intake paperwork) and reinstates (contract signed) need it; comments: an optional last note
export async function completeAssessment(attendanceId: number, data: { paperworkCompleted: boolean; comments: string; user: string }): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/assessments/${attendanceId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to complete the assessment.');
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

// newBalance is set when an individual session's payment was applied to the account while saving
export async function saveOpenIndividualSession(data: IndividualSessionPayload): Promise<OpenIndividualSession & { newBalance: string | number | null }> {
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
    // The ledger row(s) the payment saved: one, or two when it was split with the poly fee
    transactionIds: number[];
}

// One ledger row found by its ID (Admin > Transaction Lookup)
export interface TransactionRow {
    transactionid: number;
    client: number;
    date: string;
    type: string;
    amount: Money;
    feetype: string | null;
    finalbalance: Money | null;
    comments: string | null;
    paymentmethod: string | null;
    // Other payments (utils/paymentMethods.ts): the kind and reference #
    paymentsubtype?: string | null;
    paymentreference?: string | null;
    attendanceid: number | null;
    originalamount: Money | null;
    adjustedby: string | null;
    adjustedon: string | null;
    adjustmentreason: string | null;
    relatedtransactionid: number | null;
    disputestatus: string | null;
    enteredby: string | null;
}
export interface TransactionLookup extends TransactionRow {
    firstname: string | null;
    lastname: string | null;
    docnumber: string | null;
    doctype?: string | null;
    programtype: string | null;
    // The check-in the row was saved with, if any
    attendancedate: string | null;
    attendancetype: string | null;
    groupname: string | null;
    // Rows tied to it: the same check-in's fee or payment, refunds, disputes
    related: TransactionRow[];
}

export async function lookupTransaction(id: number): Promise<TransactionLookup> {
    const res = await apiFetch(`${API_BASE}/transactions/${id}`);
    return jsonResponse(res, 'Failed to look up the transaction.');
}

export async function submitAccountPayment(data: { client: number; amount: number; comments: string; createdBy: string; paymentMethod: PaymentMethod; paymentSubtype?: string | null; paymentReference?: string | null; applyToPolyFee?: boolean }): Promise<AccountPaymentResult> {
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

// Forgives some or all of what a client owes (Business Administrators and DEV). expectedOwed is the balance the form
// showed; the server refuses if it changed meanwhile.
export async function forgiveClientDebt(clientId: number, data: { amount: number; reason: string; expectedOwed: number }): Promise<{ success: true; newBalance: number; forgiven: number; transactionId: number }> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/forgive-debt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Could not forgive the debt.');
}

// Changes the amount of a debt forgiveness, or undoes it with amount 0 (the client owes it again). expectedAmount is
// what the row showed; the server refuses if someone corrected it meanwhile.
export async function updateForgiveness(transactionId: number, data: { amount: number; reason: string; expectedAmount: number }): Promise<{ success: true; newBalance: number; amount: number; undone: boolean }> {
    const res = await apiFetch(`${API_BASE}/financials/${transactionId}/forgiveness`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Could not change the forgiveness.');
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

// Moves a credit card payment to another client's account (the wrong client was checked in and charged)
export async function moveCardPayment(transactionId: number, data: { fromClient: number; toClient: number; reason: string }): Promise<{ success: true; fromBalance: number; toBalance: number }> {
    const res = await apiFetch(`${API_BASE}/financials/${transactionId}/move-to-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return jsonResponse(res, 'Failed to move the card payment.');
}

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

// When the client last took a polygraph (YYYY-MM-DD) and their next scheduled one, for printed receipts
export interface PolySummary {
    takesPolygraphs: boolean;
    lastTaken: string | null;
    next: { date: string; time: string | null; location: string | null; address: string | null } | null;
}
export async function getPolySummary(clientId: number): Promise<PolySummary> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/poly-summary`);
    return jsonResponse(res, 'Failed to load the polygraph dates.');
}

// background: the Polygraphs tab's timed refresh, which doesn't count as activity
export async function getPolygraphSlots({ background = false } = {}): Promise<PolygraphSlot[]> {
    const res = await apiFetch(`${API_BASE}/polygraphs/slots`, {}, { background });
    return jsonResponse(res, 'Failed to load polygraph slots.');
}

// polygrapher is the examiner's employee email; date (YYYY-MM-DD) and time (HH:MM) must be in the future
export async function createPolygraphSlot(data: { location: string; address: string; date: string; time: string; polygrapher: string; comments: string; slots: number }): Promise<{ success: true; slotId: number }> {
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
    paymentmethod: PaymentMethod | null;
    paymentsubtype?: string | null;
    voucherused: boolean;
    clientid: number;
    firstname: string;
    lastname: string;
    docnumber: string | null;
    doctype?: string | null;
}

// from and to are YYYY-MM-DD, inclusive
export async function getGroupReport(from: string, to: string): Promise<GroupReportRow[]> {
    const res = await apiFetch(`${API_BASE}/reports/groups?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return jsonResponse(res, 'Failed to load the group report.');
}

// --- Financial Summary report (Business Administrators only); utils/financialReport.ts adds it up ---
type Amount = string | number;
export interface FinancialLedgerRow {
    month: string; // YYYY-MM
    type: string; // Payment, Charge, Adjustment, Refund, Dispute, Dispute Won (or Voucher on old rows)
    feetype: string; // '' when none was saved
    paymentmethod: string; // '' when none was saved
    atcheckin: boolean;
    count: number;
    amount: Amount;
}
export interface FinancialAttendanceRow {
    month: string;
    type: string;
    fundedby: '' | 'DHS Voucher' | 'Invoice';
    count: number;
    fees: Amount;
    fundedprice: Amount;
    importedpaid: Amount;
}
export interface FinancialCashTotals {
    cash: Amount;
    deposited: Amount;
    held: Amount;
    heldcount: number;
}
export interface FinancialBalanceRow {
    programstatus: string;
    clients: number;
    owing: number;
    owed: Amount;
    incredit: number;
    credit: Amount;
}
export interface FinancialSummaryData {
    ledger: FinancialLedgerRow[];
    attendance: FinancialAttendanceRow[];
    groupCash: FinancialCashTotals & { sessions: number };
    userCash: FinancialCashTotals & { payments: number };
    balances: FinancialBalanceRow[];
}

// from and to are YYYY-MM-DD, inclusive
export async function getFinancialSummary(from: string, to: string): Promise<FinancialSummaryData> {
    const res = await apiFetch(`${API_BASE}/reports/financial-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return jsonResponse(res, 'Failed to load the financial summary.');
}

// --- Director's reports (Business Administrators only); utils/directorReports.ts adds them up ---
// One client who owes money today, with the balance split by how old the charges behind it are (bucket keys)
export interface AgingClient {
    clientid: number;
    balance: Amount;
    firstname: string;
    lastname: string;
    docnumber: string | null;
    doctype: string | null;
    programtype: string;
    programstatus: string;
    lastattended: string | null; // YYYY-MM-DD
    lastpayment: string | null; // YYYY-MM-DD
    [bucket: string]: Amount | string | null | number;
}
export interface AgingReport {
    buckets: { key: string; label: string }[];
    clients: AgingClient[];
}
export async function getArAging(): Promise<AgingReport> {
    const res = await apiFetch(`${API_BASE}/reports/ar-aging`);
    return jsonResponse(res, 'Failed to load the accounts receivable aging report.');
}

export interface CensusRow {
    month: string; // YYYY-MM
    programtype: string;
    enrolled: number;
    intakes: number;
    discharged: number;
    wentinactive: number;
    seen: number;
}
export async function getCensus(from: string, to: string): Promise<CensusRow[]> {
    const res = await apiFetch(`${API_BASE}/reports/census?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return jsonResponse(res, 'Failed to load the census.');
}

export interface OutcomeRow {
    month: string;
    programtype: string;
    type: string; // discharge type, e.g. Completed or Program Failed
    subcategory: string; // '' when none
    estimated: boolean; // no discharge record: dated by the client's last day attended
    count: number;
    totaldays: number; // days in the program, summed over the withdays discharges that have a start date
    withdays: number;
}
export async function getDischargeOutcomes(from: string, to: string): Promise<OutcomeRow[]> {
    const res = await apiFetch(`${API_BASE}/reports/discharge-outcomes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return jsonResponse(res, 'Failed to load discharge outcomes.');
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
    // Its Money on Hand bank deposit (null for an older check-off), the slip number, and whether it was checked
    bankdepositid?: number | null;
    slipnumber?: string | null;
    bankchecked?: boolean;
    // Who holds the money now, after any hand-offs (or held it when it was dropped off)
    holder?: string | null;
    holdername?: string | null;
}

// Business Administrators get every closed session that took cash; everyone else gets the ones they were responsible for or hold now
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
    // Cash, or Other with its kind (Check, Money Order, Cashier's Check) and reference #
    paymentmethod?: string | null;
    paymentsubtype?: string | null;
    paymentreference?: string | null;
    // The employee who took the payment and holds the cash; null for payments from before this was recorded
    enteredby: string | null;
    enteredbyname: string | null;
    clientid: number | null;
    firstname: string | null;
    lastname: string | null;
    docnumber: string | null;
    doctype?: string | null;
    depositdate: string | null;
    recordedby: string | null;
    recordedbyname: string | null;
    recordedon: string | null;
    // Its Money on Hand bank deposit (null for an older check-off), the slip number, and whether it was checked
    bankdepositid?: number | null;
    slipnumber?: string | null;
    bankchecked?: boolean;
    // Who holds the money now, after any hand-offs (or held it when it was dropped off)
    holder?: string | null;
    holdername?: string | null;
}

// Business Administrators get every cash payment taken outside a group; everyone else gets the ones they took or hold now
export async function getUserCashDeposits(from: string, to: string, user: string): Promise<UserCashDepositRow[]> {
    const res = await apiFetch(`${API_BASE}/reports/user-cash-deposits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&user=${encodeURIComponent(user)}`);
    return jsonResponse(res, 'Failed to load user cash deposits.');
}

// A payment (or a refund or dispute against one) or a client note, with who entered it and when
export interface UserActivityRow {
    kind: 'Payment' | 'Note';
    id: number;
    client: number | null;
    firstname: string | null;
    lastname: string | null;
    docnumber: string | null;
    doctype?: string | null;
    enteredon: string;
    // Employee email; null for payments entered before who entered them was recorded
    enteredby: string | null;
    enteredbyname: string | null;
    // The ledger type (Payment, Refund, Dispute, Dispute Won) or the note category
    detail: string;
    amount: string | number | null;
    paymentmethod: string | null;
    // Other payments (utils/paymentMethods.ts): the kind and reference #
    paymentsubtype?: string | null;
    paymentreference?: string | null;
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

// --- Monthly supervising agent (PO) reports. Business Administrators and Office Admins only. ---
export interface PoReportClient {
    clientid: number;
    firstname: string;
    lastname: string;
    docnumber: string | null;
    doctype?: string | null;
    programtype: string | null;
    // Counts for the report month; attended and calledin are null for programs that don't attend groups (Poly Only)
    attended: number | null;
    calledin: number | null;
    notecount: number;
}

export interface PoReportAgent {
    name: string;
    email: string | null;
    // False when no Supervising Agents directory entry matches the name on the clients
    inDirectory: boolean;
    // The last Outlook draft made for this agent and month (making a draft doesn't mean it was sent)
    lastDraft: { createdOn: string; createdBy: string | null; clientCount: number } | null;
    clients: PoReportClient[];
}

export interface PoReportMonth {
    month: string;
    // The last month of the range (the same as month for one month)
    toMonth?: string;
    agents: PoReportAgent[];
    // Active clients with no supervising agent, so they get no report
    noAgent: { clientid: number; firstname: string; lastname: string; docnumber: string | null; doctype?: string | null }[];
}

// month is YYYY-MM, the first month; toMonth the last month of a range (left out or the same: one month)
const toMonthParam = (toMonth?: string) => (toMonth ? `&toMonth=${encodeURIComponent(toMonth)}` : '');
export async function getPoReportMonth(month: string, toMonth?: string): Promise<PoReportMonth> {
    const res = await apiFetch(`${API_BASE}/reports/po-monthly?month=${encodeURIComponent(month)}${toMonthParam(toMonth)}`);
    return jsonResponse(res, 'Failed to load the monthly PO reports.');
}

// Throws the server's error message for a failed file request
async function fileResponse(res: Response, fallback: string, type: string): Promise<Blob> {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || fallback);
    }
    return new Blob([await res.arrayBuffer()], { type });
}

// One client's monthly report PDF
export async function fetchPoClientReport(clientId: number, month: string, toMonth?: string): Promise<Blob> {
    const res = await apiFetch(`${API_BASE}/reports/po-monthly/client/${clientId}/pdf?month=${encodeURIComponent(month)}${toMonthParam(toMonth)}`);
    return fileResponse(res, 'Could not make the client report.', 'application/pdf');
}

// An unsent Outlook draft (.eml) to the agent with each active client's PDF attached, and its file name. Nothing is sent.
export async function createPoReportDraft(month: string, agent: string, user: string, toMonth?: string): Promise<{ blob: Blob; fileName: string }> {
    const res = await apiFetch(`${API_BASE}/reports/po-monthly/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, toMonth, agent, user }),
    });
    const blob = await fileResponse(res, 'Could not make the Outlook draft.', 'message/rfc822');
    const fileName = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'PO Reports.eml';
    return { blob, fileName };
}

export async function getEmployees(): Promise<Employee[]> {
    const res = await apiFetch(`${API_BASE}/admin/employees`);
    return jsonResponse(res, 'Failed to load employees.');
}

// expected: the account as the form loaded it; throws EditConflictError when it was changed on another screen since
export async function updateEmployee(email: string, data: { displayName: string; role: string; active: boolean; updatedBy: string; password?: string; credentials?: string; expected?: Record<string, unknown> }) {
    const res = await apiFetch(`${API_BASE}/admin/employees/${encodeURIComponent(email)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();
    if (res.status === 409 && body.conflict) throw new EditConflictError(body.error || 'This account was changed on another screen.', null);
    if (!res.ok) {
        throw new Error(body.error || 'Failed to update account.');
    }
    return body as { success: true };
}

export async function addEmployee(data: { employeeEmail: string; displayName: string; role: string; location: string; active: boolean; password: string; credentials?: string }) {
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

// The DEV menu's server and database information; DEV accounts only, the server checks
export interface DevInfo {
    server: { node: string; platform: string; hostname: string; uptimeSeconds: number; startedAt: string; memoryMb: number; environment: string };
    database: { name: string; version: string; size: string; now: string; migrationCount: number; recentMigrations: { name: string; appliedon: string }[]; pendingMigrations?: string[] };
    activeSessions: number;
    activeAccountsByRole: { role: string; n: number }[];
}

export async function getDevInfo(): Promise<DevInfo> {
    const res = await apiFetch(`${API_BASE}/dev/info`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.server) {
        throw new Error(body?.error || 'Failed to load the DEV information.');
    }
    return body;
}

// DEV Database Sync: the app database and the dev copy (stop_dev) on the same PostgreSQL server
export interface DevDatabase {
    name: string;
    exists: boolean;
    size?: string;
    tables?: number;
    views?: number;
    rows?: number;
    migrations?: { count: number; latest: string | null };
}

export interface DevSession {
    sessionHash: string;
    email: string;
    displayName: string | null;
    role: string | null;
    createdOn: string;
    expiresOn: string;
    lastActiveOn: string;
    // The approved device the login came from; null for logins from before devices were tracked
    deviceName: string | null;
    deviceUserAgent: string | null;
    current: boolean;
}

// Logins that have not expired, newest first (DEV only; the server checks)
export async function getDevSessions(): Promise<DevSession[]> {
    const res = await apiFetch(`${API_BASE}/dev/sessions`);
    return jsonResponse(res, 'Failed to load the active sessions.');
}

// Signs one session out; the server refuses the DEV account's own session
export async function endDevSession(sessionHash: string): Promise<{ success: true; email: string }> {
    const res = await apiFetch(`${API_BASE}/dev/sessions/${encodeURIComponent(sessionHash)}`, { method: 'DELETE' });
    return jsonResponse(res, 'Failed to end the session.');
}

export interface DevSyncStatus { app: DevDatabase; dev: DevDatabase; pgBin: string }

export interface DevSyncResult {
    direction: 'pull' | 'push';
    from: string;
    to: string;
    backupFile: string | null;
    seconds: number;
    status: DevSyncStatus;
}

export async function getDevSyncStatus(): Promise<DevSyncStatus> {
    const res = await apiFetch(`${API_BASE}/dev/sync`);
    return jsonResponse(res, 'Failed to load the database sync status.');
}

// pull: the app database is copied over the dev copy. push: the dev copy replaces the app database (backed up first);
// confirm must be the app database's name, the server checks.
export async function runDevSync(direction: 'pull' | 'push', confirm?: string): Promise<DevSyncResult> {
    const res = await apiFetch(`${API_BASE}/dev/sync/${direction}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
    });
    return jsonResponse(res, `The database ${direction} failed.`);
}

export interface SupervisingAgent {
    agentid: number;
    name: string;
    phone: string | null;
    email: string | null;
    // Kind of agent (Probation, Parole, DHS, ...) and where they work; free text, blank when unknown
    agenttype: string | null;
    location: string | null;
}

export async function getSupervisingAgents(): Promise<SupervisingAgent[]> {
    const res = await apiFetch(`${API_BASE}/agents`);
    return jsonResponse(res, 'Failed to load supervising agents.');
}

// Business Administrators and Office Admins only; the server checks the role. Renaming an agent moves their clients
// to the new name; clientsRenamed counts them (always 0 for a new agent).
// expected (edits): the agent as the form loaded it; throws EditConflictError when it was changed on another screen since
export async function saveSupervisingAgent(agentId: number | null, data: { name: string; phone: string; email: string; agentType: string; location: string; user: string; expected?: Record<string, unknown> }): Promise<{ agent: SupervisingAgent; clientsRenamed: number }> {
    const res = await apiFetch(agentId ? `${API_BASE}/agents/${agentId}` : `${API_BASE}/agents`, {
        method: agentId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (agentId) return savedResponse(res, 'Failed to save the supervising agent.');
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

// Group meetings cancelled while the client was in the group, newest first (shown on the Attendance tab; not attendance)
export interface GroupCancellation {
    changeid: number;
    date: string; // YYYY-MM-DD
    groupname: string;
    groupschedule: string | null;
    reason: string | null;
    createdby: string | null;
}
export async function getClientGroupCancellations(clientId: number): Promise<GroupCancellation[]> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/group-cancellations`);
    return jsonResponse(res, 'Failed to load cancelled groups.');
}

// Group meetings the client was expected at and didn't check in to, newest first (backend/lib/missedGroups.js). A Phase
// 2/3/4 client's miss is a month / quarter / half year with no group check-in (everymonths), dated its last day.
export interface MissedGroup {
    groupid: number;
    date: string; // YYYY-MM-DD
    groupname: string;
    groupschedule: string | null;
    calledin: boolean;
    callinreason: string | null;
    everymonths: number | null;
}
export async function getClientMissedGroups(clientId: number): Promise<MissedGroup[]> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/missed-groups`);
    return jsonResponse(res, 'Failed to load missed groups.');
}

// The client's group schedule, booked assessments and polygraphs, and polygraphs taken, for the Attendance calendar
// (utils/clientCalendar.ts)
export async function getClientCalendar(clientId: number): Promise<ClientCalendarData> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/calendar`);
    return jsonResponse(res, 'Failed to load the client\'s schedule.');
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
// original: the note's text when editing began. Throws EditConflictError (with the note as it is now) when the note
// was edited by someone else meanwhile.
export async function updateClientNote(noteId: number, data: { user: string; comments: string; original?: string }): Promise<ClientNote> {
    const res = await apiFetch(`${API_BASE}/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (res.status === 409) {
        const body = await readJson(res) as { error?: string; note?: ClientNote } | null;
        if (body?.note) throw new EditConflictError(body.error || 'This note was edited on another screen.', body.note);
        throw new Error(body?.error || 'Failed to save the note.');
    }
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

// original: the note's text as shown; throws EditConflictError (with the note as it is now) when it was edited since
export async function deleteClientNote(noteId: number, user: string, original?: string): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/notes/${noteId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, original }),
    });
    return savedResponse(res, 'Failed to delete the note.');
}

export interface ClientDischarge {
    dischargeid: number;
    // Local wall-clock text, 'YYYY-MM-DDTHH:MM:SS'
    dischargedon: string;
    dischargetype: string;
    // Joined by ', ' when there is more than one
    subcategory: string | null;
    note: string | null;
    dischargedby: string | null;
}

// Every discharge on record, newest first (kept after reactivation). Not for Polygraphers; the server refuses them.
export async function getClientDischarges(clientId: number): Promise<ClientDischarge[]> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/discharges`);
    return jsonResponse(res, 'Failed to load the discharge history.');
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
        // Federal clients: their polygraph copay and Max Debt Override, when the copay would go past it
        polyCopay?: number; maxOwed?: number;
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

export type PolyRescheduleReply =
    | { success: true; message: string; code?: undefined; error?: undefined }
    // Moved earlier, inside the waiting period after a No Deception Indicated result; a Business Administrator can bypass it
    | { success?: false; code: 'POLY_TOO_SOON'; error: string; lastPolyDate: string; earliestDate: string }
    | { success?: false; code?: undefined; error: string };

// date is YYYY-MM-DD and time HH:MM, in the future. reason is required when a client is booked on the slot.
// Refusals come back as the reply instead of being thrown, so the caller can offer the bypass.
export async function reschedulePolygraphSlot(slotId: number, data: { date: string; time: string; polygrapher: string; location: string; address: string; reason: string; notes: string; bypassWaitPeriod: boolean; user: string }): Promise<PolyRescheduleReply> {
    const res = await apiFetch(`${API_BASE}/polygraphs/slots/${slotId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await readJson(res) as PolyRescheduleReply;
    if (!res.ok && !body?.error) return { error: 'Failed to reschedule the slot.' };
    return body;
}

export async function deletePolygraphSlot(slotId: number): Promise<{ success: true; message: string }> {
    const res = await apiFetch(`${API_BASE}/polygraphs/slots/${slotId}`, {
        method: 'DELETE',
    });
    return jsonResponse(res, 'Failed to delete slot.');
}

// Max Debt Override: through expirationdate (YYYY-MM-DD) the client may owe up to maxowed and still attend
export interface DebtLimit {
    debtlimitid: number;
    maxowed: string | number;
    expirationdate: string;
    expirestext: string;
    createdby: string | null;
    createdon: string;
}

export async function fetchClientDebtLimit(clientId: number): Promise<{ limit: DebtLimit | null }> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/debt-limit`);
    return jsonResponse(res, 'Failed to load the max debt override.');
}

// Business Administrators only; the server checks the role
export async function saveClientDebtLimit(clientId: number, maxOwed: number, expirationDate: string): Promise<{ limit: DebtLimit }> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/debt-limit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxOwed, expirationDate }),
    });
    return jsonResponse(res, 'Failed to save the max debt override.');
}

export async function deleteClientDebtLimit(clientId: number): Promise<{ success: true }> {
    const res = await apiFetch(`${API_BASE}/clients/${clientId}/debt-limit`, { method: 'DELETE' });
    return jsonResponse(res, 'Failed to remove the max debt override.');
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
// The Assessments calendar. A counselor opens a time (status Open, no client); a client is assigned to it (Scheduled).
// Dates are YYYY-MM-DD and times HH:MM. The identity fields sent blank (createdBy, ...) are filled in by the server.
export interface AssessmentAppointment {
    appointmentid: number;
    clientid: number | null;
    firstname: string | null;
    lastname: string | null;
    programtype: string | null;
    docnumber: string | null;
    doctype: string | null;
    assessor: string;
    apptdate: string;
    appttime: string;
    // Blank on times opened before locations were added
    location: string | null;
    notes: string | null;
    status: 'Open' | 'Scheduled' | 'Cancelled';
    createdby: string | null;
}

const sendJson = (url: string, data: unknown, method = 'POST') => apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
});

export async function getAssessmentAppointments(from: string, to: string): Promise<AssessmentAppointment[]> {
    const res = await apiFetch(`${API_BASE}/assessment-appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return jsonResponse(res, 'Failed to load assessments.');
}

// How a new time repeats (until is the last date, YYYY-MM-DD). Mirrors REPEATS in backend/lib/assessmentAppointments.js.
export type AssessmentRepeat = 'none' | 'weekdays' | 'weekly' | 'biweekly';
// created: how many times were made; skipped: dates left out because the counselor already had that time
export interface AssessmentCreateResult { success: true; created: number; skipped: string[] }

// Open availability: a time with no client yet, on each repeat date
export async function openAssessmentSlot(data: { assessor: string; date: string; time: string; location: string; notes: string; repeat: AssessmentRepeat; until: string }): Promise<AssessmentCreateResult> {
    const res = await sendJson(`${API_BASE}/assessment-appointments/slots`, { ...data, createdBy: '' });
    return jsonResponse(res, 'Failed to open the time.');
}

export async function createAssessmentAppointment(data: { clientId: number; assessor: string; date: string; time: string; location: string; notes: string; repeat: AssessmentRepeat; until: string }): Promise<AssessmentCreateResult> {
    const res = await sendJson(`${API_BASE}/assessment-appointments`, { ...data, createdBy: '' });
    return jsonResponse(res, 'Failed to schedule the assessment.');
}

// Cancels every open (unassigned) time the counselor has from today on; times with a client stay
export async function cancelOpenAssessmentTimes(assessor: string): Promise<{ success: true; cancelled: number }> {
    const res = await sendJson(`${API_BASE}/assessment-appointments/cancel-open`, { assessor, cancelledBy: '' });
    return jsonResponse(res, 'Failed to cancel the open times.');
}

export async function assignAssessmentSlot(id: number, data: { clientId: number; notes: string }): Promise<{ success: true }> {
    const res = await sendJson(`${API_BASE}/assessment-appointments/${id}/assign`, { ...data, assignedBy: '' });
    return jsonResponse(res, 'Failed to assign the client.');
}

// The reason goes in an Assessment case note on the client's account
export async function unassignAssessmentSlot(id: number, reason: string): Promise<{ success: true }> {
    const res = await sendJson(`${API_BASE}/assessment-appointments/${id}/unassign`, { removedBy: '', reason });
    return jsonResponse(res, 'Failed to take the client off this time.');
}

export async function updateAssessmentAppointment(id: number, data: { assessor: string; date: string; time: string; location: string; notes: string }): Promise<{ success: true }> {
    const res = await sendJson(`${API_BASE}/assessment-appointments/${id}`, { ...data, updatedBy: '' }, 'PUT');
    return jsonResponse(res, 'Failed to reschedule the assessment.');
}

// Reschedule a client's assessment into one of the same counselor's open times (toId); the old time opens up again
export async function moveAssessmentAppointment(id: number, toId: number): Promise<{ success: true; appointmentId: number }> {
    const res = await sendJson(`${API_BASE}/assessment-appointments/${id}/move`, { toId, updatedBy: '' });
    return jsonResponse(res, 'Failed to reschedule the assessment.');
}

export async function cancelAssessmentAppointment(id: number): Promise<{ success: true }> {
    const res = await sendJson(`${API_BASE}/assessment-appointments/${id}/cancel`, { cancelledBy: '' });
    return jsonResponse(res, 'Failed to cancel the assessment.');
}

// --- MONEY ON HAND (backend routes/moneyOnHand.js) ---
// A check, money order or cashier's check in an item of money
export interface MoneyCheck {
    kind: string | null;
    reference: string | null;
    amount: number | string;
    client: string | null;
}

// One client's payment in a group session's money: method is Cash or Other (kind / reference say which check)
export interface MoneyPayer {
    client: string;
    method: string | null;
    kind: string | null;
    reference: string | null;
    amount: number | string;
}

// Money not at the bank yet: a closed group session's cash and checks, or one cash / check payment taken outside a group.
// itemkey is 'g:<group>:<date>:<session>' or 'p:<transaction>'. holder is who has it now; collector who was first
// responsible for it. pendinghandoffid is set while a hand-off of it waits to be accepted.
export interface MoneyItem {
    itemkey: string;
    kind: 'group' | 'payment';
    groupid: number | null;
    sessionnumber: number | null;
    transactionid: number | null;
    clientid: number | null;
    // The group's name, or the payment's fee type
    label: string;
    clientname: string | null;
    // The session date, or the date the payment was taken
    eventdate: string;
    collectedon: string | null;
    amount: number | string;
    collector: string;
    collectorname: string;
    // A payment's method (Cash or Other)
    method: string | null;
    checks: MoneyCheck[];
    // A group session's clients who paid (cash and checks); empty for a payment
    payers?: MoneyPayer[];
    holder: string;
    holdername: string;
    heldsince: string | null;
    pendinghandoffid: number | null;
    pendingto: string | null;
}

// Money taken at a group that hasn't closed yet, with who will be responsible for it
export interface OpenGroupMoney {
    groupid: number;
    groupname: string;
    sessiondate: string;
    sessionnumber: number;
    responsible: string;
    responsiblename: string | null;
    updatedon: string | null;
    amount: number;
    checks: MoneyCheck[];
}

export interface MoneyHandoff {
    handoffid: number;
    fromemployee: string;
    toemployee: string;
    fromname: string;
    toname: string;
    total: number | string;
    notes: string | null;
    createdby: string;
    createdbyname: string;
    createdon: string;
    status: 'Pending' | 'Accepted' | 'Declined' | 'Cancelled';
    resolvedby: string | null;
    resolvedon: string | null;
    items: { key: string; amount: number | string; label: string }[];
}

export interface BankDeposit {
    bankdepositid: number;
    depositdate: string;
    slipnumber: string | null;
    total: number | string;
    droppedoffby: string;
    droppedoffbyname: string;
    recordedon: string;
    // Entered by a Business Administrator once the bank's statement shows the deposit
    bankamount: number | string | null;
    verifiedby: string | null;
    verifiedbyname: string | null;
    verifiedon: string | null;
    verifynotes: string | null;
    voidedby: string | null;
    voidedbyname: string | null;
    voidedon: string | null;
    voidreason: string | null;
    items: { key: string; amount: number | string; label: string; collector: string | null; collectorName: string | null }[];
}

export interface MoneyOnHandData {
    isAdmin: boolean;
    items: MoneyItem[];
    open: OpenGroupMoney[];
    handoffs: MoneyHandoff[];
    deposits: BankDeposit[];
    // Who money can be handed to (active employees, not Polygraphers, not you)
    recipients: { employeeemail: string; displayname: string | null; role: string | null }[];
}

export interface MoneyHistory {
    key: string;
    label: string;
    amount: number | string;
    holder: { email: string; name: string; since: string | null } | null;
    events: { at: string | null; kind: string; text: string }[];
}

// The money picked for a hand-off or deposit, with each amount as shown (the server refuses if one changed since)
export type PickedMoney = { key: string; amount: number }[];

export async function getMoneyOnHand(): Promise<MoneyOnHandData> {
    return jsonResponse(await apiFetch(`${API_BASE}/money-on-hand`), 'Failed to load the money on hand.');
}

export async function getMoneyHistory(key: string): Promise<MoneyHistory> {
    return jsonResponse(await apiFetch(`${API_BASE}/money-on-hand/history/${encodeURIComponent(key)}`), 'Failed to load where this money has been.');
}

export async function handOffMoney(data: { to: string; notes: string; items: PickedMoney }): Promise<{ handoffId: number; total: number }> {
    return jsonResponse(await sendJson(`${API_BASE}/money-on-hand/handoffs`, data), 'Failed to hand off the money.');
}

export async function resolveHandoff(id: number, action: 'accept' | 'decline' | 'cancel'): Promise<{ handoffId: number; status: string }> {
    return jsonResponse(await sendJson(`${API_BASE}/money-on-hand/handoffs/${id}/${action}`, {}), 'Failed to update the hand-off.');
}

export async function makeBankDeposit(data: { depositDate: string; slipNumber: string; items: PickedMoney }): Promise<{ bankDepositId: number; total: number }> {
    return jsonResponse(await sendJson(`${API_BASE}/money-on-hand/deposits`, data), 'Failed to record the deposit.');
}

export async function setDepositSlip(id: number, slipNumber: string): Promise<{ bankDepositId: number; slipNumber: string | null }> {
    return jsonResponse(await sendJson(`${API_BASE}/money-on-hand/deposits/${id}/slip`, { slipNumber }, 'PUT'), 'Failed to save the slip number.');
}

// Business Administrators: the amount the bank credited, or clear to undo the check
export async function checkDepositAgainstBank(id: number, data: { bankAmount: number; notes: string } | { clear: true }): Promise<{ bankDepositId: number }> {
    return jsonResponse(await sendJson(`${API_BASE}/money-on-hand/deposits/${id}/verify`, data, 'PUT'), 'Failed to save the bank check.');
}

export async function voidBankDeposit(id: number, reason: string): Promise<{ bankDepositId: number }> {
    return jsonResponse(await sendJson(`${API_BASE}/money-on-hand/deposits/${id}/void`, { reason }), 'Failed to void the deposit.');
}
