import type { SessionEntry } from './hooks/useGroupCheckIn';

const API_BASE = 'https://192.168.1.133:5000/api';

export async function loginUser(email: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    return res.json();
}

export async function getClients() {
    const res = await fetch(`${API_BASE}/clients`);
    return res.json();
}

export async function getGroups() {
    const res = await fetch(`${API_BASE}/groups`);
    return res.json();
}

export async function getGroupClients(groupId: number) {
    const res = await fetch(`${API_BASE}/groups/${groupId}/clients`);
    return res.json();
}

// A session of a group on a date: session 1 is the day's first, a later number means the group met again.
// closed: attendance was saved; otherwise it is an open sheet (Finish Check-In) and clients is empty.
export interface GroupDaySession {
    sessionNumber: number;
    closed: boolean;
    clients: number[];
}

// Sessions of the group on the date (YYYY-MM-DD), oldest first
export async function getGroupSessions(groupId: number, date: string): Promise<GroupDaySession[]> {
    const res = await fetch(`${API_BASE}/groups/${groupId}/sessions?date=${encodeURIComponent(date)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body)) {
        throw new Error(body?.error || (res.status === 404
            ? 'The server needs a restart (node server.js) before group sessions can be checked.'
            : 'Could not check who already attended this group today.'));
    }
    return body.map(s => ({ sessionNumber: Number(s.sessionNumber), closed: s.closed !== false, clients: (s.clients || []).map(Number) }));
}

// Business Administrators only; the server checks the role
export async function setClientNoPolyRequired(clientId: number, noPolyRequired: boolean, user: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/clients/${clientId}/no-poly-required`, {
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
    const res = await fetch(`${API_BASE}/clients/${clientId}/${action}`, {
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
    const res = await fetch(`${API_BASE}/clients/${clientId}/change-log?user=${encodeURIComponent(user)}`);
    const body = await res.json();
    if (!res.ok || !Array.isArray(body)) {
        throw new Error(body?.error || 'Failed to load the change log.');
    }
    return body;
}

export async function updateClient(clientId: number, data: any) {
    const res = await fetch(`${API_BASE}/clients/${clientId}`, {
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

export async function createClient(data: Record<string, any>) {
    const res = await fetch(`${API_BASE}/clients`, {
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
    const res = await fetch(`${API_BASE}/clients/${clientId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-User-Email': userEmail },
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to delete client.');
    }
    return body as { success: true; message: string };
}

export async function updateGroup(groupId: number, data: any) {
    const res = await fetch(`${API_BASE}/groups/${groupId}`, {
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
    const res = await fetch(`${API_BASE}/groups`, {
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
    const res = await fetch(`${API_BASE}/groups/${groupId}`, {
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

export async function assignClientToGroup(groupId: number, clientId: number, assignedBy: string) {
    const res = await fetch(`${API_BASE}/groups/${groupId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, assignedBy }),
    });
    return res.json();
}

export async function submitAttendance(data: any) {
    const res = await fetch(`${API_BASE}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
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
    entries: BatchAttendanceEntry[];
}

export async function submitBatchAttendance(data: BatchAttendancePayload) {
    const res = await fetch(`${API_BASE}/attendance/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to save attendance.');
    }
    // polyVouchersAwarded: SO clients charged the group fee whose last polygraph was NDI earn one poly fee voucher
    return body as {
        success: true; count: number; polyVouchersAwarded: number;
        results: { client: number; attendanceId: number; newBalance: number; polyVoucherAwarded: boolean }[];
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
    updatedon: string;
}

// Only the open check-ins this user may see: administrators see all; counselors see their groups' and the ones they opened
export async function getOpenGroups(user: string): Promise<OpenGroupSession[]> {
    const res = await fetch(`${API_BASE}/open-groups?user=${encodeURIComponent(user)}`);
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
    const res = await fetch(`${API_BASE}/closed-groups?user=${encodeURIComponent(user)}`);
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to load closed groups.');
    }
    return body;
}

export async function saveOpenGroup(data: { group: number; date: string; sessionNumber: number; entries: SessionEntry[]; createdBy: string }): Promise<OpenGroupSession> {
    const res = await fetch(`${API_BASE}/open-groups`, {
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

export async function deleteOpenGroup(openSessionId: number, removedBy: string) {
    const res = await fetch(`${API_BASE}/open-groups/${openSessionId}`, {
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

// applyToPolyFee: pay down the client's unpaid poly fee first; any excess goes to the account balance
export async function submitAccountPayment(data: { client: number; amount: number; comments: string; createdBy: string; paymentMethod: 'Cash' | 'Credit Card'; applyToPolyFee?: boolean }) {
    const res = await fetch(`${API_BASE}/financials/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function submitCustomCharge(data: { client: number; amount: number; comments: string; createdBy: string }) {
    const res = await fetch(`${API_BASE}/financials/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

// What a payment correction changed. The poly fields come back only for poly fee payments.
export interface PaymentChangeResult {
    newBalance: number;
    attendanceUpdated: boolean;
    polyFeePaid?: number;
    polyFeeVoucher?: number;
    vouchersRemoved?: number;
    vouchersAdded?: number;
    // Polygraph the client is already booked into with poly fee vouchers; the change doesn't cancel it
    scheduledPolygraph?: { slotId: number; date: string; time: string | null; location: string | null } | null;
}

// Corrects a cash payment's amount; the server carries the difference through the balance (or poly fee paid and vouchers),
// later ledger and attendance rows, and the check-in it was taken at
export async function adjustCashPayment(transactionId: number, data: { amount: number; reason: string; user: string }): Promise<PaymentChangeResult> {
    const res = await fetch(`${API_BASE}/financials/${transactionId}/adjust`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return agentResponse(res, 'Failed to adjust the payment.');
}

export type CardPaymentAction = 'refund' | 'dispute' | 'dispute-won' | 'dispute-lost';

// Refund (full or partial), dispute, or dispute outcome on a credit card payment
export async function recordCardPaymentAction(transactionId: number, data: { action: CardPaymentAction; amount?: number; reason: string; user: string }): Promise<PaymentChangeResult> {
    const res = await fetch(`${API_BASE}/financials/${transactionId}/card-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return agentResponse(res, 'Failed to record the credit card change.');
}

export async function submitClientCallIn(data: any) {
    const res = await fetch(`${API_BASE}/callin/client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function submitGroupCallIn(data: any) {
    const res = await fetch(`${API_BASE}/callin/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function getPolygraphSlots() {
    const res = await fetch(`${API_BASE}/polygraphs/slots`);
    return res.json();
}

export async function createPolygraphSlot(data: any) {
    const res = await fetch(`${API_BASE}/polygraphs/slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function submitPolygraphResult(data: any) {
    const res = await fetch(`${API_BASE}/polygraphs/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function getClientTests(clientId: number) {
    const res = await fetch(`${API_BASE}/testing/${clientId}`);
    return res.json();
}

export async function submitTestResult(data: any) {
    const res = await fetch(`${API_BASE}/testing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function getAgentReport() {
    const res = await fetch(`${API_BASE}/reports/agent`);
    return res.json();
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
    const res = await fetch(`${API_BASE}/reports/groups?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const text = await res.text();
    let body: any;
    try {
        body = JSON.parse(text);
    } catch {
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}). Restart the backend (node server.js) and try again.`);
    }
    if (!res.ok) throw new Error(body.error || 'Failed to load the group report.');
    return body;
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
    const res = await fetch(`${API_BASE}/reports/group-deposits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    return agentResponse(res, 'Failed to load group deposits.');
}

export async function saveGroupDeposit(data: GroupSessionRef & { amountDeposited: number; depositDate: string; notes: string; user: string }): Promise<GroupDeposit> {
    const res = await fetch(`${API_BASE}/reports/group-deposits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return agentResponse(res, 'Failed to save the deposit.');
}

export async function deleteGroupDeposit(data: GroupSessionRef & { user: string }) {
    const res = await fetch(`${API_BASE}/reports/group-deposits`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return agentResponse(res, 'Failed to remove the deposit.');
}

export async function getDepositReport() {
    const res = await fetch(`${API_BASE}/reports/deposit`);
    return res.json();
}

export async function getEmployees() {
    const res = await fetch(`${API_BASE}/admin/employees`);
    return res.json();
}

export async function updateEmployee(email: string, data: { displayName: string; role: string; active: boolean; updatedBy: string; password?: string }) {
    const res = await fetch(`${API_BASE}/admin/employees/${encodeURIComponent(email)}`, {
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

export async function addEmployee(data: any) {
    const res = await fetch(`${API_BASE}/admin/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

export async function getSystemLogs() {
    const res = await fetch(`${API_BASE}/admin/logs`);
    return res.json();
}

export interface SupervisingAgent {
    agentid: number;
    name: string;
    phone: string | null;
    email: string | null;
}

// Reads the JSON body and throws the server's error message on failure.
// An HTML body means the route is missing, which usually means the backend needs a restart.
async function agentResponse(res: Response, fallback: string) {
    const text = await res.text();
    let body: any;
    try {
        body = JSON.parse(text);
    } catch {
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}). Restart the backend (node server.js) and try again.`);
    }
    if (!res.ok) throw new Error(body.error || fallback);
    return body;
}

export async function getSupervisingAgents(): Promise<SupervisingAgent[]> {
    const res = await fetch(`${API_BASE}/agents`);
    return agentResponse(res, 'Failed to load supervising agents.');
}

// Business Administrators and Office Admins only; the server checks the role
export async function saveSupervisingAgent(agentId: number | null, data: { name: string; phone: string; email: string; user: string }) {
    const res = await fetch(agentId ? `${API_BASE}/agents/${agentId}` : `${API_BASE}/agents`, {
        method: agentId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return agentResponse(res, 'Failed to save the supervising agent.');
}

// Business Administrators only; the server checks the role
export async function deleteSupervisingAgent(agentId: number, user: string) {
    const res = await fetch(`${API_BASE}/agents/${agentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user }),
    });
    return agentResponse(res, 'Failed to delete the supervising agent.');
}

export async function getClientAttendance(clientId: number) {
    const res = await fetch(`${API_BASE}/clients/${clientId}/attendance`);
    return res.json();
}

export async function getClientFinancials(clientId: number) {
    const res = await fetch(`${API_BASE}/clients/${clientId}/financials`);
    return res.json();
}

export async function getClientNotes(clientId: number) {
    const res = await fetch(`${API_BASE}/clients/${clientId}/notes`);
    return res.json();
}

export async function addClientNote(clientId: number, data: { user: string; comments: string; category: string }) {
    const res = await fetch(`${API_BASE}/clients/${clientId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return res.json();
}

// The note's author or a Business Administrator only; the server checks
export async function updateClientNote(noteId: number, data: { user: string; comments: string }) {
    const res = await fetch(`${API_BASE}/notes/${noteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return agentResponse(res, 'Failed to save the note.');
}

export async function deleteClientNote(noteId: number, user: string) {
    const res = await fetch(`${API_BASE}/notes/${noteId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user }),
    });
    return agentResponse(res, 'Failed to delete the note.');
}

export async function getClientPolygraphs(clientId: number) {
    const res = await fetch(`${API_BASE}/clients/${clientId}/polygraphs`);
    return res.json();
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
    const res = await fetch(`${API_BASE}/clients/${clientId}/attachments`);
    const body = await res.json();
    if (!res.ok || !Array.isArray(body)) {
        throw new Error(body?.error || 'Could not load attachments.');
    }
    return body;
}

// Sent as raw bytes; the name and real type travel in headers
export async function uploadClientAttachment(clientId: number, file: File, user: string): Promise<ClientAttachment> {
    const res = await fetch(`${API_BASE}/clients/${clientId}/attachments`, {
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
    const res = await fetch(`${API_BASE}/attachments/${attachment.attachmentid}`);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not open the attachment.');
    }
    return new Blob([await res.arrayBuffer()], { type: attachment.contenttype });
}

// The server keeps the original extension if the new name drops it; returns the saved attachment
export async function renameClientAttachment(attachmentId: number, fileName: string, user: string): Promise<ClientAttachment> {
    const res = await fetch(`${API_BASE}/attachments/${attachmentId}`, {
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
    const res = await fetch(`${API_BASE}/attachments/${attachmentId}`, {
        method: 'DELETE',
        headers: { 'X-User': user },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to delete the attachment.');
    }
}

// bypassWaitPeriod: a Business Administrator's confirmed choice to schedule inside the post-NDI waiting period
export async function assignPolygraphSlot(slotId: number, clientId: number, type: string, user: string, comments: string, bypassWaitPeriod = false) {
    const res = await fetch(`${API_BASE}/polygraphs/slots/${slotId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, type, user, comments, bypassWaitPeriod }),
    });
    return res.json();
}

export async function reopenPolygraphSlot(slotId: number, cancellation: { reason: string; notes: string; returnVouchers: boolean; overrideVoucherRule: boolean; user: string }) {
    const res = await fetch(`${API_BASE}/polygraphs/slots/${slotId}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cancellation),
    });
    return res.json();
}

export async function deletePolygraphSlot(slotId: number) {
    const res = await fetch(`${API_BASE}/polygraphs/slots/${slotId}`, {
        method: 'DELETE',
    });
    return res.json();
}

// Reads the JSON body and throws the server's error message on failure.
// An HTML body means the route is missing, which usually means the backend needs a restart.
async function feeOverrideResponse(res: Response) {
    const text = await res.text();
    let body: any;
    try {
        body = JSON.parse(text);
    } catch {
        throw new Error(`The server returned an unexpected response (HTTP ${res.status}). Restart the backend (node server.js) and try again.`);
    }
    if (!res.ok) throw new Error(body.error || 'Fee override request failed.');
    return body;
}

export async function fetchClientFeeOverride(clientId: number) {
    const res = await fetch(`${API_BASE}/clients/${clientId}/fee-override`);
    return feeOverrideResponse(res) as Promise<{ override: any | null }>;
}

export async function saveClientFeeOverride(clientId: number, reducedFee: number, expirationDate: string, createdBy: string) {
    const res = await fetch(`${API_BASE}/clients/${clientId}/fee-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reducedFee, expirationDate, createdBy }),
    });
    return feeOverrideResponse(res) as Promise<{ override: any }>;
}

export async function deleteClientFeeOverride(clientId: number, removedBy: string) {
    const res = await fetch(`${API_BASE}/clients/${clientId}/fee-override`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removedBy }),
    });
    return feeOverrideResponse(res);
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
    const res = await fetch(`${API_BASE}/clients/${clientId}/poly-fee-override`);
    return agentResponse(res, 'Failed to load the poly fee override.') as Promise<{ override: PolyFeeOverride | null }>;
}

export async function savePolyFeeOverride(clientId: number, data: { reducedFee: number; fills: number; user: string }): Promise<PolyFeeOverrideResult> {
    const res = await fetch(`${API_BASE}/clients/${clientId}/poly-fee-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return agentResponse(res, 'Failed to save the poly fee override.');
}

export async function deletePolyFeeOverride(clientId: number, user: string): Promise<PolyFeeOverrideResult> {
    const res = await fetch(`${API_BASE}/clients/${clientId}/poly-fee-override`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user }),
    });
    return agentResponse(res, 'Failed to remove the poly fee override.');
}