import { useCallback, useMemo, useRef, useState } from 'react';
import { getGroupClients, submitBatchAttendance } from '../api';
import { isMonthlyFeeClient } from '../utils/soPhases';

export interface ClientRecord {
  clientid: number;
  firstname: string;
  lastname: string;
  docnumber?: string | null;
  accountbalance?: number | string | null;
  groupname?: string | null;
  programstatus?: string | null;
  programtype?: string | null;
  phase?: string | null;
  treatmentfee?: number | string | null;
  // True when the client already has an attendance this calendar month
  attendedthismonth?: boolean | null;
}

export interface GroupRecord {
  groupid: number;
  groupname: string;
  programtype?: string | null;
  clientcount?: number | string | null;
}

// One row on the attendance sheet. Money fields are per client so the
// review step can adjust any single client without touching the others.
export type PaymentMethod = 'Cash' | 'Credit Card';

export interface SessionEntry {
  client: ClientRecord;
  fee: number;
  payment: number;
  paymentMethod: PaymentMethod;
  voucher: boolean;
  comments: string;
}

export interface CheckInTerms {
  fee: number;
  payment: number;
  paymentMethod: PaymentMethod;
  voucher: boolean;
}

// What the check-in dialog sets per client. The fee comes from the client's account, not the dialog.
export type PaymentTerms = Omit<CheckInTerms, 'fee'>;

export type RosterStatus = 'idle' | 'loading' | 'ready' | 'error';
export type WorkflowView = 'checkin' | 'review';

export interface WorkflowNotifier {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onSaved?: () => void;
}

// Each client is charged the treatment fee on their own account. A client with no fee set is charged nothing.
// State SO Phase 1 clients are charged only on their first attendance of the month.
export const clientFee = (client: ClientRecord): number => {
  if (isMonthlyFeeClient(client.programtype, client.phase) && client.attendedthismonth) return 0;
  return Number(client.treatmentfee) || 0;
};

// Returns the first problem with the sheet, or null when it can be saved.
export const validateSession = (entries: SessionEntry[]): string | null => {
  if (entries.length === 0) return 'Check in at least one client before saving.';
  for (const e of entries) {
    const name = `${e.client.lastname}, ${e.client.firstname}`;
    if (!Number.isFinite(e.fee) || e.fee < 0) return `Enter a valid fee for ${name}.`;
    if (!Number.isFinite(e.payment) || e.payment < 0) return `Enter a valid payment for ${name}.`;
  }
  return null;
};

