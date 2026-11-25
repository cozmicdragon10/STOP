import { useCallback, useMemo, useRef, useState } from 'react';
import { addClientNote, changeGroupMeeting, deleteOpenGroup, getGroupClients, getGroupOffDay, getGroupSessions, moveCardPayment, saveOpenGroup, submitAccountPayment, submitBatchAttendance } from '../api';
import type { GroupDaySession, GroupOffDay } from '../api';
import type { OpenGroupSession } from '../api';
import { isMonthlyFeeClient } from '../utils/soPhases';
import { bipCheckInBlockMessage } from '../utils/bip';
import type { BipCheckInBlock } from '../utils/bip';
import { drugTestedOn, needsDuration, outOfUnits, unitCodeFor, unitCodeLabel } from '../utils/federalUnits';
import { federalGroupFee, individualSessionFee } from '../utils/clients';
import { paymentMethodText, type PaymentMethod } from '../utils/paymentMethods';
import { askConfirm } from '../utils/confirm';

export interface ClientRecord {
  clientid: number;
  firstname: string;
  lastname: string;
  // The Comments on the client's account (Personal Information), shown under their name while checking in
  comments?: string | null;
  docnumber?: string | null;
  doctype?: string | null;
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
  // True when the client already had an individual session this calendar month (the individual first-of-the-month rule)
  individualthismonth?: boolean | null;
  // Max Debt Override in effect: how much the client may owe and still attend (null when none: $0.00)
  maxowed?: number | string | null;
  // This period's treatment fee was already charged (month for Phase 1 and 2, 3 or 6 months for Phase 3 and 4)
  feealreadycharged?: boolean | null;
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
  // Card payments blocked by a Business Administrator: cash only (utils/cardBlock.ts)
  cardpaymentsblocked?: boolean | null;
  cardblockreason?: string | null;
  // Check payments blocked by a Business Administrator: Check isn't offered (utils/checkBlock.ts)
  checkpaymentsblocked?: boolean | null;
  checkblockreason?: string | null;
  // Federal billing units by code (utils/federalUnits.ts); Federal SO clients use 6022 / 6012 per session
  federalunits?: Record<string, number | string> | null;
  // Fed Drug Test clients: date (YYYY-MM-DD) of their latest drug test; they can be tested once a day
  lastdrugtest?: string | null;
  // Federal clients: what they pay instead of the group fee and the Individual price (blank = nothing)
  groupcopay?: number | string | null;
  individualcopay?: number | string | null;
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
// Cash, Credit Card, or Other (utils/paymentMethods.ts)
export type { PaymentMethod };

export interface SessionEntry {
  client: ClientRecord;
  fee: number;
  // Cash or Other (check, money order, ...) payment taken at check-in; recorded when the group closes
  payment: number;
  paymentMethod: PaymentMethod;
  // Other payments: the kind (Check, DHS, ...) and an optional reference #
  paymentSubtype?: string | null;
  paymentReference?: string | null;
  // Card payment taken at check-in; already saved to the account, so it is not recorded again on close
  cardPaid: number;
  // Its ledger row(s), so it can be moved to the right client if this one was checked in by mistake
  cardTransactionIds?: number[];
  // Account balance as of check-in, including any card payment already saved
  balance: number;
  voucher: boolean;
  // Added to the client's case notes as a Therapist note when the group closes (not saved on the attendance)
  comments: string;
  // Confirmed as an approved make-up (a BIP client who already attended that week); marked on the attendance
  makeup?: boolean;
  // An attendance receipt was printed for this client. The client can't be removed from the session, and the open group
  // can't be discarded, so the attendance saved when the group closes matches the receipt (the server enforces this too).
  receiptPrinted?: boolean;
  // Federal SO clients: how long they attended (utils/federalUnits.ts DURATION_BANDS), picked when the group is closed
  durationBand?: string;
}

export interface CheckInTerms {
  fee: number;
  payment: number;
  paymentMethod: PaymentMethod;
  paymentSubtype?: string | null;
  paymentReference?: string | null;
  voucher: boolean;
  cardPaid: number;
  cardTransactionIds?: number[];
  balance: number;
}

// What happens to the money of a client removed from the sheet (see resolveRemoval)
type RemovalClient = { clientid: number; firstname: string; lastname: string };
export type RemovalChoice =
  | { kind: 'refund' }
  | { kind: 'account'; toClient: RemovalClient }
  | { kind: 'move-card'; toClient: RemovalClient }
  | { kind: 'keep-card' };

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

// Whether this period's treatment fee was already charged: State/Voluntary SO Phase 1 and 2 once per calendar month,
// Phase 3 and 4 once per 3 or 6 months. The server works it out (feealreadycharged); attendedthismonth covers lists without it.
export const feeAlreadyCharged = (client: ClientRecord): boolean =>
  client.feealreadycharged ?? (isMonthlyFeeClient(client.programtype, client.phase) && Boolean(client.attendedthismonth));

// Each client is charged the treatment fee on their own account. A client with no fee set is charged nothing.
// State SO Phase 1 clients are charged only on their first attendance of the month. Federal clients pay their Group Copay
// instead (federalGroupFee).
export const clientFee = (client: ClientRecord): number => {
  const federal = federalGroupFee(client.programtype, client.groupcopay, Boolean(client.attendedthismonth));
  if (federal !== null) return federal;
  if (feeAlreadyCharged(client)) return 0;
  if (client.activefeeoverride !== null && client.activefeeoverride !== undefined) return Number(client.activefeeoverride) || 0;
  return Number(client.treatmentfee) || 0;
};

// Returns the first problem with the sheet, or null when it can be saved.
export const validateSession = (entries: SessionEntry[], groupProgram?: string | null): string | null => {
  if (entries.length === 0) return 'Check in at least one client before saving.';
  for (const e of entries) {
    const name = `${e.client.lastname}, ${e.client.firstname}`;
    if (!Number.isFinite(e.fee) || e.fee < 0) return `Enter a valid fee for ${name}.`;
    if (!Number.isFinite(e.payment) || e.payment < 0) return `Enter a valid payment for ${name}.`;
    if (needsDuration(e.client, groupProgram) && !e.durationBand) return `Choose how long ${name} attended.`;
  }
  return null;
};

// Local calendar date. toISOString() is UTC and would roll evening sessions to tomorrow.
const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayLocal = () => localYmd(new Date());
// Sunday of the week a date (YYYY-MM-DD) falls in; weeks run Sunday to Saturday like attendedThisWeek
const weekStartOf = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() - d.getDay());
  return localYmd(d);
};

