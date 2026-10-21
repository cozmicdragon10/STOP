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

// Ids of clients who already attended the group on the date (YYYY-MM-DD)
export async function getGroupAttendedClients(groupId: number, date: string): Promise<number[]> {
    const res = await fetch(`${API_BASE}/groups/${groupId}/attended?date=${encodeURIComponent(date)}`);
    const body = await res.json();
    if (!res.ok || !Array.isArray(body)) {
        throw new Error(body?.error || 'Could not check who already attended this group today.');
    }
    return body.map(Number);
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

export async function deleteClient(clientId: number) {
    const res = await fetch(`${API_BASE}/clients/${clientId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
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

export async function assignClientToGroup(groupId: number, clientId: number) {
    const res = await fetch(`${API_BASE}/groups/${groupId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
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
    entries: SessionEntry[];
    createdby: string | null;
    updatedon: string;
}

export async function getOpenGroups(): Promise<OpenGroupSession[]> {
    const res = await fetch(`${API_BASE}/open-groups`);
    const body = await res.json();
    if (!res.ok) {
        throw new Error(body.error || 'Failed to load open groups.');
    }
    return body;
}

export async function saveOpenGroup(data: { group: number; date: string; entries: SessionEntry[]; createdBy: string }): Promise<OpenGroupSession> {
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

export async function getClientPolygraphs(clientId: number) {
    const res = await fetch(`${API_BASE}/clients/${clientId}/polygraphs`);
    return res.json();
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