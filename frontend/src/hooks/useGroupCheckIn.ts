import { useCallback, useMemo, useRef, useState } from 'react';
import { getGroupClients, getGroupSessions, saveOpenGroup, submitBatchAttendance } from '../api';
import type { GroupDaySession } from '../api';
import type { OpenGroupSession } from '../api';
import { isMonthlyFeeClient } from '../utils/soPhases';
import { bipCheckInBlockMessage } from '../utils/bip';
import type { BipCheckInBlock } from '../utils/bip';

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
  // Unexpired temporary reduced fee; replaces treatmentfee while set
  activefeeoverride?: number | string | null;
  // True when the client already has an attendance this calendar month
  attendedthismonth?: boolean | null;
  // Date of the client's most recent attendance
  lastattended?: string | null;
  // Most recent group attendance (not an assessment or individual session); sent with the group roster
  lastgroupattended?: string | null;
  // Set when a BIP client can't be checked into group yet (see utils/bip.ts)
  bipcheckinblock?: BipCheckInBlock;
  // Poly fee total and how much of it has been paid; tracked apart from the account balance
  polyfee?: number | string | null;
  polyfeepaid?: number | string | null;
  polyfeevoucher?: number | string | null;
}

export interface GroupRecord {
  groupid: number;
  groupname: string;
  programtype?: string | null;
  clientcount?: number | string | null;
  // The group's usual counselor (display name)
  counselor?: string | null;
}

// One row on the attendance sheet. Money fields are per client so the
// review step can adjust any single client without touching the others.
export type PaymentMethod = 'Cash' | 'Credit Card';

export interface SessionEntry {
  client: ClientRecord;
  fee: number;
  // Cash or voucher payment taken at check-in; recorded when the group closes
  payment: number;
  paymentMethod: PaymentMethod;
  // Card payment taken at check-in; already saved to the account, so it is not recorded again on close
  cardPaid: number;
  // Account balance as of check-in, including any card payment already saved
  balance: number;
  voucher: boolean;
  comments: string;
}

export interface CheckInTerms {
  fee: number;
  payment: number;
  paymentMethod: PaymentMethod;
  voucher: boolean;
  cardPaid: number;
  balance: number;
}

// What the check-in dialog sets per client. The fee comes from the client's account, not the dialog.
export type PaymentTerms = Omit<CheckInTerms, 'fee'>;

export type RosterStatus = 'idle' | 'loading' | 'ready' | 'error';
export type WorkflowView = 'checkin' | 'review';

export interface WorkflowNotifier {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onSaved?: () => void;
  // Called after an open group is saved or closed so the Open Groups list can refresh
  onOpenGroupsChanged?: () => void;
}