// 'Wednesday, November 18'
const checkInDate = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

// Check-in lists (roster, attendance sheet, check-in dialog) are in alphabetical order by last name, then first name
export const byClientName = (a: Pick<ClientRecord, 'lastname' | 'firstname'>, b: Pick<ClientRecord, 'lastname' | 'firstname'>) =>
  (a.lastname ?? '').localeCompare(b.lastname ?? '', undefined, { sensitivity: 'base' })
  || (a.firstname ?? '').localeCompare(b.firstname ?? '', undefined, { sensitivity: 'base' });
export const sortEntriesByName = (entries: SessionEntry[]) => [...entries].sort((a, b) => byClientName(a.client, b.client));

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
const confirmMakeups = async (clients: ClientRecord[]) => {
  const makeupIds = new Set<number>();
  const approved: ClientRecord[] = [];
  // One question at a time, in order
  for (const c of clients) {
    if (!attendedThisWeek(c)) { approved.push(c); continue; }
    const ok = await askConfirm({
      title: `${c.lastname}, ${c.firstname} already attended this week`,
      message: `Last attendance: ${new Date(c.lastattended!).toLocaleDateString()}.\n\nIs this an approved make-up attendance?`,
      confirmLabel: 'Approved Make-Up',
      cancelLabel: 'Deny Check-In',
    });
    if (ok) { makeupIds.add(c.clientid); approved.push(c); }
  }
  return { approved, makeupIds };
};

