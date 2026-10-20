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
    return body as { success: true; count: number; results: { client: number; attendanceId: number; newBalance: number }[] };
}

export async function submitAccountPayment(data: { client: number; amount: number; comments: string; createdBy: string; paymentMethod: 'Cash' | 'Credit Card' }) {
    const res = await fetch(`${API_BASE}/financials/payment`, {
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

export async function assignPolygraphSlot(slotId: number, clientId: number, type: string, user: string, comments: string) {
    const res = await fetch(`${API_BASE}/polygraphs/slots/${slotId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, type, user, comments }),
    });
    return res.json();
}

export async function reopenPolygraphSlot(slotId: number, cancellation: { reason: string; notes: string; user: string }) {
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