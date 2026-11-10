import React, { useCallback, useState, useEffect, useRef } from 'react';
import { 
  Users, ClipboardCheck, ShieldCheck, LogOut, AlertCircle, X, FileText, 
  DollarSign, Calendar, Activity, PhoneCall, ShieldAlert, 
  Layers, CheckSquare, BarChart3, Settings, Trash2, RotateCcw, Home, History,
  Paperclip, UserCheck, ClipboardList, SlidersHorizontal
} from 'lucide-react';
import {
  loginUser, logoutUser, setSessionEndedHandler, getClient, getClients, getGroups,
  getPolygraphSlots,
  deletePolygraphSlot,
  getClientAttendance, getClientFinancials,
  getClientNotes, getClientPolygraphs,
  deleteClient,
  getClientDeletable,
  getEmployees, fetchClientFeeOverride, fetchPolyFeeOverride,
  getOpenGroups, deleteOpenGroup, getClosedGroups, getSupervisingAgents
} from './api';
import type { ClientNote, ClosedGroupSession, OpenGroupSession, PolyFeeOverride, PolyFeeOverrideResult, SupervisingAgent } from './api';
import { todayLocal } from './hooks/useGroupCheckIn';
import GroupCheckInWorkflow from './components/attendance/GroupCheckInWorkflow';
import { formatBalance, toDisplayBalance } from './utils/balance';
import ClientPaymentDialog from './components/payments/ClientPaymentDialog';
import AccountPaymentForm from './components/payments/AccountPaymentForm';
import CustomChargeForm from './components/payments/CustomChargeForm';
import SupervisingAgentsTab from './components/agents/SupervisingAgentsTab';
import CallInTab from './components/callin/CallInTab';
import GroupsTab from './components/groups/GroupsTab';
import TestingTab from './components/testing/TestingTab';
import AdminTab from './components/admin/AdminTab';
import FormsTab from './components/forms/FormsTab';
import PolySlotForm from './components/polygraph/PolySlotForm';
import PolyResults from './components/polygraph/PolyResults';
import PolySchedule from './components/polygraph/PolySchedule';
import PolyCancelDialog from './components/polygraph/PolyCancelDialog';
import PolyRescheduleDialog from './components/polygraph/PolyRescheduleDialog';
import PolyAssignDialogs from './components/polygraph/PolyAssignDialogs';
import { usePolyAssignment } from './hooks/usePolyAssignment';
import ReportsTab from './components/reports/ReportsTab';
import ClientRoster from './components/clients/ClientRoster';
import ClientAttachments from './components/clients/ClientAttachments';
import ClientChangeLog from './components/clients/ClientChangeLog';
import ClientNotes from './components/clients/ClientNotes';
import ClientAttendanceHistory from './components/clients/ClientAttendanceHistory';
import ClientPolygraphs from './components/clients/ClientPolygraphs';
import ClientLedger from './components/clients/ClientLedger';
import TempFeeOverridePanel from './components/clients/TempFeeOverridePanel';
import PolyFeeOverridePanel from './components/clients/PolyFeeOverridePanel';
import PendingNotesButton from './components/clients/PendingNotesButton';
import EmployeeLabelProvider from './components/EmployeeLabelProvider';
import MainNav from './components/MainNav';
import BarTabs from './components/BarTabs';
import type { NavItem } from './components/BarTabs';
import ProgramStatusDialog from './components/clients/ProgramStatusDialog';
import ClientInfoForm from './components/clients/ClientInfoForm';
import type { LedgerRefresh } from './components/clients/ClientLedger';
import type { AttendanceDeleted } from './components/clients/ClientAttendanceHistory';
import AssessmentsIndividualsTab from './components/sessions/AssessmentsIndividualsTab';
import BipIntakePrompt from './components/sessions/BipIntakePrompt';
import ProgressTab from './components/sessions/ProgressTab';
import { UnsavedFormsContext } from './hooks/useUnsavedForm';
import { DISCHARGE_STATUSES } from './utils/clients';
import { scrollToStackedPanel } from './utils/layout';
import { polygraphHistoryText, polygraphNotice, slotStart, slotSummary, takesPolygraphs } from './utils/polygraph';