// openGroups: the saved open check-ins, so removing a paid client can update the one saved for this sheet
export function useGroupCheckIn(createdBy: string, notify: WorkflowNotifier, openGroups: OpenGroupSession[] = []) {
  const [groupId, setGroupId] = useState<number | null>(null);
  const [view, setView] = useState<WorkflowView>('checkin');
  const [roster, setRoster] = useState<ClientRecord[]>([]);
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>('idle');
  const [rosterError, setRosterError] = useState('');
  const [session, setSession] = useState<SessionEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Date of the session on the sheet. Set when an open group is resumed so it closes on the day it was held; null means today.
  const [sessionDate, setSessionDate] = useState<string | null>(null);
  // Clients waiting on the check-in details dialog.
  // makeupIds are clients confirmed as approved make-ups for this week.
  const [pendingCheckIn, setPendingCheckIn] = useState<{ clients: ClientRecord[]; makeupIds: Set<number> } | null>(null);
  // A client who paid Cash or Other at check-in, waiting in the Remove dialog for where that money goes
  const [pendingRemoval, setPendingRemoval] = useState<SessionEntry | null>(null);
  // Clients who already attended this session of the group; a client can attend a session only once
  const [attendedIds, setAttendedIds] = useState<Set<number>>(() => new Set());
  // Which session of the group on the session date this sheet is for (1 = the day's first)
  const [sessionNumber, setSessionNumber] = useState(1);
  // Set when the picked group already has a closed session that week: the user chooses a new session on the picked date
  // (date) or adding to that one. nextNumber is the number a new session that day would get.
  const [sessionChoice, setSessionChoice] = useState<{ latestClosed: GroupDaySession; nextNumber: number; date: string } | null>(null);
  // The sheet adds clients to a session that was already closed (Add to Closed Session, or a missed check-in)
  const [addingToClosed, setAddingToClosed] = useState(false);
  // Counselor covering the session (employee email), picked by the office; null means the group's usual counselor.
  // The server ignores it unless an Office Admin or Business Administrator sends it.
  const [coveredBy, setCoveredBy] = useState<string | null>(null);
  // Set while the picked group is a counselor's individual group: every client is charged this Admin Individual price
  // instead of their treatment fee, and BIP clients (who don't have individual sessions) can't be checked in
  const [individualFee, setIndividualFee] = useState<number | null>(null);
  // The picked group's program type, which sets the units code each client's session uses (utils/federalUnits.ts)
  const [groupProgram, setGroupProgram] = useState<string | null>(null);

  // Guards against a slow response for a previous group overwriting the current roster.
  const rosterRequestId = useRef(0);
  // The same for the "not its regular day" question, so it's never asked about a group no longer picked
  const offDayRequestId = useRef(0);
  // Finish Check-In on a day that isn't the group's regular day: the Group Reschedule dialog waiting for an answer
  // (or Close Group: then says which one carries on once it's answered)
  const [offDayPrompt, setOffDayPrompt] = useState<{ groupId: number; date: string; off: GroupOffDay; then: 'review' | 'close' } | null>(null);
  // "groupId|date" once that question has been answered, so going back and pressing Finish Check-In again doesn't re-ask
  const offDayAsked = useRef('');

  const checkedInIds = useMemo(() => new Set(session.map(e => e.client.clientid)), [session]);

  // Roster members who can still be checked in (not already on the sheet, not already attended today, and not a BIP
  // client still waiting on their intake or reinstate assessment).
  const selectableRoster = useMemo(
    () => roster.filter(c => !checkedInIds.has(c.clientid) && !attendedIds.has(c.clientid) && !c.bipcheckinblock
      && !(individualFee !== null && c.programtype === 'BIP') && !outOfUnits(c, groupProgram)
      && !drugTestedOn(c, groupProgram, sessionDate ?? todayLocal())),
    [roster, checkedInIds, attendedIds, individualFee, groupProgram, sessionDate]
  );

  // date is the session date (YYYY-MM-DD). session is the session the sheet is for; when omitted (a group was just picked)
  // and the group already has a closed session that week, the user is asked whether this is a new session.
  const loadRoster = useCallback(async (id: number, date: string, session?: number) => {
    const requestId = ++rosterRequestId.current;
    setRosterStatus('loading');
    setRosterError('');
    try {
      const [data, sessions]: [unknown, GroupDaySession[]] = await Promise.all([
        getGroupClients(id),
        getGroupSessions(id, date, session === undefined ? weekStartOf(date) : undefined),
      ]);
      if (requestId !== rosterRequestId.current) return;
      if (!Array.isArray(data)) {
        const serverError = (data as { error?: string } | null)?.error;
        throw new Error(serverError || 'Unexpected response from server.');
      }
      // Only Active clients are listed for check-in (Manage Group still shows everyone assigned)
      setRoster((data as ClientRecord[]).filter(c => c.programstatus === 'Active').sort(byClientName));
      const closed = sessions.filter(s => s.closed);
      if (session === undefined && closed.length > 0) {
        // Sessions come oldest first, so the last closed one is the most recent this week
        const latestClosed = closed[closed.length - 1];
        // Session numbers count up within a day, so a new session today follows today's sessions only
        const nextNumber = Math.max(0, ...sessions.filter(s => s.date === date).map(s => s.sessionNumber)) + 1;
        // Until the user answers, treat it as the closed session so nobody from it can be checked in again by accident
        setSessionDate(latestClosed.date === todayLocal() ? null : latestClosed.date);
        setSessionNumber(latestClosed.sessionNumber);
        setAttendedIds(new Set(latestClosed.clients));
        setSessionChoice({ latestClosed, nextNumber, date });
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
    offDayRequestId.current++;
    setOffDayPrompt(null);
    offDayAsked.current = '';
    setGroupId(null);
    setView('checkin');
    setRoster([]);
    setRosterStatus('idle');
    setRosterError('');
    setSession([]);
    setSessionDate(null);
    setPendingCheckIn(null);
    setAttendedIds(new Set());
    setSessionNumber(1);
    setSessionChoice(null);
    setAddingToClosed(false);
    setCoveredBy(null);
  };

  // Answer to the "already held this week" question. 'new' starts another session on the picked date, so everyone can be
  // checked in again; 'existing' adds clients to the closed session (saved on the day it was held), so those who attended it stay blocked.
  const chooseSession = (choice: 'new' | 'existing') => {
    if (!sessionChoice) return;
    if (choice === 'new') {
      setSessionDate(sessionChoice.date === todayLocal() ? null : sessionChoice.date);
      setSessionNumber(sessionChoice.nextNumber);
      setAttendedIds(new Set());
    } else {
      setAddingToClosed(true);
    }
    setSessionChoice(null);
  };

  // Business Administrators: missed check-ins for a session already closed, picked from the Closed Groups panel. Saved on
  // the day it was held; clients who attended it can't be checked in to it again.
  const openClosedSession = async (id: number, groupName: string, date: string, number: number) => {
    if (session.length > 0 && !(await askConfirm({
      title: `Discard the ${session.length} client(s) on this attendance sheet?`,
      message: `The sheet is cleared and missed check-ins can be added to ${groupName}.`,
      confirmLabel: 'Discard Sheet', cancelLabel: 'Keep Sheet', danger: true,
    }))) return;
    clearWorkflow();
    setGroupId(id);
    setSessionDate(date === todayLocal() ? null : date);
    setSessionNumber(number);
    setAddingToClosed(true);
    loadRoster(id, date, number);
  };

  // Loads a saved open group onto the sheet, ready to review and close
  const resumeOpenGroup = async (open: OpenGroupSession) => {
    const openSession = open.sessionnumber ?? 1;
    if (groupId === open.groupid && sessionDate === open.sessiondate && sessionNumber === openSession) {
      setView('review');
      return;
    }
    if (session.length > 0 && !(await askConfirm({
      title: `Discard the ${session.length} client(s) on this attendance sheet?`,
      message: `The sheet is cleared and ${open.groupname} opens instead.`,
      confirmLabel: 'Discard Sheet', cancelLabel: 'Keep Sheet', danger: true,
    }))) return;

    clearWorkflow();
    setGroupId(open.groupid);
    setSessionDate(open.sessiondate);
    setSession(sortEntriesByName(open.entries));
    setView('review');
    setSessionNumber(openSession);
    setCoveredBy(open.coveredby ?? null);
    loadRoster(open.groupid, open.sessiondate, openSession);
  };

  // Saves the sheet as an open group so it can be closed later. Finish Check-In (thenReview) then goes on to the Review &
  // Comments screen to add comments and close the group; Save for Later clears the screen.
  // Finish Check-In on a day that isn't the group's regular day first opens the Group Reschedule dialog (offDayPrompt);
  // answering it (answerOffDay) carries on with the save.
  const finishCheckIn = async ({ thenReview = false }: { thenReview?: boolean } = {}) => {
    if (groupId === null || session.length === 0) return;
    if (thenReview && await askOffDay('review')) return;
    await saveCheckIn(thenReview);
  };

  // Finish Check-In (then = 'review') and Close Group (then = 'close') on a day that isn't the group's regular day: opens
  // the Group Reschedule dialog and returns true, or false when there's nothing to ask (its regular day, already asked
  // for this group and day, adding to a closed session, or the meeting already moved, held or cancelled that week).
  const askOffDay = async (then: 'review' | 'close'): Promise<boolean> => {
    if (groupId === null || addingToClosed) return false;
    const date = sessionDate ?? todayLocal();
    if (offDayAsked.current === `${groupId}|${date}`) return false;
    const requestId = ++offDayRequestId.current;
    setSubmitting(true);
    let off: GroupOffDay | null = null;
    try {
      off = await getGroupOffDay(groupId, date);
    } catch {
      // The schedule check failing never holds up the check-in; it just isn't asked
    }
    setSubmitting(false);
    if (requestId !== offDayRequestId.current) return true;
    if (!off?.offer || !off.scheduledDate || !off.newTime) return false;
    setOffDayPrompt({ groupId, date, off, then });
    return true;
  };

  const saveCheckIn = async (thenReview: boolean) => {
    if (groupId === null || session.length === 0) return;
    setSubmitting(true);
    try {
      await saveOpenGroup({ group: groupId, date: sessionDate ?? todayLocal(), sessionNumber, entries: session, createdBy, coveredBy });
      if (thenReview) {
        notify.onSuccess(`Check-in saved for ${session.length} client(s). Add comments and close the group, or Save for Later.`);
        setView('review');
      } else {
        notify.onSuccess(`Check-in saved for ${session.length} client(s). Close the group from Open Groups when you're ready.`);
        clearWorkflow();
      }
      notify.onOpenGroupsChanged?.();
    } catch (err: unknown) {
      notify.onError(err instanceof Error && err.message ? err.message : 'Failed to save the check-in. Your entries are still here; try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // date (YYYY-MM-DD) is the day the group took place; today unless a different date was picked
  const selectGroup = async (id: number | null, date = todayLocal()) => {
    if (id === groupId && date === (sessionDate ?? todayLocal())) return;
    if (session.length > 0 && !(await askConfirm({
      title: `Discard the ${session.length} client(s) on this attendance sheet?`,
      message: `The sheet is cleared to ${id === groupId ? 'change the session date' : 'switch groups'}.`,
      confirmLabel: 'Discard Sheet', cancelLabel: 'Keep Sheet', danger: true,
    }))) return;

    clearWorkflow();
    if (id === null) return;
    setGroupId(id);
    setSessionDate(date === todayLocal() ? null : date);
    loadRoster(id, date);
  };

  // Answer to the Group Reschedule dialog shown at Finish Check-In or Close Group on a day that isn't the group's regular
  // day. 'add' moves that week's meeting to the check-in day, which adds a Group Reschedule case note for each client;
  // 'skip' adds no notes (the calendar still shows the day it was held); both then carry on: Finish Check-In saves the
  // check-in and goes on to Review, Close Group saves the attendance. 'cancel' goes back to the screen without saving.
  // Asked once per group and day: answered, neither button asks again.
  const answerOffDay = async (choice: 'add' | 'skip' | 'cancel') => {
    const prompt = offDayPrompt;
    setOffDayPrompt(null);
    if (!prompt || choice === 'cancel') return;
    offDayAsked.current = `${prompt.groupId}|${prompt.date}`;
    const { off, date } = prompt;
    if (choice === 'add') {
      try {
        const result = await changeGroupMeeting(prompt.groupId, {
          originalDate: off.scheduledDate!, action: 'Rescheduled', newDate: date, newTime: off.newTime!,
          reason: 'The group met on a different day this week.',
        });
        notify.onSuccess(`${off.groupName}: this week's meeting moved to ${checkInDate(date)}. Group Reschedule note added to ${result.notes} client${result.notes === 1 ? '' : 's'}.`);
      } catch (err: unknown) {
        notify.onError(`The reschedule note wasn't added: ${err instanceof Error && err.message ? err.message : 'something went wrong'}. The check-in itself isn't affected.`);
      }
    }
    if (prompt.then === 'close') await closeGroup();
    else await saveCheckIn(true);
  };

  const reloadRoster = () => {
    if (groupId === null) return;
    // While the question is unanswered, sessionDate is only provisional; ask again for the picked date
    if (sessionChoice) loadRoster(groupId, sessionChoice.date);
    else loadRoster(groupId, sessionDate ?? todayLocal(), sessionNumber);
  };

  // Adds clients to the sheet. Skips anyone already on it, so repeat calls are safe.
  const addToSession = useCallback((entries: { client: ClientRecord; terms: CheckInTerms; makeup?: boolean }[]) => {
    setSession(prev => {
      const onSheet = new Set(prev.map(e => e.client.clientid));
      const fresh = entries
        .filter(({ client }) => !onSheet.has(client.clientid))
        .map<SessionEntry>(({ client, terms, makeup }) => ({
          client,
          fee: terms.fee,
          payment: terms.payment,
          paymentMethod: terms.paymentMethod,
          paymentSubtype: terms.paymentMethod === 'Other' ? terms.paymentSubtype ?? null : null,
          paymentReference: terms.paymentMethod === 'Other' ? terms.paymentReference ?? null : null,
          cardPaid: terms.cardPaid,
          ...(terms.cardTransactionIds?.length ? { cardTransactionIds: terms.cardTransactionIds } : {}),
          balance: terms.balance,
          voucher: terms.voucher,
          comments: '',
          ...(makeup ? { makeup: true } : {}),
        }));
      return fresh.length ? sortEntriesByName([...prev, ...fresh]) : prev;
    });
  }, []);

  // The Check In button on one roster row: opens the details dialog for just that client. Both check-in paths open the
  // dialog first; nothing reaches the sheet until it is confirmed.
  const checkInOne = async (clientId: number) => {
    const client = selectableRoster.find(c => c.clientid === clientId);
    if (!client) return;
    const { approved, makeupIds } = await confirmMakeups([client]);
    if (approved.length === 0) return;
    setPendingCheckIn({ clients: approved, makeupIds });
  };

  const addExternalClients = async (clients: ClientRecord[]) => {
    const alreadyAttended = clients.filter(c => attendedIds.has(c.clientid));
    if (alreadyAttended.length > 0) {
      notify.onError(`${alreadyAttended.map(c => `${c.lastname}, ${c.firstname}`).join('; ')} already attended this group session and cannot be checked in to it again.`);
    }
    const blocked = clients.filter(c => c.bipcheckinblock && !checkedInIds.has(c.clientid));
    if (blocked.length > 0) {
      notify.onError(blocked.map(c => bipCheckInBlockMessage(c.bipcheckinblock, `${c.lastname}, ${c.firstname}`)).join(' '));
    }
    const bipIndividual = individualFee !== null ? clients.filter(c => c.programtype === 'BIP' && !checkedInIds.has(c.clientid)) : [];
    if (bipIndividual.length > 0) {
      notify.onError(`${bipIndividual.map(c => `${c.lastname}, ${c.firstname}`).join('; ')}: BIP clients do not have individual sessions.`);
    }
    const noUnits = clients.filter(c => outOfUnits(c, groupProgram) && !checkedInIds.has(c.clientid));
    if (noUnits.length > 0) {
      notify.onError(`${noUnits.map(c => { const code = unitCodeFor(c, groupProgram)!; return `${c.lastname}, ${c.firstname} (no ${code} ${unitCodeLabel(code)} left)`; }).join('; ')}: they can't be checked in. Enter their units on their account first.`);
    }
    const testedToday = clients.filter(c => drugTestedOn(c, groupProgram, sessionDate ?? todayLocal()) && !checkedInIds.has(c.clientid) && !noUnits.includes(c));
    if (testedToday.length > 0) {
      notify.onError(`${testedToday.map(c => `${c.lastname}, ${c.firstname}`).join('; ')} already had a drug test that day. Clients can be drug tested once a day.`);
      noUnits.push(...testedToday);
    }
    const fresh = clients.filter(c => !checkedInIds.has(c.clientid) && !attendedIds.has(c.clientid) && !c.bipcheckinblock
      && !bipIndividual.includes(c) && !noUnits.includes(c));
    if (fresh.length === 0) return;
    const { approved, makeupIds } = await confirmMakeups(fresh);
    if (approved.length === 0) return;
    setPendingCheckIn({ clients: [...approved].sort(byClientName), makeupIds });
  };

  // terms holds each client's payment, method, and voucher from the dialog, keyed by client id.
  const confirmCheckIn = (terms: Record<number, PaymentTerms>) => {
    if (!pendingCheckIn) return;
    const { clients, makeupIds } = pendingCheckIn;
    addToSession(clients.map(client => ({
      client,
      terms: { ...terms[client.clientid], fee: individualFee !== null ? individualSessionFee(client, individualFee) : clientFee(client) },
      // Approved make-ups are marked on the attendance record
      makeup: makeupIds.has(client.clientid),
    })));
    setPendingCheckIn(null);
    notify.onSuccess(`Checked in ${clients.length} client(s).`);
  };

  const cancelCheckIn = () => setPendingCheckIn(null);

  const updateEntry = (clientId: number, patch: Partial<Omit<SessionEntry, 'client'>>) => {
    setSession(prev => prev.map(e => (e.client.clientid === clientId ? { ...e, ...patch } : e)));
  };

  // A client with a printed attendance receipt stays on the sheet. A client who paid at check-in isn't removed straight
  // away: the Remove dialog asks where the money goes first. Cash or Other is recorded only when the group closes, so it
  // goes on an account now or back to the client; a card payment is already on their account and can move to the client
  // who actually paid (the usual case: the wrong client was checked in).
  const removeEntry = async (clientId: number) => {
    const entry = session.find(e => e.client.clientid === clientId);
    if (!entry) return;
    if (entry.receiptPrinted) {
      notify.onError(`An attendance receipt was printed for ${entry.client.lastname}, ${entry.client.firstname}, so they can't be removed from this session.`);
      return;
    }
    if (entry.payment > 0 || (entry.cardPaid > 0 && entry.cardTransactionIds?.length)) {
      setPendingRemoval(entry);
      return;
    }
    // A sheet saved before card payments kept their receipt numbers: the payment stays where it is
    if (entry.cardPaid > 0 && !(await askConfirm({
      title: `Remove ${entry.client.lastname}, ${entry.client.firstname} from the sheet?`,
      message: `They paid $${entry.cardPaid.toFixed(2)} by card at check-in. That payment is already on their account and stays there as a credit.`,
      confirmLabel: 'Remove', cancelLabel: 'Keep on Sheet', danger: true,
    }))) return;
    setSession(prev => prev.filter(e => e.client.clientid !== clientId || e.receiptPrinted));
  };

  // The open check-in saved on the server (Finish Check-In or Save for Later) for this sheet, if there is one
  const savedOpenGroup = () => openGroups.find(o => o.groupid === groupId
    && o.sessiondate === (sessionDate ?? todayLocal()) && (o.sessionnumber ?? 1) === sessionNumber) ?? null;

  // Settles the money of the client waiting in the Remove dialog, then takes them off the sheet.
  // Cash or Other: 'refund' (handed back, nothing recorded) or 'account' (recorded now as an account payment on toClient:
  // the same client, or the client who should have been checked in). Card: 'move-card' (the payment moves to toClient's
  // account) or 'keep-card' (it stays on this client's account as a credit).
  // note: an optional case note for the removed client, saved as a Therapist note
  const resolveRemoval = async (choice: RemovalChoice, note = '') => {
    const entry = pendingRemoval;
    if (!entry || groupId === null) return;
    const name = `${entry.client.lastname}, ${entry.client.firstname}`;
    const card = entry.payment <= 0 && entry.cardPaid > 0;
    const paid = card
      ? `$${entry.cardPaid.toFixed(2)} Credit Card`
      : `$${entry.payment.toFixed(2)} ${paymentMethodText(entry.paymentMethod, entry.paymentSubtype, entry.paymentReference)}`;
    const date = new Date(`${sessionDate ?? todayLocal()}T00:00:00`).toLocaleDateString();
    const toName = 'toClient' in choice ? `${choice.toClient.lastname}, ${choice.toClient.firstname}` : '';
    setSubmitting(true);
    let message: string;
    try {
      if (choice.kind === 'account') {
        const sameClient = choice.toClient.clientid === entry.client.clientid;
        await submitAccountPayment({
          client: choice.toClient.clientid,
          amount: entry.payment,
          comments: sameClient
            ? `Paid at group check-in on ${date}; removed from the attendance sheet, so applied to the account.`
            : `Paid at group check-in on ${date}, entered under ${name} by mistake; moved to this account.`,
          createdBy,
          paymentMethod: entry.paymentMethod,
          paymentSubtype: entry.paymentMethod === 'Other' ? entry.paymentSubtype ?? null : null,
          paymentReference: entry.paymentMethod === 'Other' ? entry.paymentReference ?? null : null,
        });
        message = sameClient
          ? `${name} removed. The ${paid} payment was applied to their account.`
          : `${name} removed. The ${paid} payment was applied to ${toName}'s account; check them in and it shows as account credit.`;
      } else if (choice.kind === 'move-card') {
        for (const id of entry.cardTransactionIds ?? []) {
          await moveCardPayment(id, { fromClient: entry.client.clientid, toClient: choice.toClient.clientid, reason: `Wrong client checked in at group check-in on ${date}` });
        }
        message = `${name} removed. The ${paid} payment was moved to ${toName}'s account; check them in and it shows as account credit.`;
      } else if (choice.kind === 'keep-card') {
        message = `${name} removed. The ${paid} payment stays on their account as a credit.`;
      } else {
        message = `${name} removed. The ${paid} payment was not recorded; hand the money back.`;
      }
    } catch (err: unknown) {
      setSubmitting(false);
      notify.onError(err instanceof Error && err.message ? err.message : 'The payment could not be saved, so the client is still on the sheet. Try again.');
      return;
    }
    // A split payment's card part is already on the removed client's account and stays there
    if (!card && entry.cardPaid > 0) message += ` The $${entry.cardPaid.toFixed(2)} card part of their split payment stays on their account as a credit.`;

    // The case note typed in the Remove dialog goes on the removed client's case notes as a Therapist note. The money is
    // already settled, so a note that fails to save doesn't keep them on the sheet; the message says to add it by hand.
    const text = note.trim();
    let noteProblem = '';
    if (text) {
      try {
        await addClientNote(entry.client.clientid, { user: createdBy, comments: text, category: 'Therapist' });
        message += ' Therapist case note added.';
      } catch (err: unknown) {
        const reason = err instanceof Error && err.message ? ` (${err.message})` : '';
        noteProblem = ` The case note could not be saved${reason}; add it from their Case Notes: "${text}"`;
      }
    }

    const next = session.filter(e => e.client.clientid !== entry.client.clientid);
    setSession(next);
    setPendingRemoval(null);
    if (choice.kind === 'account' || choice.kind === 'move-card') {
      notify.onSaved?.();
      reloadRoster();
    }
    // A saved open check-in still lists the payment; update it now so it isn't recorded again when the group closes
    const saved = savedOpenGroup();
    try {
      if (saved && next.length > 0) {
        await saveOpenGroup({ group: groupId, date: sessionDate ?? todayLocal(), sessionNumber, entries: next, createdBy, coveredBy });
        notify.onOpenGroupsChanged?.();
      } else if (saved) {
        // The last client is off the sheet. The saved copy still lists their cash, which the server won't let a discard
        // lose; it's settled now (applied to an account or handed back), so clear it on the saved copy first.
        if (entry.payment > 0) {
          await saveOpenGroup({ group: groupId, date: sessionDate ?? todayLocal(), sessionNumber, entries: [{ ...entry, payment: 0 }], createdBy, coveredBy });
        }
        await deleteOpenGroup(saved.opensessionid, createdBy);
        notify.onOpenGroupsChanged?.();
      }
      if (noteProblem) notify.onError(`${message}${noteProblem}`);
      else notify.onSuccess(message);
    } catch (err: unknown) {
      const reason = err instanceof Error && err.message ? ` (${err.message})` : '';
      notify.onError(`${message} But the saved check-in could not be updated${reason}. ${next.length > 0 ? 'Press Save for Later now' : 'Discard it from Open Groups'} so the payment isn't recorded twice when the group closes.${noteProblem}`);
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRemoval = () => setPendingRemoval(null);

  // Called when an attendance receipt is printed: marks the client and saves the sheet as an open group right away, so the
  // lock holds even if this screen is left before the group is saved or closed. The sheet stays on screen.
  const markReceiptPrinted = async (clientId: number) => {
    if (groupId === null) return;
    const next = session.map(e => (e.client.clientid === clientId ? { ...e, receiptPrinted: true } : e));
    setSession(next);
    try {
      await saveOpenGroup({ group: groupId, date: sessionDate ?? todayLocal(), sessionNumber, entries: next, createdBy, coveredBy });
      notify.onOpenGroupsChanged?.();
    } catch (err: unknown) {
      const reason = err instanceof Error && err.message ? ` (${err.message})` : '';
      notify.onError(`The receipt was printed, but this check-in could not be saved${reason}. Press Save for Later or close the group so the attendance matches the receipt.`);
    }
  };

  const goToReview = () => {
    if (session.length === 0) return;
    setView('review');
  };

  const backToCheckIn = () => setView('checkin');

  // Close Group & Save Attendance. On a day that isn't the group's regular day it first asks about Group Reschedule notes
  // (if Finish Check-In didn't already, e.g. a sheet saved for later and reopened from Open Groups)
  const submitSession = async () => {
    if (groupId === null) return;
    const problem = validateSession(session, groupProgram);
    if (problem) {
      notify.onError(problem);
      return;
    }
    if (await askOffDay('close')) return;
    await closeGroup();
  };

  const closeGroup = async () => {
    if (groupId === null) return;
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
          paymentSubtype: e.paymentMethod === 'Other' ? e.paymentSubtype ?? null : null,
          paymentReference: e.paymentMethod === 'Other' ? e.paymentReference ?? null : null,
          voucherUsed: e.voucher,
          comments: e.comments.trim(),
          makeup: e.makeup,
          durationBand: e.durationBand,
        })),
      });
      const awarded = res.polyVouchersAwarded
        ? ` ${res.polyVouchersAwarded} client(s) earned a poly fee voucher (last polygraph NDI).`
        : '';
      // The server works each fee out from the account; say so where that differs from what the sheet showed
      const feeChanges = (res.feeChanges ?? [])
        .map(f => ` ${f.name} was charged $${f.feeCharged.toFixed(2)}, not $${f.feeSent.toFixed(2)} (${f.feeReason}).`)
        .join('');
      const notes = res.notesAdded ? ` ${res.notesAdded} comment(s) added to case notes as Therapist notes.` : '';
      notify.onSuccess(`Attendance saved for ${res.count} client(s).${notes}${awarded}${feeChanges}`);
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
    checkInOne,
    checkedInIds,
    attendedIds,
    addExternalClients,
    pendingCheckIn,
    confirmCheckIn,
    cancelCheckIn,
    session,
    updateEntry,
    removeEntry,
    pendingRemoval,
    resolveRemoval,
    cancelRemoval,
    markReceiptPrinted,
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
    offDayPrompt,
    answerOffDay,
    coveredBy,
    setCoveredBy,
    individualFee,
    setIndividualFee,
    groupProgram,
    setGroupProgram,
  };
}

export type GroupCheckInState = ReturnType<typeof useGroupCheckIn>;