// Each client is charged the treatment fee on their own account. A client with no fee set is charged nothing.
// State SO Phase 1 clients are charged only on their first attendance of the month.
export const clientFee = (client: ClientRecord): number => {
  if (isMonthlyFeeClient(client.programtype, client.phase) && client.attendedthismonth) return 0;
  if (client.activefeeoverride !== null && client.activefeeoverride !== undefined) return Number(client.activefeeoverride) || 0;
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
const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayLocal = () => localYmd(new Date());
// Sunday of this week, the same week attendedThisWeek uses
const weekStartLocal = () => {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return localYmd(d);
};

const MAKEUP_COMMENT = 'Approved make-up attendance';

// True when a BIP client already attended during the current calendar week (Sunday through Saturday).
// Assessments don't count, so the group roster's lastgroupattended is used when present.
export const attendedThisWeek = (client: ClientRecord): boolean => {
  const last = client.lastgroupattended !== undefined ? client.lastgroupattended : client.lastattended;
  if (client.programtype !== 'BIP' || !last) return false;
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  return new Date(last) >= weekStart;
};

// Asks about each BIP client who already attended this week. Confirmed clients are approved make-ups;
// denied clients are left off the check-in.
const confirmMakeups = (clients: ClientRecord[]) => {
  const makeupIds = new Set<number>();
  const approved = clients.filter(c => {
    if (!attendedThisWeek(c)) return true;
    const ok = window.confirm(
      `${c.lastname}, ${c.firstname} already attended this week (last attendance: ${new Date(c.lastattended!).toLocaleDateString()}).\n\n` +
      'Is this an approved make-up attendance?\n\nOK = confirm check-in    Cancel = deny check-in'
    );
    if (ok) makeupIds.add(c.clientid);
    return ok;
  });
  return { approved, makeupIds };
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
  // Date of the session on the sheet. Set when an open group is resumed so it closes on the day it was held; null means today.
  const [sessionDate, setSessionDate] = useState<string | null>(null);
  // Clients waiting on the check-in details dialog. fromSelection tells confirm whether to clear the roster selection.
  // makeupIds are clients confirmed as approved make-ups for this week.
  const [pendingCheckIn, setPendingCheckIn] = useState<{ clients: ClientRecord[]; fromSelection: boolean; makeupIds: Set<number> } | null>(null);
  // Clients who already attended this session of the group; a client can attend a session only once
  const [attendedIds, setAttendedIds] = useState<Set<number>>(() => new Set());
  // Which session of the group on the session date this sheet is for (1 = the day's first)
  const [sessionNumber, setSessionNumber] = useState(1);
  // Set when the picked group already has a closed session this week: the user chooses a new session today or adding to
  // that one. nextNumber is the number a new session today would get.
  const [sessionChoice, setSessionChoice] = useState<{ latestClosed: GroupDaySession; nextNumber: number } | null>(null);
  // The sheet adds clients to a session that was already closed (Add to Closed Session, or a missed check-in)
  const [addingToClosed, setAddingToClosed] = useState(false);
  // Counselor covering the session (employee email), picked by the office; null means the group's usual counselor.
  // The server ignores it unless an Office Admin or Business Administrator sends it.
  const [coveredBy, setCoveredBy] = useState<string | null>(null);

  // Guards against a slow response for a previous group overwriting the current roster.
  const rosterRequestId = useRef(0);

  const checkedInIds = useMemo(() => new Set(session.map(e => e.client.clientid)), [session]);

  // Roster members who can still be checked in (not already on the sheet, not already attended today, and not a BIP
  // client still waiting on their intake or reinstate assessment).
  const selectableRoster = useMemo(
    () => roster.filter(c => !checkedInIds.has(c.clientid) && !attendedIds.has(c.clientid) && !c.bipcheckinblock),
    [roster, checkedInIds, attendedIds]
  );

  const allSelected = selectableRoster.length > 0 && selectableRoster.every(c => selectedIds.has(c.clientid));

  // date is the session date (YYYY-MM-DD). session is the session the sheet is for; when omitted (a group was just picked
  // for today) and the group already has a closed session this week, the user is asked whether this is a new session.
  const loadRoster = useCallback(async (id: number, date: string, session?: number) => {
    const requestId = ++rosterRequestId.current;
    setRosterStatus('loading');
    setRosterError('');
    try {
      const [data, sessions]: [unknown, GroupDaySession[]] = await Promise.all([
        getGroupClients(id),
        getGroupSessions(id, date, session === undefined ? weekStartLocal() : undefined),
      ]);
      if (requestId !== rosterRequestId.current) return;
      if (!Array.isArray(data)) {
        const serverError = (data as { error?: string } | null)?.error;
        throw new Error(serverError || 'Unexpected response from server.');
      }
      // Only Active clients are listed for check-in (Manage Group still shows everyone assigned)
      setRoster((data as ClientRecord[]).filter(c => c.programstatus === 'Active'));
      const closed = sessions.filter(s => s.closed);
      if (session === undefined && closed.length > 0) {
        // Sessions come oldest first, so the last closed one is the most recent this week
        const latestClosed = closed[closed.length - 1];
        // Session numbers count up within a day, so a new session today follows today's sessions only
        const nextNumber = Math.max(0, ...sessions.filter(s => s.date === date).map(s => s.sessionNumber)) + 1;
        // Until the user answers, treat it as the closed session so nobody from it can be checked in again by accident
        setSessionDate(latestClosed.date === date ? null : latestClosed.date);
        setSessionNumber(latestClosed.sessionNumber);
        setAttendedIds(new Set(latestClosed.clients));
        setSessionChoice({ latestClosed, nextNumber });
      } else {
        const current = session ?? 1;
        setSessionNumber(current);
        setAttendedIds(new Set(sessions.find(s => s.date === date && s.sessionNumber === current)?.clients ?? []));
      }
      setRosterStatus('ready');
    } catch (err: unknown) {
      if (requestId !== rosterRequestId.current) return;
      setRoster([]);
      setAttendedIds(new Set());
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
    setSessionDate(null);
    setPendingCheckIn(null);
    setAttendedIds(new Set());
    setSessionNumber(1);
    setSessionChoice(null);
    setAddingToClosed(false);
    setCoveredBy(null);
  };

  // Answer to the "already held this week" question. 'new' starts another session today, so everyone can be checked in
  // again; 'existing' adds clients to the closed session (saved on the day it was held), so those who attended it stay blocked.
  const chooseSession = (choice: 'new' | 'existing') => {
    if (!sessionChoice) return;
    if (choice === 'new') {
      setSessionDate(null);
      setSessionNumber(sessionChoice.nextNumber);
      setAttendedIds(new Set());
    } else {
      setAddingToClosed(true);
    }
    setSessionChoice(null);
  };

  // Business Administrators: missed check-ins for a session already closed, picked from the Closed Groups panel. Saved on
  // the day it was held; clients who attended it can't be checked in to it again.
  const openClosedSession = (id: number, groupName: string, date: string, number: number) => {
    if (session.length > 0 && !window.confirm(
      `Discard the ${session.length} client(s) on this attendance sheet and add missed check-ins to ${groupName}?`
    )) return;
    clearWorkflow();
    setGroupId(id);
    setSessionDate(date === todayLocal() ? null : date);
    setSessionNumber(number);
    setAddingToClosed(true);
    loadRoster(id, date, number);
  };

  // Loads a saved open group onto the sheet, ready to review and close
  const resumeOpenGroup = (open: OpenGroupSession) => {
    const openSession = open.sessionnumber ?? 1;
    if (groupId === open.groupid && sessionDate === open.sessiondate && sessionNumber === openSession) {
      setView('review');
      return;
    }
    if (session.length > 0 && !window.confirm(
      `Discard the ${session.length} client(s) on this attendance sheet and open ${open.groupname}?`
    )) return;

    clearWorkflow();
    setGroupId(open.groupid);
    setSessionDate(open.sessiondate);
    setSession(open.entries);
    setView('review');
    setSessionNumber(openSession);
    setCoveredBy(open.coveredby ?? null);
    loadRoster(open.groupid, open.sessiondate, openSession);
  };

  // Finish Check-In: saves the sheet as an open group so it can be closed later, then clears the screen
  const finishCheckIn = async () => {
    if (groupId === null || session.length === 0) return;
    setSubmitting(true);
    try {
      await saveOpenGroup({ group: groupId, date: sessionDate ?? todayLocal(), sessionNumber, entries: session, createdBy, coveredBy });
      notify.onSuccess(`Check-in saved for ${session.length} client(s). Close the group from Open Groups when you're ready.`);
      clearWorkflow();
      notify.onOpenGroupsChanged?.();
    } catch (err: unknown) {
      notify.onError(err instanceof Error && err.message ? err.message : 'Failed to save the check-in. Your entries are still here; try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectGroup = (id: number | null) => {
    if (id === groupId) return;
    if (session.length > 0 && !window.confirm(
      `Discard the ${session.length} client(s) on this attendance sheet and switch groups?`
    )) return;

    clearWorkflow();
    if (id === null) return;
    setGroupId(id);
    loadRoster(id, todayLocal());
  };

  const reloadRoster = () => {
    if (groupId === null) return;
    // While the question is unanswered, sessionDate is only provisional; ask again from today
    if (sessionChoice) loadRoster(groupId, todayLocal());
    else loadRoster(groupId, sessionDate ?? todayLocal(), sessionNumber);
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
  const addToSession = useCallback((entries: { client: ClientRecord; terms: CheckInTerms; comments?: string }[]) => {
    setSession(prev => {
      const onSheet = new Set(prev.map(e => e.client.clientid));
      const fresh = entries
        .filter(({ client }) => !onSheet.has(client.clientid))
        .map<SessionEntry>(({ client, terms, comments }) => ({
          client,
          fee: terms.fee,
          payment: terms.payment,
          paymentMethod: terms.paymentMethod,
          cardPaid: terms.cardPaid,
          balance: terms.balance,
          voucher: terms.voucher,
          comments: comments ?? '',
        }));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  // Both check-in paths open the details dialog first; nothing reaches the sheet until it is confirmed.
  const checkInSelected = () => {
    const picked = selectableRoster.filter(c => selectedIds.has(c.clientid));
    if (picked.length === 0) return;
    const { approved, makeupIds } = confirmMakeups(picked);
    if (approved.length === 0) {
      // Every pick was denied; drop them from the selection so they aren't checked in by accident
      setSelectedIds(new Set());
      return;
    }
    setPendingCheckIn({ clients: approved, fromSelection: true, makeupIds });
  };

  const addExternalClients = (clients: ClientRecord[]) => {
    const alreadyAttended = clients.filter(c => attendedIds.has(c.clientid));
    if (alreadyAttended.length > 0) {
      notify.onError(`${alreadyAttended.map(c => `${c.lastname}, ${c.firstname}`).join('; ')} already attended this group session and cannot be checked in to it again.`);
    }
    const blocked = clients.filter(c => c.bipcheckinblock && !checkedInIds.has(c.clientid));
    if (blocked.length > 0) {
      notify.onError(blocked.map(c => bipCheckInBlockMessage(c.bipcheckinblock, `${c.lastname}, ${c.firstname}`)).join(' '));
    }
    const fresh = clients.filter(c => !checkedInIds.has(c.clientid) && !attendedIds.has(c.clientid) && !c.bipcheckinblock);
    if (fresh.length === 0) return;
    const { approved, makeupIds } = confirmMakeups(fresh);
    if (approved.length === 0) return;
    setPendingCheckIn({ clients: approved, fromSelection: false, makeupIds });
  };

  // terms holds each client's payment, method, and voucher from the dialog, keyed by client id.
  const confirmCheckIn = (terms: Record<number, PaymentTerms>) => {
    if (!pendingCheckIn) return;
    const { clients, fromSelection, makeupIds } = pendingCheckIn;
    addToSession(clients.map(client => ({
      client,
      terms: { ...terms[client.clientid], fee: clientFee(client) },
      // Approved make-ups are noted on the attendance record
      comments: makeupIds.has(client.clientid) ? MAKEUP_COMMENT : undefined,
    })));
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
        date: sessionDate ?? todayLocal(),
        sessionNumber,
        type: 'Group',
        createdBy,
        coveredBy,
        entries: session.map(e => ({
          client: e.client.clientid,
          groupFee: e.fee,
          accountPaid: e.payment,
          paymentMethod: e.paymentMethod,
          voucherUsed: e.voucher,
          comments: e.comments.trim(),
        })),
      });
      const awarded = res.polyVouchersAwarded
        ? ` ${res.polyVouchersAwarded} client(s) earned a poly fee voucher (last polygraph NDI).`
        : '';
      notify.onSuccess(`Attendance saved for ${res.count} client(s).${awarded}`);
      clearWorkflow();
      notify.onSaved?.();
      notify.onOpenGroupsChanged?.();
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
    attendedIds,
    addExternalClients,
    pendingCheckIn,
    confirmCheckIn,
    cancelCheckIn,
    session,
    updateEntry,
    removeEntry,
    submitSession,
    submitting,
    sessionDate,
    sessionNumber,
    sessionChoice,
    chooseSession,
    addingToClosed,
    openClosedSession,
    resumeOpenGroup,
    finishCheckIn,
    coveredBy,
    setCoveredBy,
  };
}

export type GroupCheckInState = ReturnType<typeof useGroupCheckIn>;