export default function App() {
  const [user, setUser] = useState<any>(null);
  // "Remember me" keeps only the email, in this browser on this PC. Passwords are never stored.
  const REMEMBERED_EMAIL_KEY = 'stop.rememberedEmail';
  const [rememberedEmail] = useState<string | null>(() => {
    try {
      return localStorage.getItem(REMEMBERED_EMAIL_KEY);
    } catch {
      return null;
    }
  });
  const [emailInput, setEmailInput] = useState(rememberedEmail ?? '');
  const [rememberMe, setRememberMe] = useState(rememberedEmail !== null);
  // A remembered email is shown masked (ju••••@hotmail.com) until the user picks a different account
  const [showRememberedEmail, setShowRememberedEmail] = useState(rememberedEmail !== null);
  const maskEmail = (email: string) => {
    const at = email.indexOf('@');
    if (at < 1) return '••••••';
    return `${email.slice(0, Math.min(2, at))}••••••${email.slice(at)}`;
  };
  const [passwordInput, setPasswordInput] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [clients, setClients] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Auto-clear success messages after 5 seconds
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  // Selected Client Details Drawer State
  const [selectedClientDetail, setSelectedClientDetail] = useState<any>(null);
  const [showClientPayment, setShowClientPayment] = useState(false);
  const [clientTab, setClientTab] = useState<'information' | 'progress' | 'attendance' | 'financials' | 'notes' | 'polygraphs' | 'attachments' | 'changelog'>('information');
  // The account page's scrolling area; switching tabs starts the new tab at the top
  const accountScrollRef = useRef<HTMLDivElement>(null);
  // The spot in the account header where the Information tab puts Edit Info
  const [accountActionsSlot, setAccountActionsSlot] = useState<HTMLDivElement | null>(null);
  // Unsaved work in the open account: changes on the Information tab, and any other form with something in progress.
  // Leaving then waits in leavePrompt. 'info' (Information tab) and 'notes' (Case Notes edits and deletions) are those
  // tabs' own prompts, which can save; 'other' can only discard, since each of those forms has its own save button and rules.
  const accountEditsDirty = useRef(false);
  const setAccountEditsDirty = useCallback((dirty: boolean) => { accountEditsDirty.current = dirty; }, []);
  const notesEditsDirty = useRef(false);
  const setNotesEditsDirty = useCallback((dirty: boolean) => { notesEditsDirty.current = dirty; }, []);
  const unsavedFormCount = useRef(0);
  const reportUnsavedForm = useCallback((change: 1 | -1) => { unsavedFormCount.current += change; }, []);
  type LeaveKind = 'info' | 'notes' | 'other';
  const [leavePrompt, setLeavePrompt] = useState<{ leave: () => void; kind: LeaveKind } | null>(null);
  // The first prompt still owed after `after` (in the order info, notes, other), or null when nothing is unsaved
  const nextLeaveKind = (after: LeaveKind | null): LeaveKind | null => {
    const order: LeaveKind[] = ['info', 'notes', 'other'];
    const pending = { info: accountEditsDirty.current, notes: notesEditsDirty.current, other: unsavedFormCount.current > 0 };
    return order.slice(after ? order.indexOf(after) + 1 : 0).find(k => pending[k]) ?? null;
  };
  const leaveAccountEdits = useCallback((leave: () => void) => {
    const kind = nextLeaveKind(null);
    if (kind) setLeavePrompt({ leave, kind });
    else leave();
  // nextLeaveKind only reads refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const resolveLeavePrompt = (leave: boolean) => {
    const next = leave && leavePrompt ? nextLeaveKind(leavePrompt.kind) : null;
    if (next && leavePrompt) {
      setLeavePrompt({ leave: leavePrompt.leave, kind: next });
      return;
    }
    if (leave) leavePrompt?.leave();
    setLeavePrompt(null);
  };
  const [clientAttendance, setClientAttendance] = useState<any[]>([]);
  const [clientFinancials, setClientFinancials] = useState<any[]>([]);
  const [clientNotes, setClientNotes] = useState<any[]>([]);
  const [clientPolygraphs, setClientPolygraphs] = useState<any[]>([]);
  // Client whose polygraphs are loaded, so the notice never uses the previous client's results
  const [clientPolygraphsFor, setClientPolygraphsFor] = useState<number | null>(null);
  // When the open account's polygraphs were loaded; tells a booked slot that is still upcoming from one awaiting results
  const [clientPolygraphsAt, setClientPolygraphsAt] = useState(() => Date.now());
  // Shown at the top of the Information tab when part of the account could not be loaded
  const [accountLoadError, setAccountLoadError] = useState('');
  const [clientFeeOverride, setClientFeeOverride] = useState<any>(null);
  // Temporary poly fee override: a reduced poly fee for a number of fills
  const [clientPolyOverride, setClientPolyOverride] = useState<PolyFeeOverride | null>(null);
  // Shown on the poly fee override panel when the override could not be loaded
  const [polyOverrideLoadError, setPolyOverrideLoadError] = useState('');

  // Attendance State
  const [isAccountOnly, setIsAccountOnly] = useState(false);
  // Custom fee charge (Business Administrators only)
  const [isCustomCharge, setIsCustomCharge] = useState(false);
  // Group check-ins saved with Finish Check-In and not yet closed
  const [openGroups, setOpenGroups] = useState<OpenGroupSession[]>([]);
  const [openGroupsError, setOpenGroupsError] = useState('');
  // Closed group sessions shown on the panel's Closed tab; the expanded one lists its clients
  const [groupPanelTab, setGroupPanelTab] = useState<'open' | 'closed'>('open');
  const [closedGroups, setClosedGroups] = useState<ClosedGroupSession[]>([]);
  const [closedGroupsError, setClosedGroupsError] = useState('');
  const [expandedClosedGroup, setExpandedClosedGroup] = useState<string | null>(null);
  // Open group picked in the Open Groups panel, handed to the check-in workflow to load
  const [resumeRequest, setResumeRequest] = useState<OpenGroupSession | null>(null);
  // Closed group picked in the Closed Groups panel for missed check-ins (Business Administrators)
  const [missedCheckInRequest, setMissedCheckInRequest] = useState<ClosedGroupSession | null>(null);

  // Group check-in panel; on phones the Open Groups list sits below it, so picking a group scrolls back up to it
  const checkInPanelRef = useRef<HTMLDivElement>(null);

  // Bumped when a case note goes to or comes out of approval, so the Notes to Approve count reloads
  const [pendingNotesKey, setPendingNotesKey] = useState(0);
  const refreshPendingNotes = () => setPendingNotesKey(k => k + 1);

  // Polygraph State
  const [polySubTab, setPolySubTab] = useState<'admin' | 'schedule' | 'results'>('schedule');
  // Filter row is hidden until toggled; the choice is remembered in this browser. Filters still apply while hidden.
  const [showPolyFilters, setShowPolyFilters] = useState(() => {
    try { return localStorage.getItem('showPolyFilters') === 'true'; } catch { return false; }
  });
  const togglePolyFilters = () => setShowPolyFilters(show => {
    try { localStorage.setItem('showPolyFilters', String(!show)); } catch { /* storage unavailable */ }
    return !show;
  });
  // Poly Schedule and Poly Results filters; '' means no filter. Dates are YYYY-MM-DD, inclusive.
  const [polyExaminerFilter, setPolyExaminerFilter] = useState('');
  const [polyLocationFilter, setPolyLocationFilter] = useState('');
  const [polyDateFrom, setPolyDateFrom] = useState('');
  const [polyDateTo, setPolyDateTo] = useState('');
  // Poly Schedule only: '', 'Open', 'Assigned', or 'Closed'
  const [polyStatusFilter, setPolyStatusFilter] = useState('');
  const [polyDateSort, setPolyDateSort] = useState<'asc' | 'desc'>('asc');
  const [polySlots, setPolySlots] = useState<any[]>([]);
  // Slot opened from a client's account; outlined on the Poly Schedule for a few seconds
  const [highlightedSlotId, setHighlightedSlotId] = useState<number | null>(null);
  
  // Assigned slot whose reservation is being cancelled (PolyCancelDialog)
  const [reopenTarget, setReopenTarget] = useState<any>(null);
  // Open or assigned slot being moved (PolyRescheduleDialog)
  const [rescheduleTarget, setRescheduleTarget] = useState<any>(null);

  // Inactive groups stay in the directory but are hidden from every picker for new assignments and sessions
  const activeGroups = groups.filter(g => g.active !== false);

  // Employee accounts: managed on the Admin tab, also used for examiner names and counselor pickers
  const [employees, setEmployees] = useState<any[]>([]);
  // Active counselors, for a client's Assessor
  const counselorNames: string[] = employees.filter(e => e.role === 'Counselor' && e.active !== false && e.displayname)
    .map(e => e.displayname).sort((a, b) => a.localeCompare(b));
  // Supervising agent directory, suggested in the client forms' agent field
  const [directoryAgents, setDirectoryAgents] = useState<SupervisingAgent[]>([]);

  // The server refused the session (expired after 12 hours, or the account was changed): back to the login screen
  useEffect(() => {
    setSessionEndedHandler(() => {
      setUser(null);
      setError('Your session has ended. Please log in again.');
      setLeavePrompt(null);
    });
    return () => setSessionEndedHandler(null);
  }, []);

  const handleLogout = async () => {
    await logoutUser();
    setUser(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await loginUser(emailInput, passwordInput);
      if (res.success) {
        try {
          if (rememberMe) {
            localStorage.setItem(REMEMBERED_EMAIL_KEY, emailInput);
          } else {
            localStorage.removeItem(REMEMBERED_EMAIL_KEY);
          }
        } catch {
          // Storage can be blocked (private window, site data cleared); login still works without it
        }
        // What the login screen shows after logging out: the masked email if remembered, otherwise nothing
        setShowRememberedEmail(rememberMe);
        if (!rememberMe) setEmailInput('');
        setPasswordInput('');
        setUser(res.user);
        setError('');
        loadDashboardData();
      } else {
        setError(res.error || 'Login failed.');
      }
    } catch {
      setError('Server connection error. Ensure backend is running.');
    }
  };

  const loadDashboardData = async () => {
    try {
      const [clientData, groupData, slotData, empData] = await Promise.all([
        getClients(), getGroups(), getPolygraphSlots(), getEmployees()
      ]);
      setClients(clientData);
      setGroups(groupData);
      setPolySlots(slotData);
      setEmployees(empData);
    } catch (err) {
      console.error('Failed to load data', err);
    }
    // Loaded on its own so an agent directory problem never blocks the rest of the dashboard
    try {
      setDirectoryAgents(await getSupervisingAgents());
    } catch (err) {
      console.error('Failed to load supervising agents', err);
    }
  };

  // While the Polygraphs tab is open, refresh slots every minute so open slots whose time has passed
  // (deleted by the server when slots are listed) drop off the schedule
  useEffect(() => {
    if (activeTab !== 'polygraph') return;
    const timer = setInterval(async () => {
      try {
        const freshSlots = await getPolygraphSlots();
        if (Array.isArray(freshSlots)) setPolySlots(freshSlots);
      } catch (err) {
        console.error('Failed to refresh polygraph slots', err);
      }
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [activeTab]);

  const loadOpenGroups = async () => {
    try {
      setOpenGroups(await getOpenGroups(user.employeeemail));
      setOpenGroupsError('');
    } catch (err: any) {
      setOpenGroupsError(err.message || 'Failed to load open groups.');
    }
    // Closing an open group moves it to the Closed tab, so both lists refresh together
    try {
      setClosedGroups(await getClosedGroups(user.employeeemail));
      setClosedGroupsError('');
    } catch (err: any) {
      setClosedGroupsError(err.message || 'Failed to load closed groups.');
    }
  };

  useEffect(() => {
    // loadOpenGroups only sets state after its requests finish
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user && activeTab === 'attendance') loadOpenGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTab]);

  // Polygraph slot assignment, shared by the Poly Schedule cards and the client account's Schedule Polygraph
  const polyAssign = usePolyAssignment({
    role: user?.role ?? '',
    userEmail: user?.employeeemail ?? '',
    clients,
    setClients,
    setPolySlots,
    onAssigned: (freshClients) => {
      // Scheduled from the client's account: show the booking and the spent vouchers there too
      setSelectedClientDetail((c: any) => (c ? { ...c, ...(freshClients.find((fc: any) => fc.clientid === c.clientid) ?? {}) } : c));
    },
    onSuccess: setSuccessMsg,
    onError: setError,
  });

  // Opens the cancellation prompt; the reservation is only cancelled when it is submitted
  const handleReopenSlot = (slotId: number) => {
    setReopenTarget(polySlots.find(s => s.slotid === slotId) || { slotid: slotId });
  };

  const handleReservationCancelled = async (reopened: boolean) => {
    setReopenTarget(null);
    setSuccessMsg(reopened
      ? 'Reservation cancelled. Polygraph slot is now open for new bookings!'
      : 'Reservation cancelled. The appointment time has passed, so the slot was closed instead of reopened.');
    // Clients are reloaded too: cancelling can return the booking's poly fee vouchers
    const [freshSlots, freshClients] = await Promise.all([getPolygraphSlots(), getClients()]);
    setPolySlots(freshSlots);
    setClients(freshClients);
  };

  const handleDeleteSlot = async (slotId: number) => {
    if (!window.confirm('Are you sure you want to delete this open polygraph slot?')) {
      return;
    }
    setLoading(true);
    try {
      await deletePolygraphSlot(slotId);
      setSuccessMsg('Open polygraph slot deleted successfully!');
      setPolySlots(await getPolygraphSlots());
    } catch (err: any) {
      setError(err.message || 'Failed to delete slot.');
    } finally {
      setLoading(false);
    }
  };

  // Asked after a client is created as BIP or switched to BIP: open a BIP Intake or DV Assessment, or none
  const [bipIntakePrompt, setBipIntakePrompt] = useState<{ clientid: number; name: string; groupCounselor?: string | null } | null>(null);
  const counselorOfGroup = (groupid: unknown) => groups.find(g => String(g.groupid) === String(groupid ?? ''))?.counselor ?? null;

  // A client was added from the roster: a new BIP client is asked about a BIP Intake or DV Assessment
  const handleClientCreated = (created: { clientId: number; name: string; programtype: string; groupid: string }) => {
    if (created.programtype === 'BIP') {
      setBipIntakePrompt({ clientid: created.clientId, name: created.name, groupCounselor: counselorOfGroup(created.groupid) });
    }
    loadDashboardData();
  };

  // No Poly Required was saved from the account's Polygraphs tab
  const handleNoPolyRequiredSaved = async (saved: boolean) => {
    if (!selectedClientDetail) return;
    const clientid = selectedClientDetail.clientid;
    setSelectedClientDetail((c: any) => (c && c.clientid === clientid ? { ...c, nopolyrequired: saved } : c));
    setClients(prev => prev.map(c => c.clientid === clientid ? { ...c, nopolyrequired: saved } : c));
    setSuccessMsg(`No Poly Required ${saved ? 'checked' : 'unchecked'} for ${selectedClientDetail.firstname} ${selectedClientDetail.lastname}.`);
    setClientNotes(await getClientNotes(clientid));
  };

  // A bus pass was granted on the Information tab: new count on the account and roster, and its note on Case Notes
  const handleBusPassGranted = (busPasses: number, note: ClientNote) => {
    if (!selectedClientDetail) return;
    const clientid = selectedClientDetail.clientid;
    setSelectedClientDetail((c: typeof selectedClientDetail) => (c && c.clientid === clientid ? { ...c, buspasses: busPasses } : c));
    setClients(prev => prev.map(c => c.clientid === clientid ? { ...c, buspasses: busPasses } : c));
    setClientNotes(prev => [note, ...prev]);
    setSuccessMsg(`Bus pass granted to ${selectedClientDetail.firstname} ${selectedClientDetail.lastname}. ${busPasses} left.`);
  };

  // The open account's Delete button shows only for Business Administrators and only when the server says the client can
  // be deleted (nothing kept on record points at them). Checked again when the account's notes change.
  const [deletableClientId, setDeletableClientId] = useState<number | null>(null);
  const openClientId: number | null = selectedClientDetail?.clientid ?? null;
  const isBusinessAdmin = user?.role === 'Business Administrator';
  useEffect(() => {
    if (openClientId === null || !isBusinessAdmin) return;
    let cancelled = false;
    getClientDeletable(openClientId)
      .then(ok => { if (!cancelled) setDeletableClientId(ok ? openClientId : null); })
      .catch(() => { if (!cancelled) setDeletableClientId(null); });
    return () => { cancelled = true; };
  }, [openClientId, isBusinessAdmin, clientNotes.length]);

  // A discharged client's program status is locked; only the Activate button changes it
  const clientIsDischarged = DISCHARGE_STATUSES.includes(selectedClientDetail?.programstatus);

  // Program status dialog: Discharge (Business Administrators only) or Activate (any account type, discharged clients only)
  const [statusDialog, setStatusDialog] = useState<'discharge' | 'activate' | null>(null);
  // The dialog saved a new program status: update the client everywhere and reload what the change wrote
  const handleProgramStatusChanged = async (programstatus: string) => {
    const clientid = selectedClientDetail.clientid;
    setSelectedClientDetail((c: any) => (c && c.clientid === clientid ? { ...c, programstatus } : c));
    setClients(prev => prev.map(c => c.clientid === clientid ? { ...c, programstatus } : c));
    // The list holds current clients only: a reactivated client joins it and a discharged one leaves it
    getClients().then(setClients).catch(err => console.error('Failed to refresh clients', err));
    const notes = await getClientNotes(clientid);
    // Skip if another account was opened while it saved
    if (openClientIdRef.current !== clientid) return;
    setClientNotes(notes);
    // Reload the Attachments and Change Log tabs: discharging saves a discharge summary PDF, and both log the change
    setAccountTabsVersion(v => v + 1);
  };

  // Edit Info saved: update the client everywhere; a client just moved to BIP is asked about a BIP Intake or DV Assessment
  const handleClientInfoSaved = (saved: any, previousProgramType: string | null) => {
    setSelectedClientDetail((c: any) => (c && c.clientid === saved.clientid ? saved : c));
    setClients(prev => prev.map(c => c.clientid === saved.clientid ? { ...c, ...saved } : c));
    if (saved.programtype === 'BIP' && previousProgramType !== 'BIP') {
      setBipIntakePrompt({ clientid: saved.clientid, name: `${saved.lastname}, ${saved.firstname}`, groupCounselor: counselorOfGroup(saved.groupid) });
    }
  };

  // Drawer Log Loading
  const openClientLogs = async (client: any) => {
    setStatusDialog(null);
    setSelectedClientDetail(client);
    setClientTab('information');
    setAccountLoadError('');
    setClientFeeOverride(null);
    setClientPolyOverride(null);
    setPolyOverrideLoadError('');
    const [att, fin, notes, polys] = await Promise.all([
      getClientAttendance(client.clientid),
      getClientFinancials(client.clientid),
      getClientNotes(client.clientid),
      getClientPolygraphs(client.clientid)
    ]);
    setClientAttendance(att);
    setClientFinancials(fin);
    setClientNotes(notes);
    setClientPolygraphs(polys);
    setClientPolygraphsFor(client.clientid);
    setClientPolygraphsAt(Date.now());
    try {
      const { override } = await fetchClientFeeOverride(client.clientid);
      setClientFeeOverride(override);
    } catch (err: any) {
      setAccountLoadError(err.message || 'Could not load the temporary fee override.');
    }
    try {
      const { override } = await fetchPolyFeeOverride(client.clientid);
      setClientPolyOverride(override);
    } catch (err: any) {
      setPolyOverrideLoadError(err.message || 'Could not load the poly fee override.');
    }
  };

  // Opens an account by id. The client list holds current clients only, so a discharged client is loaded first.
  const openClientById = async (clientId: number) => {
    try {
      openClientLogs(clients.find(c => c.clientid === clientId) ?? await getClient(clientId));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to load the client.');
    }
  };

  // Poly fields changed by a poly fee override; applied to the open client and the client list
  const applyPolyOverrideResult = (clientid: number, res: PolyFeeOverrideResult) => {
    const changes = { polyfeepaid: res.polyFeePaid, polyfee: res.polyFee, polyfeevoucher: res.polyFeeVoucher };
    setSelectedClientDetail((c: any) => (c && c.clientid === clientid ? { ...c, ...changes } : c));
    setClients(prev => prev.map(c => c.clientid === clientid ? { ...c, ...changes } : c));
  };

  // Bumped after a program status change so the Attachments and Change Log tabs reload if showing
  const [accountTabsVersion, setAccountTabsVersion] = useState(0);

  // A payment was corrected on the ledger: update the client and reload what the change moved
  const handleLedgerPaymentChanged = ({ clientId, changes, attendance, financials, polyOverride }: LedgerRefresh) => {
    setSelectedClientDetail((c: any) => (c && c.clientid === clientId ? { ...c, ...changes } : c));
    setClients(prev => prev.map(c => c.clientid === clientId ? { ...c, ...changes } : c));
    // The reloaded rows belong to that client; skip them if another account was opened meanwhile
    if (openClientIdRef.current !== clientId) return;
    setClientAttendance(attendance);
    setClientFinancials(financials);
    setClientPolyOverride(polyOverride);
  };

  // An attendance was deleted on the Attendance tab: update the client, reload the account's lists, and the closed
  // groups it may have been part of
  const handleAttendanceDeleted = ({ clientId, changes, attendance, financials }: AttendanceDeleted) => {
    setSelectedClientDetail((c: { clientid: number } | null) => (c && c.clientid === clientId ? { ...c, ...changes } : c));
    setClients(prev => prev.map(c => c.clientid === clientId ? { ...c, ...changes } : c));
    loadOpenGroups();
    if (openClientIdRef.current !== clientId) return;
    setClientAttendance(attendance);
    setClientFinancials(financials);
  };

  // The account open right now, for saves that finish after the user may have moved to another client
  const openClientIdRef = useRef<number | null>(null);
  useEffect(() => {
    openClientIdRef.current = selectedClientDetail?.clientid ?? null;
  }, [selectedClientDetail]);

  // The page behind an open account doesn't scroll or show its scrollbar. Checks user too: an expired session swaps the
  // account for the login screen with the client still selected.
  const accountOpen = !!user && !!selectedClientDetail;
  useEffect(() => {
    if (!accountOpen) return;
    document.documentElement.style.overflow = 'hidden';
    return () => { document.documentElement.style.overflow = ''; };
  }, [accountOpen]);

  // Back (the phone's button or swipe) closes the account instead of leaving the app, and asks first if there's unsaved
  // work. It does nothing while a dialog is over the account, so a payment being entered isn't dropped. Refreshing or
  // closing the browser tab gets the browser's own warning.
  const accountDialogOpen = useRef(false);
  useEffect(() => {
    accountDialogOpen.current = showClientPayment || statusDialog !== null;
  }, [showClientPayment, statusDialog]);
  useEffect(() => {
    if (!accountOpen) return;
    const unsavedWork = () => accountEditsDirty.current || notesEditsDirty.current || unsavedFormCount.current > 0;
    const entry = { stopAccount: true };
    window.history.pushState(entry, '');
    const onBack = () => {
      if (accountDialogOpen.current || unsavedWork()) window.history.pushState(entry, '');
      if (!accountDialogOpen.current) leaveAccountEdits(() => setSelectedClientDetail(null));
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (unsavedWork()) e.preventDefault();
    };
    window.addEventListener('popstate', onBack);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('popstate', onBack);
      window.removeEventListener('beforeunload', onUnload);
      // Closed some other way: take back the history entry added above
      if (window.history.state?.stopAccount) window.history.back();
    };
  }, [accountOpen, leaveAccountEdits]);

  // Scrolls to and briefly outlines a slot opened from a client's account. Kept above the sign-in return so the hook count never changes.
  useEffect(() => {
    if (highlightedSlotId === null || activeTab !== 'polygraph') return;
    document.getElementById(`poly-slot-${highlightedSlotId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setHighlightedSlotId(null), 4000);
    return () => clearTimeout(timer);
  }, [highlightedSlotId, activeTab]);

  if (!user) {
    return (
      <div className="min-h-dvh bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6 sm:p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-white tracking-wide">STOP System</h1>
            <p className="text-slate-400 text-sm mt-1">Chandler & Associates Management</p>
          </div>
          {error && <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-lg mb-4 text-sm flex items-center gap-2"><AlertCircle size={18} /> {error}</div>}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Employee Email</label>
              {showRememberedEmail ? (
                <div className="flex items-center justify-between gap-2 w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm">
                  <span className="text-white truncate" aria-label="Remembered email (hidden)">{maskEmail(emailInput)}</span>
                  <button type="button" onClick={() => { setShowRememberedEmail(false); setEmailInput(''); }} className="text-xs text-blue-400 hover:text-blue-300 shrink-0">Use a different account</button>
                </div>
              ) : (
                <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} autoComplete="username" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 text-sm" required />
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Password</label>
              <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} autoComplete="current-password" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 text-sm" required />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="rounded accent-blue-500" />
              Remember me on this device
            </label>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-lg transition text-sm shadow-lg shadow-blue-600/30">Secure Login</button>
          </form>
        </div>
      </div>
    );
  }

  // Role Permissions
  const role = user.role;
  const isAllowed = (tab: string) => {
    if (role === 'Office Admin' || role === 'Business Administrator') return true;
    // Reports holds only the Cash Deposits report for them
    if (role === 'Counselor' || role === 'Therapist') return ['clients', 'attendance', 'sessions', 'callin', 'polygraph', 'groups', 'testing', 'reports', 'agents', 'forms'].includes(tab);
    if (role === 'Polygrapher') return ['polygraph', 'forms'].includes(tab);
    // Unknown roles get no sections, rather than full access
    return false;
  };

  // Every section, in tab bar order; Home is open to all roles
  const navItems: NavItem[] = [
    { tab: 'home', icon: Home, label: 'Home' },
    { tab: 'clients', icon: Users, label: 'Client Roster', shortLabel: 'Clients' },
    { tab: 'attendance', icon: ClipboardCheck, label: 'Attendance & Sign-In', shortLabel: 'Attendance' },
    { tab: 'sessions', icon: ClipboardList, label: 'Assessments & Individuals', shortLabel: 'Assessments' },
    { tab: 'callin', icon: PhoneCall, label: 'Call-In Log', shortLabel: 'Call-In' },
    { tab: 'groups', icon: Layers, label: 'Groups' },
    { tab: 'testing', icon: CheckSquare, label: 'Testing' },
    { tab: 'polygraph', icon: ShieldAlert, label: 'Polygraphs' },
    { tab: 'reports', icon: BarChart3, label: 'Reports' },
    { tab: 'agents', icon: UserCheck, label: 'Supervising Agents', shortLabel: 'Agents' },
    { tab: 'forms', icon: FileText, label: 'Forms' },
    { tab: 'admin', icon: Settings, label: 'Admin' },
  ].filter(item => item.tab === 'home' || isAllowed(item.tab));

  const getExaminerDisplayName = (email: string) =>
    employees.find(e => e.employeeemail === email)?.displayname || email;

  // Examiner filter choices: every examiner with a slot on the schedule, listed by name
  const polyExaminerChoices = Array.from(new Set(polySlots.map(s => s.polygrapher).filter(Boolean) as string[]))
    .map(email => ({ email, name: getExaminerDisplayName(email) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const polyLocationChoices = Array.from(new Set(polySlots.map(s => s.location).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  const polyFiltersActive = !!(polyExaminerFilter || polyLocationFilter || polyDateFrom || polyDateTo);
  // Shown on the Filters button so hidden filters aren't forgotten; Status only applies to Poly Schedule
  const polyFilterCount = [polyExaminerFilter, polyLocationFilter, polyDateFrom, polyDateTo, polySubTab === 'schedule' ? polyStatusFilter : ''].filter(Boolean).length;
  const examinerSlots = polySlots.filter(s => {
    const day = String(s.date || '').split('T')[0];
    if (polyExaminerFilter && s.polygrapher !== polyExaminerFilter) return false;
    if (polyLocationFilter && s.location !== polyLocationFilter) return false;
    if (polyDateFrom && day < polyDateFrom) return false;
    if (polyDateTo && day > polyDateTo) return false;
    return true;
  }).sort((a, b) => {
    // By appointment date and time; slots without a readable time go last
    const ta = slotStart(a)?.getTime() ?? Infinity;
    const tb = slotStart(b)?.getTime() ?? Infinity;
    if (ta === tb) return 0;
    if (ta === Infinity) return 1;
    if (tb === Infinity) return -1;
    return polyDateSort === 'asc' ? ta - tb : tb - ta;
  });

  // Filter assigned slots for Poly Results tab
  const assignedSlots = examinerSlots.filter(s => s.status === 'Assigned' || s.assignedClientId);

  // Poly Schedule also filters by slot status; the counts are for the slots the other filters leave
  const POLY_SLOT_STATUSES = ['Open', 'Assigned', 'Closed'];
  const slotStatus = (s: { status?: string | null }) => s.status || 'Open';
  const polyStatusCounts = Object.fromEntries(POLY_SLOT_STATUSES.map(st => [st, examinerSlots.filter(s => slotStatus(s) === st).length]));
  const scheduleSlots = polyStatusFilter ? examinerSlots.filter(s => slotStatus(s) === polyStatusFilter) : examinerSlots;
  const scheduleFiltersActive = polyFiltersActive || !!polyStatusFilter;
  const clearPolyFilters = () => {
    setPolyExaminerFilter('');
    setPolyLocationFilter('');
    setPolyDateFrom('');
    setPolyDateTo('');
    setPolyStatusFilter('');
  };

  // The polygraph slot a client is booked into, if any
  const assignedSlotFor = (clientId: number) =>
    polySlots.find(s => s.status === 'Assigned' && Number(s.assignedClientId) === Number(clientId)) ?? null;

  // Leaves the client account for the Poly Schedule with filters cleared, so the slot is in the list, and outlines it
  const openPolySlot = (slotId: number) => {
    setSelectedClientDetail(null);
    clearPolyFilters();
    setPolySubTab('schedule');
    setActiveTab('polygraph');
    setHighlightedSlotId(slotId);
  };

  // The tabs of the open client's account
  const clientTabItems: NavItem[] = [
    { tab: 'information', icon: Users, label: 'Information', shortLabel: 'Info' },
    { tab: 'progress', icon: ClipboardList, label: 'Progress' },
    { tab: 'attendance', icon: Calendar, label: 'Attendance' },
    { tab: 'financials', icon: DollarSign, label: 'Financial Ledger', shortLabel: 'Ledger' },
    { tab: 'notes', icon: FileText, label: 'Case Notes', shortLabel: 'Notes' },
    { tab: 'polygraphs', icon: Activity, label: 'Polygraphs' },
    { tab: 'attachments', icon: Paperclip, label: 'Attachments' },
    { tab: 'changelog', icon: History, label: 'Change Log' },
  ].filter(item => (item.tab !== 'polygraphs' || takesPolygraphs(selectedClientDetail?.programtype))
    && (item.tab !== 'changelog' || role === 'Business Administrator'));

  return (
    <EmployeeLabelProvider employees={employees}>
    <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header Navigation */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 md:px-6 md:py-4 flex justify-between items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="bg-blue-600/20 border border-blue-500/30 p-1.5 md:p-2 rounded-lg text-blue-400 shrink-0"><ShieldCheck size={24} /></div>
          <div className="min-w-0">
            <h1 className="font-bold text-base md:text-lg text-white truncate">STOP Software Suite</h1>
            <p className="text-xs text-slate-400 truncate">Chandler & Associates — {user.location}</p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-sm font-medium text-white">{user.displayname}</p>
            <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20 font-semibold">{user.role}</span>
          </div>
          <button onClick={handleLogout} className="bg-slate-800 hover:bg-slate-700 p-2 rounded-lg text-slate-400 hover:text-white transition"><LogOut size={18} /></button>
        </div>
      </header>

      {/* Main Navigation */}
      <MainNav items={navItems} activeTab={activeTab} onSelect={setActiveTab} user={user} onLogout={handleLogout} />

      {/* Main Content Area */}
      {/* Bottom padding keeps the end of each page clear of the tab bar when it sits at the bottom */}
      <main className="flex-1 p-4 pb-24 md:p-6 md:pb-24 tabs-top:pb-4 md:tabs-top:pb-6 max-w-7xl mx-auto w-full min-w-0">
        {/* On phones these stay on screen, since the save button is often a long scroll below the top of the page */}
        {successMsg && (
          <div className="max-md:sticky max-md:top-2 tabs-top:max-md:top-16 max-md:z-30 max-md:bg-slate-950 rounded-xl mb-4 md:mb-6">
            <div className="bg-emerald-500/10 border border-emerald-500 text-emerald-400 p-4 rounded-xl text-sm flex justify-between items-center">
              <span>{successMsg}</span>
              <button onClick={() => setSuccessMsg('')} className="text-emerald-400 hover:text-emerald-200 ml-4"><X size={16} /></button>
            </div>
          </div>
        )}
        {error && (
          <div className="max-md:sticky max-md:top-2 tabs-top:max-md:top-16 max-md:z-30 max-md:bg-slate-950 rounded-xl mb-4 md:mb-6">
            <div className="bg-red-500/10 border border-red-500 text-red-400 p-4 rounded-xl text-sm flex justify-between items-center">
              <span>{error}</span>
              <button onClick={() => setError('')} className="text-red-400 hover:text-red-200 ml-4"><X size={16} /></button>
            </div>
          </div>
        )}

        {/* CLIENT DIRECTORY TAB */}
        {activeTab === 'home' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Welcome, {user.displayname}</h2>
              <p className="text-sm text-slate-400 mt-1">Here's a quick overview. Choose a section below to get started.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Current Clients</p>
                <p className="text-3xl font-bold text-white mt-2">{clients.length}</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Active Groups</p>
                <p className="text-3xl font-bold text-white mt-2">{activeGroups.length}</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Clients Not in a Group</p>
                <p className="text-3xl font-bold text-white mt-2">{clients.filter(c => !c.groupid).length}</p>
              </div>
            </div>

            <div>
              <h3 className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-3">Sections</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[
                  { tab: 'clients', icon: Users, label: 'Client Roster', description: 'Search and manage client records, balances, and notes.' },
                  { tab: 'attendance', icon: ClipboardCheck, label: 'Attendance & Sign-In', description: 'Record group sessions and account payments.' },
                  { tab: 'sessions', icon: ClipboardList, label: 'Assessments & Individuals', description: 'Record one-client assessments and individual sessions with payments.' },
                  { tab: 'callin', icon: PhoneCall, label: 'Call-In Log', description: 'Log client and group call-ins.' },
                  { tab: 'groups', icon: Layers, label: 'Groups', description: 'Manage group schedules, counselors, and rosters.' },
                  { tab: 'testing', icon: CheckSquare, label: 'Testing', description: 'Record and review test results.' },
                  { tab: 'polygraph', icon: ShieldAlert, label: 'Polygraphs', description: 'Schedule polygraph slots and record results.' },
                  { tab: 'reports', icon: BarChart3, label: 'Reports', description: role === 'Counselor' || role === 'Therapist' ? 'Group cash deposits you hold.' : 'Agent, income, and deposit reports.' },
                  { tab: 'agents', icon: UserCheck, label: 'Supervising Agents', description: 'Probation officer contacts and their assigned clients.' },
                  { tab: 'admin', icon: Settings, label: 'Admin', description: 'Employees, roles, and system logs.' },
                ].filter(s => isAllowed(s.tab)).map(s => (
                  <button key={s.tab} onClick={() => setActiveTab(s.tab)} className="text-left bg-slate-900 hover:bg-slate-800/70 border border-slate-800 hover:border-slate-700 rounded-xl p-5 transition">
                    <div className="flex items-center gap-2 text-blue-400">
                      <s.icon size={18} />
                      <span className="font-semibold text-white">{s.label}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">{s.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {isAllowed('clients') && (
          // Stays mounted while another tab is showing so the roster's search, filters, and New Client form are kept
          <div className={activeTab === 'clients' ? '' : 'hidden'}>
            <ClientRoster
              clients={clients}
              activeGroups={activeGroups}
              directoryAgents={directoryAgents}
              userEmail={user.employeeemail}
              onOpenClient={openClientLogs}
              onCreated={handleClientCreated}
              onSuccess={setSuccessMsg}
              onError={setError}
              headerActions={role === 'Business Administrator' && (
                <PendingNotesButton
                  userEmail={user.employeeemail}
                  refreshKey={pendingNotesKey}
                  onOpenClient={openClientById}
                  onChanged={refreshPendingNotes}
                  onSuccess={setSuccessMsg}
                />
              )}
            />
          </div>
        )}

        {activeTab === 'agents' && (
          <SupervisingAgentsTab
            clients={clients}
            user={user}
            dischargeStatuses={DISCHARGE_STATUSES}
            onOpenClient={openClientLogs}
            onSuccess={setSuccessMsg}
            onError={setError}
            onAgentsLoaded={setDirectoryAgents}
            onClientsChanged={async () => {
              try {
                setClients(await getClients());
              } catch (err) {
                console.error('Failed to refresh clients', err);
              }
            }}
          />
        )}

        {/* Account payment from the client details drawer (Cash or Credit Card) */}
        {selectedClientDetail && showClientPayment && (
          <ClientPaymentDialog
            client={selectedClientDetail}
            balance={Number(selectedClientDetail.accountbalance) || 0}
            noteLabel="Account payment"
            createdBy={user.employeeemail}
            onClose={() => setShowClientPayment(false)}
            onSuccess={setSuccessMsg}
            onError={setError}
            onProcessed={async (newBalance, polyFeePaid, polyFeeVoucher) => {
              const clientid = selectedClientDetail.clientid;
              const changes = { accountbalance: newBalance, polyfeepaid: polyFeePaid, polyfeevoucher: polyFeeVoucher };
              setSelectedClientDetail((c: any) => (c && c.clientid === clientid ? { ...c, ...changes } : c));
              setClients(prev => prev.map(c => c.clientid === clientid ? { ...c, ...changes } : c));
              try {
                setClientFinancials(await getClientFinancials(clientid));
                // A poly fee payment can use up a fill of the poly fee override
                setClientPolyOverride((await fetchPolyFeeOverride(clientid)).override);
              } catch {
                // The payment is saved; the ledger refreshes the next time the client is opened
              }
            }}
          />
        )}

        {/* CLIENT DETAILS DRAWER */}
        {selectedClientDetail && (
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex justify-end client-left:justify-start z-50"
            onMouseDown={e => { if (e.target === e.currentTarget) leaveAccountEdits(() => setSelectedClientDetail(null)); }}
          >
            <UnsavedFormsContext.Provider value={reportUnsavedForm}>
            <div className="bg-slate-900 w-full max-w-6xl client-full:max-w-none h-full border-l client-left:border-l-0 client-left:border-r client-full:border-0 border-slate-800 flex flex-col shadow-2xl">
              <div ref={accountScrollRef} className="flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain">
              <div className="shrink-0 flex flex-col md:flex-row md:justify-between md:items-start gap-3 border-b client-tabs-top:border-b-0 border-slate-800 p-4 md:px-6">

                <div className="min-w-0 pr-12 md:pr-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-bold text-white">{selectedClientDetail.firstname} {selectedClientDetail.lastname}</h2>
                    <span
                      title="Account balance"
                      className={`text-sm font-semibold px-2.5 py-0.5 rounded-full border ${toDisplayBalance(selectedClientDetail.accountbalance) < 0 ? 'text-red-400 bg-red-500/10 border-red-500/30' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'}`}
                    >
                      {formatBalance(selectedClientDetail.accountbalance)} Balance
                    </span>
                    {/* Ticked on the Information tab; only Federal SO and Fed Drug Test clients can be pretrial */}
                    {selectedClientDetail.pretrial && <span className="-ml-1 text-sm font-semibold text-amber-300">(Pretrial)</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">DOC #: <span className="text-slate-200 font-mono">{selectedClientDetail.docnumber}</span> | Program: <span className="text-blue-400 font-semibold">{selectedClientDetail.programtype || 'State SO'}</span> | Agent: {selectedClientDetail.supervisingagent}</p>
                </div>
                <div className="flex flex-wrap gap-2 md:shrink-0 max-md:pr-12">
                  <div ref={setAccountActionsSlot} className="contents" />
                  <button
                    type="button"
                    onClick={() => setShowClientPayment(true)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                  >
                    <DollarSign size={14} /> Make Payment
                  </button>
                  {/* Discharged clients get Activate (any account type); everyone else gets Discharge (Business Administrators only) */}
                  {clientIsDischarged ? (
                    <button
                      type="button"
                      onClick={() => setStatusDialog('activate')}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                    >
                      <RotateCcw size={14} /> Activate
                    </button>
                  ) : role === 'Business Administrator' && (
                    <button
                      type="button"
                      onClick={() => setStatusDialog('discharge')}
                      className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                    >
                      <LogOut size={14} /> Discharge
                    </button>
                  )}
                  {role === 'Business Administrator' && deletableClientId === selectedClientDetail.clientid && (
                    <button
                      title="Delete client"
                      aria-label={`Delete ${selectedClientDetail.firstname} ${selectedClientDetail.lastname}`}
                      onClick={async () => {
                        if (!window.confirm(`Delete client ${selectedClientDetail.firstname} ${selectedClientDetail.lastname}? This action cannot be undone.`)) return;
                        setLoading(true);
                        try {
                          await deleteClient(selectedClientDetail.clientid, user.employeeemail);
                          setSuccessMsg('Client deleted successfully!');
                          setSelectedClientDetail(null);
                          loadDashboardData();
                        } catch (err: any) {
                          setError(err.message || 'Error deleting client.');
                        } finally {
                          setLoading(false);
                        }
                      }}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-1 rounded-lg bg-red-500/5 border border-red-500/20"
                    >
                      <Trash2 size={20} />
                    </button>
                  )}
                  {/* Pinned on phones: an account page is long, and this is the only way back to the list.
                      z-40 keeps it under the dialogs that open over the account. */}
                  <button onClick={() => leaveAccountEdits(() => setSelectedClientDetail(null))} aria-label="Close account" className="max-md:fixed max-md:top-3 client-tabs-top:max-md:top-[4.25rem] max-md:right-3 max-md:z-40 max-md:shadow-lg text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800"><X size={20} /></button>
                </div>
              </div>

              {/* Under the client's name at the top, like the main tabs under the page header, or at the bottom of the view.
                  Stays on screen either way. The scrollbar stays because a narrow window with a mouse can't swipe, and this
                  bar has no Menu to fall back on. */}
              <nav aria-label="Client account" className="shrink-0 sticky z-20 order-last bottom-0 mt-auto flex bg-slate-900 border-t border-slate-800 client-tabs-top:order-none client-tabs-top:top-0 client-tabs-top:bottom-auto client-tabs-top:mt-0 client-tabs-top:border-b">
                <BarTabs
                  items={clientTabItems}
                  activeTab={clientTab}
                  onSelect={(tab) => {
                    if (tab === clientTab) return;
                    leaveAccountEdits(() => {
                      setClientTab(tab as typeof clientTab);
                      accountScrollRef.current?.scrollTo({ top: 0 });
                    });
                  }}
                  className="[scrollbar-width:thin] [scrollbar-color:#334155_transparent]"
                />
              </nav>

              <div className="grow shrink-0 p-4 md:p-6">
              {statusDialog && (statusDialog === 'activate' || role === 'Business Administrator') && (
                <ProgramStatusDialog
                  action={statusDialog}
                  client={selectedClientDetail}
                  employees={employees}
                  groupCounselor={counselorOfGroup(selectedClientDetail.groupid)}
                  userEmail={user.employeeemail}
                  onClose={() => setStatusDialog(null)}
                  onStatusChanged={handleProgramStatusChanged}
                  onSuccess={setSuccessMsg}
                  onError={setError}
                />
              )}

              {(() => {
                if (clientPolygraphsFor !== selectedClientDetail.clientid) return null;
                // Booked into a polygraph: the notice shows the appointment and how long since the last one, instead of the red warning
                const slot = assignedSlotFor(selectedClientDetail.clientid);
                if (slot) {
                  const start = slotStart(slot);
                  const upcoming = !start || start.getTime() > clientPolygraphsAt;
                  return (
                    <div className="bg-blue-500/10 border border-blue-500/50 text-blue-300 p-3 rounded-lg text-sm flex items-center justify-between gap-3 mb-6">
                      <p className="flex items-center gap-2">
                        <ShieldAlert size={16} className="shrink-0" />
                        <span>
                          <span className="font-semibold">{upcoming ? 'Polygraph scheduled' : 'Polygraph awaiting results'}: {slotSummary(slot)}.</span>{' '}
                          {polygraphHistoryText(clientPolygraphs)}
                        </span>
                      </p>
                      {isAllowed('polygraph') && (
                        <button type="button" onClick={() => leaveAccountEdits(() => openPolySlot(slot.slotid))} className="shrink-0 text-xs font-semibold underline hover:text-white">View Slot</button>
                      )}
                    </div>
                  );
                }
                const notice = polygraphNotice(selectedClientDetail, clientPolygraphs);
                return notice && (
                  <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-lg text-sm font-semibold flex items-center gap-2 mb-6">
                    <ShieldAlert size={16} /> {notice}
                  </div>
                );
              })()}

              {clientTab === 'information' && (
                <div className="space-y-5">
                  <ClientInfoForm
                    key={selectedClientDetail.clientid}
                    client={selectedClientDetail}
                    discharged={clientIsDischarged}
                    groups={groups}
                    directoryAgents={directoryAgents}
                    counselors={counselorNames}
                    polyOverrideActive={!!clientPolyOverride}
                    userEmail={user.employeeemail}
                    loadError={accountLoadError}
                    onDismissLoadError={() => setAccountLoadError('')}
                    actionsSlot={accountActionsSlot}
                    onDirtyChange={setAccountEditsDirty}
                    leaveRequested={leavePrompt?.kind === 'info'}
                    onLeaveResolved={resolveLeavePrompt}
                    onSaved={handleClientInfoSaved}
                    onBusPassGranted={handleBusPassGranted}
                  />

                  {/* Section 4 – Temporary Fee Override */}
                  <TempFeeOverridePanel
                    key={`fee-${selectedClientDetail.clientid}`}
                    client={selectedClientDetail}
                    role={role}
                    userEmail={user.employeeemail}
                    override={clientFeeOverride}
                    onChanged={(override) => {
                      // Skip if another account was opened while it saved
                      if (openClientIdRef.current === selectedClientDetail.clientid) setClientFeeOverride(override);
                      loadDashboardData();
                    }}
                    onSuccess={setSuccessMsg}
                  />

                  {/* Section 5 – Temporary Poly Fee Override: a reduced poly fee for a number of fills, not a date.
                      BIP, Fed Drug Test and Chaperon clients don't take polygraphs, so they have no poly fee. */}
                  {takesPolygraphs(selectedClientDetail.programtype) && <PolyFeeOverridePanel
                    key={`poly-${selectedClientDetail.clientid}`}
                    client={selectedClientDetail}
                    role={role}
                    userEmail={user.employeeemail}
                    override={clientPolyOverride}
                    loadError={polyOverrideLoadError}
                    onChanged={(override, result) => {
                      applyPolyOverrideResult(selectedClientDetail.clientid, result);
                      // Skip if another account was opened while it saved
                      if (openClientIdRef.current === selectedClientDetail.clientid) setClientPolyOverride(override);
                    }}
                    onSuccess={setSuccessMsg}
                  />}
                </div>
              )}

              {/* Every assessment on record; BIP clients also get their group check-in clearance and outside assessments */}
              {clientTab === 'progress' && (
                <ProgressTab
                  key={selectedClientDetail.clientid}
                  clientId={selectedClientDetail.clientid}
                  role={role}
                  userEmail={user.employeeemail}
                  onChanged={loadDashboardData}
                  onSuccess={setSuccessMsg}
                />
              )}

              {clientTab === 'attendance' && (
                <ClientAttendanceHistory
                  key={selectedClientDetail.clientid}
                  clientId={selectedClientDetail.clientid}
                  balance={Number(selectedClientDetail.accountbalance) || 0}
                  attendance={clientAttendance}
                  canDelete={role === 'Business Administrator'}
                  onDeleted={handleAttendanceDeleted}
                  onSuccess={setSuccessMsg}
                  clientName={`${selectedClientDetail.lastname}, ${selectedClientDetail.firstname}`}
                  docNumber={selectedClientDetail.docnumber || ''}
                  onError={setError}
                />
              )}

              {clientTab === 'financials' && (
                <ClientLedger
                  key={selectedClientDetail.clientid}
                  client={selectedClientDetail}
                  role={role}
                  userEmail={user.employeeemail}
                  financials={clientFinancials}
                  bookedSlot={assignedSlotFor(selectedClientDetail.clientid)}
                  canViewSlot={isAllowed('polygraph')}
                  onViewSlot={(slotId) => leaveAccountEdits(() => openPolySlot(slotId))}
                  onPaymentChanged={handleLedgerPaymentChanged}
                  onSuccess={setSuccessMsg}
                />
              )}

              {clientTab === 'notes' && (
                <ClientNotes key={selectedClientDetail.clientid} clientId={selectedClientDetail.clientid} user={user} notes={clientNotes} setNotes={setClientNotes} onApprovalChanged={refreshPendingNotes}
                  onDirtyChange={setNotesEditsDirty} leaveRequested={leavePrompt?.kind === 'notes'} onLeaveResolved={resolveLeavePrompt} />
              )}

              {clientTab === 'polygraphs' && takesPolygraphs(selectedClientDetail.programtype) && (
                <ClientPolygraphs
                  key={selectedClientDetail.clientid}
                  client={selectedClientDetail}
                  role={role}
                  userEmail={user.employeeemail}
                  polygraphs={clientPolygraphs}
                  slots={polySlots}
                  bookedSlot={assignedSlotFor(selectedClientDetail.clientid)}
                  examinerName={getExaminerDisplayName}
                  canViewSlot={isAllowed('polygraph')}
                  onViewSlot={(slotId) => leaveAccountEdits(() => openPolySlot(slotId))}
                  onSchedule={(slotId, type, comment) => polyAssign.scheduleFromAccount(slotId, String(selectedClientDetail.clientid), type, comment)}
                  scheduling={loading || polyAssign.saving}
                  error={error}
                  onNoPolyRequiredSaved={handleNoPolyRequiredSaved}
                  onError={setError}
                />
              )}

              {clientTab === 'attachments' && (
                <ClientAttachments
                  key={`${selectedClientDetail.clientid}-${accountTabsVersion}`}
                  clientId={selectedClientDetail.clientid}
                  userEmail={user.employeeemail}
                  canDelete={role === 'Business Administrator'}
                  onSuccess={setSuccessMsg}
                />
              )}

              {clientTab === 'changelog' && role === 'Business Administrator' && (
                <ClientChangeLog key={`${selectedClientDetail.clientid}-${accountTabsVersion}`} clientId={selectedClientDetail.clientid} userEmail={user.employeeemail} />
              )}
              </div>
              </div>
            </div>
            </UnsavedFormsContext.Provider>

            {leavePrompt?.kind === 'other' && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="unsaved-work-title">
                <div className="bg-slate-900 border border-amber-500/40 rounded-xl p-6 w-full max-w-md max-h-full overflow-y-auto space-y-4 text-sm">
                  <div>
                    <h3 id="unsaved-work-title" className="font-semibold text-white">Discard your unsaved work?</h3>
                    <p className="text-xs text-slate-400 mt-1">You have something in progress on this tab that hasn't been saved. Keep editing to finish and save it there.</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => resolveLeavePrompt(false)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">Keep Editing</button>
                    <button type="button" onClick={() => resolveLeavePrompt(true)} className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">Discard</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* FULL ATTENDANCE & SIGN-IN TAB */}
        {/* Stays mounted on other tabs so a group check-in in progress isn't lost */}
        {isAllowed('attendance') && (
          <div className={`${activeTab === 'attendance' ? 'grid' : 'hidden'} grid-cols-1 lg:grid-cols-3 gap-6`}>
            <div ref={checkInPanelRef} className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl min-w-0 scroll-mt-4">
              <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3 mb-4 md:mb-6 border-b border-slate-800 pb-4">
                <div><h2 className="text-lg font-bold text-white">Attendance Sign-In & Payment Entry</h2><p className="text-xs text-slate-400 mt-0.5">Record attendance, cross-group makeups, or standalone ledger payments.</p></div>
                <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 lg:shrink-0">
                  <button onClick={() => { setIsAccountOnly(false); setIsCustomCharge(false); }} className={`flex-1 lg:flex-none px-3 py-1.5 rounded text-xs font-semibold ${!isAccountOnly && !isCustomCharge ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Attendance + Payment</button>
                  <button onClick={() => { setIsAccountOnly(true); setIsCustomCharge(false); }} className={`flex-1 lg:flex-none px-3 py-1.5 rounded text-xs font-semibold ${isAccountOnly && !isCustomCharge ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Account-Only Payment</button>
                  {role === 'Business Administrator' && (
                    <button onClick={() => setIsCustomCharge(true)} className={`flex-1 lg:flex-none px-3 py-1.5 rounded text-xs font-semibold ${isCustomCharge ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Custom Charge</button>
                  )}
                </div>
              </div>

              {/* Stays mounted while another mode is showing so a check-in in progress isn't lost */}
              <div className={!isAccountOnly && !(isCustomCharge && role === 'Business Administrator') ? '' : 'hidden'}>
                <GroupCheckInWorkflow
                  groups={activeGroups}
                  clients={clients}
                  createdBy={user.employeeemail}
                  canPickCover={role === 'Business Administrator' || role === 'Office Admin'}
                  onSuccess={setSuccessMsg}
                  onError={setError}
                  onSaved={loadDashboardData}
                  openGroups={openGroups}
                  onOpenGroupsChanged={loadOpenGroups}
                  resumeRequest={resumeRequest}
                  onResumeHandled={() => setResumeRequest(null)}
                  missedCheckInRequest={missedCheckInRequest}
                  onMissedCheckInHandled={() => setMissedCheckInRequest(null)}
                  onOpenClient={openClientById}
                />
              </div>

              {/* Both stay mounted while another mode is showing, so a form in progress and the last receipt are kept */}
              {role === 'Business Administrator' && (
                <div className={isCustomCharge ? '' : 'hidden'}>
                  <CustomChargeForm clients={clients} userEmail={user.employeeemail} onCharged={loadDashboardData} onSuccess={setSuccessMsg} onError={setError} />
                </div>
              )}
              <div className={isAccountOnly && !(isCustomCharge && role === 'Business Administrator') ? '' : 'hidden'}>
                <AccountPaymentForm clients={clients} userEmail={user.employeeemail} onRecorded={loadDashboardData} onSuccess={setSuccessMsg} onError={setError} />
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl min-w-0">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-white flex items-center gap-2"><ClipboardCheck size={18} className="text-blue-400" /> {groupPanelTab === 'open' ? 'Open Groups' : 'Closed Groups'}</h3>
                  <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                    {(['open', 'closed'] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setGroupPanelTab(t)}
                        className={`px-3 py-1 rounded text-xs font-semibold transition ${groupPanelTab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        {t === 'open' ? `Open${openGroups.length ? ` (${openGroups.length})` : ''}` : 'Closed'}
                      </button>
                    ))}
                  </div>
                </div>
                {groupPanelTab === 'closed' ? (
                  <>
                    <p className="text-xs text-slate-400 leading-relaxed mb-4">{role === 'Business Administrator' ? 'Recently closed group sessions.' : 'Recently closed group sessions for groups you counsel or opened.'} Select one to see who attended.</p>
                    {closedGroupsError ? (
                      <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{closedGroupsError}</p>
                    ) : closedGroups.length === 0 ? (
                      <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-lg p-4 text-center">No closed groups.</p>
                    ) : (
                      <ul className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                        {closedGroups.map(c => {
                          const key = `${c.groupid}-${c.sessiondate}-${c.sessionnumber}`;
                          const expanded = expandedClosedGroup === key;
                          const collected = c.entries.reduce((sum, e) => sum + Number(e.accountPaid || 0), 0);
                          return (
                            <li key={key} className={`bg-slate-950 border rounded-lg ${expanded ? 'border-blue-500/40' : 'border-slate-800'}`}>
                              <button type="button" onClick={() => setExpandedClosedGroup(expanded ? null : key)} aria-expanded={expanded} className="w-full text-left p-3">
                                <p className="text-sm font-semibold text-white truncate">{c.groupname}</p>
                                <p className="text-xs text-slate-400">
                                  {c.sessiondate === todayLocal() ? 'Today' : new Date(`${c.sessiondate}T00:00:00`).toLocaleDateString()}{(c.sessionnumber ?? 1) > 1 ? ` · Session ${c.sessionnumber}` : ''} · {c.entries.length} client(s)
                                </p>
                                <p className="text-[0.6875rem] text-slate-500 truncate">
                                  Closed{c.closedon ? ` ${new Date(c.closedon).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}{c.closedby ? ` by ${c.closedby}` : ''}
                                </p>
                                {c.openedby && c.openedby !== c.closedby && <p className="text-[0.6875rem] text-slate-500 truncate">Opened by {c.openedby}</p>}
                              </button>
                              {expanded && (
                                <div className="border-t border-slate-800 px-3 py-2 text-xs">
                                  <ul className="divide-y divide-slate-800">
                                    {c.entries.map(e => (
                                      <li key={e.client} className="flex justify-between gap-2 py-1.5">
                                        <span className="text-slate-200 truncate">{e.name}</span>
                                        <span className="text-slate-400 shrink-0">{Number(e.accountPaid) > 0 ? `$${Number(e.accountPaid).toFixed(2)} ${e.paymentMethod || ''}`.trim() : 'No payment'}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  <p className="text-right text-slate-300 font-semibold pt-1.5 border-t border-slate-800">Collected ${collected.toFixed(2)}</p>
                                  {role === 'Business Administrator' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        // Back to group check-in if a payment form was showing
                                        setIsAccountOnly(false);
                                        setIsCustomCharge(false);
                                        setMissedCheckInRequest(c);
                                        scrollToStackedPanel(checkInPanelRef.current);
                                      }}
                                      className="mt-2 w-full bg-blue-600 hover:bg-blue-500 text-white rounded py-1.5 font-semibold"
                                    >
                                      Add Missed Check-In
                                    </button>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                ) : (
                <>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">Check-ins saved with Finish Check-In. Open one to review and close the group.</p>
                {openGroupsError ? (
                  <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{openGroupsError}</p>
                ) : openGroups.length === 0 ? (
                  <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-lg p-4 text-center">No open groups.</p>
                ) : (
                  <ul className="space-y-2">
                    {openGroups.map(o => (
                      <li key={o.opensessionid} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{o.groupname}</p>
                            <p className={`text-xs ${o.sessiondate === todayLocal() ? 'text-slate-400' : 'text-amber-400'}`}>
                              {o.sessiondate === todayLocal() ? 'Today' : new Date(`${o.sessiondate}T00:00:00`).toLocaleDateString()}{(o.sessionnumber ?? 1) > 1 ? ` · Session ${o.sessionnumber}` : ''} · {o.entries.length} client(s)
                            </p>
                            <p className="text-[0.6875rem] text-slate-500 truncate">Saved {new Date(o.updatedon).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{o.createdby ? ` by ${o.createdby}` : ''}</p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(`Discard the open check-in for ${o.groupname}? Attendance for these ${o.entries.length} client(s) will not be saved. Payments already taken stay on their accounts.`)) return;
                              try {
                                await deleteOpenGroup(o.opensessionid, user.employeeemail);
                                setSuccessMsg(`Open check-in for ${o.groupname} discarded.`);
                                loadOpenGroups();
                              } catch (err: any) {
                                setError(err.message || 'Failed to discard the open group.');
                              }
                            }}
                            className="text-slate-500 hover:text-red-400 p-1 rounded shrink-0"
                            aria-label={`Discard open check-in for ${o.groupname}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setIsAccountOnly(false); setIsCustomCharge(false); setResumeRequest(o); scrollToStackedPanel(checkInPanelRef.current); }}
                          className="mt-2 w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold py-1.5 rounded-lg"
                        >
                          Open & Close Group
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ASSESSMENTS & INDIVIDUALS TAB */}
        {/* Stays mounted on other tabs so a session being entered isn't lost */}
        {isAllowed('sessions') && (
          <div className={activeTab === 'sessions' ? '' : 'hidden'}>
            <AssessmentsIndividualsTab
              active={activeTab === 'sessions'}
              clients={clients}
              employees={employees}
              user={user}
              onSuccess={setSuccessMsg}
              onError={setError}
              onSaved={loadDashboardData}
            />
          </div>
        )}

        {/* CALL-IN MODULE TAB */}
        {activeTab === 'callin' && (
          <CallInTab
            clients={clients}
            groups={activeGroups}
            user={user}
            onLogged={(message) => { setSuccessMsg(message); loadDashboardData(); }}
          />
        )}

        {/* GROUPS MODULE TAB */}
        {activeTab === 'groups' && (
          <GroupsTab
            groups={groups}
            clients={clients}
            employees={employees}
            role={role}
            userEmail={user.employeeemail}
            onSuccess={setSuccessMsg}
            onError={setError}
            onGroupsChanged={loadDashboardData}
            onOpenClient={openClientLogs}
          />
        )}

        {/* TESTING MODULE TAB */}
        {activeTab === 'testing' && <TestingTab clients={clients} onSuccess={setSuccessMsg} />}

        {/* Polygraph assignment prompts. Outside the Polygraph tab so they also open over a client's account,
            which can schedule from its Polygraphs section. */}
        <PolyAssignDialogs
          assignment={polyAssign}
          slots={polySlots}
          clients={clients}
          userEmail={user.employeeemail}
          examinerName={getExaminerDisplayName}
          accountOpen={!!selectedClientDetail}
          onClientUpdated={(updated) => {
            setClients(prev => prev.map(c => c.clientid === updated.clientid ? { ...c, ...updated } : c));
            // The same client may be open in the account drawer
            setSelectedClientDetail((c: any) => (c && c.clientid === updated.clientid ? { ...c, ...updated } : c));
          }}
          onSuccess={setSuccessMsg}
          onError={setError}
        />

        {/* POLYGRAPH TAB */}
        {activeTab === 'polygraph' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-white">Polygraph Management Module</h2>
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
              {polySubTab !== 'admin' && (
                <button
                  type="button"
                  onClick={togglePolyFilters}
                  aria-expanded={showPolyFilters}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showPolyFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
                >
                  <SlidersHorizontal size={13} /> Filters
                  {polyFilterCount > 0 && (
                    <span className="bg-blue-600 text-white rounded-full px-1.5 text-[0.625rem] leading-4">{polyFilterCount}</span>
                  )}
                </button>
              )}
              <div className="max-md:order-first w-full md:w-auto flex bg-slate-950 p-1 rounded-lg border border-slate-800 md:shrink-0">
                <button onClick={() => setPolySubTab('admin')} className={`flex-1 md:flex-none px-3 py-1.5 rounded text-xs font-semibold ${polySubTab === 'admin' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Poly Admin</button>
                <button onClick={() => setPolySubTab('schedule')} className={`flex-1 md:flex-none px-3 py-1.5 rounded text-xs font-semibold ${polySubTab === 'schedule' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Poly Schedule</button>
                <button onClick={() => setPolySubTab('results')} className={`flex-1 md:flex-none px-3 py-1.5 rounded text-xs font-semibold ${polySubTab === 'results' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Poly Results</button>
              </div>
              </div>
            </div>

            {polySubTab !== 'admin' && showPolyFilters && (
              <div className="grid grid-cols-2 md:flex md:flex-wrap items-end gap-3">
                <label className="text-xs text-slate-400">Polygrapher
                  <select value={polyExaminerFilter} onChange={(e) => setPolyExaminerFilter(e.target.value)} className="block mt-1 w-full md:w-auto h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200">
                    <option value="">All Polygraphers</option>
                    {polyExaminerChoices.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-400">Location
                  <select value={polyLocationFilter} onChange={(e) => setPolyLocationFilter(e.target.value)} className="block mt-1 w-full md:w-auto h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200">
                    <option value="">All Locations</option>
                    {polyLocationChoices.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-400">From
                  <input type="date" value={polyDateFrom} max={polyDateTo || undefined} onChange={(e) => setPolyDateFrom(e.target.value)} className="block mt-1 w-full md:w-auto h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200" />
                </label>
                <label className="text-xs text-slate-400">To
                  <input type="date" value={polyDateTo} min={polyDateFrom || undefined} onChange={(e) => setPolyDateTo(e.target.value)} className="block mt-1 w-full md:w-auto h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200" />
                </label>
                {polySubTab === 'schedule' && (
                  <label className="text-xs text-slate-400">Status
                    <select value={polyStatusFilter} onChange={(e) => setPolyStatusFilter(e.target.value)} className="block mt-1 w-full md:w-auto h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200">
                      <option value="">All Statuses ({examinerSlots.length})</option>
                      {POLY_SLOT_STATUSES.map(st => <option key={st} value={st}>{st} ({polyStatusCounts[st]})</option>)}
                    </select>
                  </label>
                )}
                <label className="text-xs text-slate-400">Sort
                  <select value={polyDateSort} onChange={(e) => setPolyDateSort(e.target.value as 'asc' | 'desc')} className="block mt-1 w-full md:w-auto h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200">
                    <option value="asc">Date: Soonest First</option>
                    <option value="desc">Date: Latest First</option>
                  </select>
                </label>
                {(polySubTab === 'schedule' ? scheduleFiltersActive : polyFiltersActive) && (
                  <button
                    type="button"
                    onClick={clearPolyFilters}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-2"
                  >
                    <X size={12} /> Clear Filters
                  </button>
                )}
              </div>
            )}

            {polySubTab === 'admin' && (
              <PolySlotForm
                role={role}
                employees={employees}
                onSuccess={setSuccessMsg}
                onError={setError}
                onCreated={async () => { setPolySlots(await getPolygraphSlots()); setPolySubTab('schedule'); }}
              />
            )}

            {reopenTarget && (
              <PolyCancelDialog
                slot={reopenTarget}
                role={role}
                userEmail={user.employeeemail}
                onClose={() => setReopenTarget(null)}
                onCancelled={handleReservationCancelled}
                onError={setError}
              />
            )}

            {rescheduleTarget && (
              <PolyRescheduleDialog
                slot={rescheduleTarget}
                role={role}
                userEmail={user.employeeemail}
                employees={employees}
                examinerName={getExaminerDisplayName}
                onClose={() => setRescheduleTarget(null)}
                onRescheduled={async (message) => {
                  setRescheduleTarget(null);
                  setSuccessMsg(message);
                  setPolySlots(await getPolygraphSlots());
                }}
              />
            )}

            {polySubTab === 'schedule' && (
              <PolySchedule
                slots={scheduleSlots}
                filtersActive={scheduleFiltersActive}
                role={role}
                assignableClients={clients.filter(c => c.programstatus === 'Active' && takesPolygraphs(c.programtype) && !assignedSlotFor(c.clientid))}
                highlightedSlotId={highlightedSlotId}
                examinerName={getExaminerDisplayName}
                choices={polyAssign.choices}
                onAssign={(slotId) => polyAssign.openAssignConfirm(slotId)}
                onCancelReservation={handleReopenSlot}
                onReschedule={(slotId) => setRescheduleTarget(polySlots.find(s => s.slotid === slotId) ?? null)}
                onDelete={handleDeleteSlot}
              />
            )}

            {polySubTab === 'results' && (
              <PolyResults
                slots={assignedSlots}
                role={role}
                userEmail={user.employeeemail}
                examinerName={getExaminerDisplayName}
                onCancelReservation={handleReopenSlot}
                onRecorded={loadDashboardData}
                onSuccess={setSuccessMsg}
                onError={setError}
              />
            )}
          </div>
        )}

        {/* REPORTS TAB */}
        {activeTab === 'reports' && (
          <ReportsTab user={user} clients={clients} groups={groups} onOpenClient={openClientLogs} onOpenClientId={openClientById} />
        )}

        {/* ADMIN TAB */}
        {activeTab === 'forms' && isAllowed('forms') && <FormsTab role={role} onSuccess={setSuccessMsg} />}

        {activeTab === 'admin' && (
          <AdminTab user={user} employees={employees} onEmployeesChanged={setEmployees} onSuccess={setSuccessMsg} onError={setError} />
        )}

        {bipIntakePrompt && (
          <BipIntakePrompt
            client={bipIntakePrompt}
            employees={employees}
            user={user}
            onDone={message => { setBipIntakePrompt(null); if (message) setSuccessMsg(message); }}
          />
        )}
      </main>
    </div>
    </EmployeeLabelProvider>
  );
}