// Local calendar date. toISOString() is UTC and would roll evening sessions to tomorrow.
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function useGroupCheckIn(createdBy: string, notify: WorkflowNotifier) {
  const [groupId, setGroupId] = useState<number | null>(null);
  const [view, setView] = useState<WorkflowView>('checkin');
  const [roster, setRoster] = useState<ClientRecord[]>([]);
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>('idle');
  const [rosterError, setRosterError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [session, setSession] = useState<SessionEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Clients waiting on the check-in details dialog. fromSelection tells confirm whether to clear the roster selection.
  const [pendingCheckIn, setPendingCheckIn] = useState<{ clients: ClientRecord[]; fromSelection: boolean } | null>(null);

  // Guards against a slow response for a previous group overwriting the current roster.
  const rosterRequestId = useRef(0);

  const checkedInIds = useMemo(() => new Set(session.map(e => e.client.clientid)), [session]);

  // Roster members who can still be checked in (not already on the sheet).
  const selectableRoster = useMemo(
    () => roster.filter(c => !checkedInIds.has(c.clientid)),
    [roster, checkedInIds]
  );

  const allSelected = selectableRoster.length > 0 && selectableRoster.every(c => selectedIds.has(c.clientid));

  const loadRoster = useCallback(async (id: number) => {
    const requestId = ++rosterRequestId.current;
    setRosterStatus('loading');
    setRosterError('');
    try {
      const data: unknown = await getGroupClients(id);
      if (requestId !== rosterRequestId.current) return;
      if (!Array.isArray(data)) {
        const serverError = (data as { error?: string } | null)?.error;
        throw new Error(serverError || 'Unexpected response from server.');
      }
      setRoster(data as ClientRecord[]);
      setRosterStatus('ready');
    } catch (err: unknown) {
      if (requestId !== rosterRequestId.current) return;
      setRoster([]);
      setRosterStatus('error');
      setRosterError(err instanceof Error ? err.message : 'Could not load clients for this group.');
    }
  }, []);

  // Pure state reset, used when switching groups and after a successful save.
  const clearWorkflow = () => {
    rosterRequestId.current++;
    setGroupId(null);
    setView('checkin');
    setRoster([]);
    setRosterStatus('idle');
    setRosterError('');
    setSelectedIds(new Set());
    setSession([]);
    setPendingCheckIn(null);
  };

  const selectGroup = (id: number | null) => {
    if (id === groupId) return;
    if (session.length > 0 && !window.confirm(
      `Discard the ${session.length} client(s) on this attendance sheet and switch groups?`
    )) return;

    clearWorkflow();
    if (id === null) return;
    setGroupId(id);
    loadRoster(id);
  };

  const reloadRoster = () => {
    if (groupId !== null) loadRoster(groupId);
  };

  const toggleSelect = (clientId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableRoster.map(c => c.clientid)));
  };

  // Adds clients to the sheet. Skips anyone already on it, so repeat calls are safe.
  const addToSession = useCallback((entries: { client: ClientRecord; terms: CheckInTerms }[]) => {
    setSession(prev => {
      const onSheet = new Set(prev.map(e => e.client.clientid));
      const fresh = entries
        .filter(({ client }) => !onSheet.has(client.clientid))
        .map<SessionEntry>(({ client, terms }) => ({
          client,
          fee: terms.fee,
          payment: terms.payment,
          paymentMethod: terms.paymentMethod,
          voucher: terms.voucher,
          comments: '',
        }));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  // Both check-in paths open the details dialog first; nothing reaches the sheet until it is confirmed.
  const checkInSelected = () => {
    const picked = selectableRoster.filter(c => selectedIds.has(c.clientid));
    if (picked.length === 0) return;
    setPendingCheckIn({ clients: picked, fromSelection: true });
  };

  const addExternalClients = (clients: ClientRecord[]) => {
    const fresh = clients.filter(c => !checkedInIds.has(c.clientid));
    if (fresh.length === 0) return;
    setPendingCheckIn({ clients: fresh, fromSelection: false });
  };

  // terms holds each client's payment, method, and voucher from the dialog, keyed by client id.
  const confirmCheckIn = (terms: Record<number, PaymentTerms>) => {
    if (!pendingCheckIn) return;
    const { clients, fromSelection } = pendingCheckIn;
    addToSession(clients.map(client => ({ client, terms: { ...terms[client.clientid], fee: clientFee(client) } })));
    // Only a roster check-in clears the roster selection; external additions never touch it.
    if (fromSelection) setSelectedIds(new Set());
    setPendingCheckIn(null);
    notify.onSuccess(`Checked in ${clients.length} client(s).`);
  };

  const cancelCheckIn = () => setPendingCheckIn(null);

  const updateEntry = (clientId: number, patch: Partial<Omit<SessionEntry, 'client'>>) => {
    setSession(prev => prev.map(e => (e.client.clientid === clientId ? { ...e, ...patch } : e)));
  };

  const removeEntry = (clientId: number) => {
    setSession(prev => prev.filter(e => e.client.clientid !== clientId));
  };

  const goToReview = () => {
    if (session.length === 0) return;
    setView('review');
  };

  const backToCheckIn = () => setView('checkin');

  const submitSession = async () => {
    if (groupId === null) return;
    const problem = validateSession(session);
    if (problem) {
      notify.onError(problem);
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitBatchAttendance({
        group: groupId,
        date: todayLocal(),
        type: 'Group',
        createdBy,
        entries: session.map(e => ({
          client: e.client.clientid,
          groupFee: e.fee,
          accountPaid: e.payment,
          paymentMethod: e.paymentMethod,
          voucherUsed: e.voucher,
          comments: e.comments.trim(),
        })),
      });
      notify.onSuccess(`Attendance saved for ${res.count} client(s).`);
      clearWorkflow();
      notify.onSaved?.();
    } catch (err: unknown) {
      // Session is left intact so the user can correct it and retry.
      notify.onError(err instanceof Error && err.message ? err.message : 'Failed to save attendance. Your entries are still here; try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return {
    groupId,
    selectGroup,
    view,
    goToReview,
    backToCheckIn,
    roster,
    rosterStatus,
    rosterError,
    reloadRoster,
    selectableRoster,
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    allSelected,
    checkInSelected,
    checkedInIds,
    addExternalClients,
    pendingCheckIn,
    confirmCheckIn,
    cancelCheckIn,
    session,
    updateEntry,
    removeEntry,
    submitSession,
    submitting,
  };
}

export type GroupCheckInState = ReturnType<typeof useGroupCheckIn>;
