import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, ClipboardCheck, ShieldCheck, LogOut, AlertCircle, X, FileText, 
  DollarSign, Calendar, PlusCircle, Activity, PhoneCall, ShieldAlert, 
  Layers, CheckSquare, BarChart3, Settings, CheckCircle2, Trash2, RotateCcw, Home
} from 'lucide-react';
import {
  loginUser, getClients, getGroups, submitAccountPayment, submitCustomCharge,
  submitClientCallIn, submitGroupCallIn, getPolygraphSlots, createPolygraphSlot,
  submitPolygraphResult, deletePolygraphSlot, assignPolygraphSlot, reopenPolygraphSlot,
  getClientAttendance, getClientFinancials,
  getClientNotes, addClientNote, getClientPolygraphs, getGroupClients, updateGroup, updateClient,
  assignClientToGroup, createClient, createGroup, deleteGroup, deleteClient, updateEmployee, getClientTests, submitTestResult, getAgentReport,
  getDepositReport, getEmployees, addEmployee, getSystemLogs, fetchClientFeeOverride, saveClientFeeOverride, deleteClientFeeOverride
} from './api';
import GroupCheckInWorkflow from './components/attendance/GroupCheckInWorkflow';
import { formatBalance, toDisplayBalance } from './utils/balance';
import { SO_PHASES, SO_TREATMENT_FEES } from './utils/soPhases';
import CardPaymentFields from './components/payments/CardPaymentFields';

// Client program statuses. 'Active' is used by group call-ins and the group roster, so keep that exact spelling.
const PROGRAM_STATUSES = ['Active', 'Completed', 'Deceased', 'Discharged', 'Failed - Non Attendance', 'Failed - Non Compliance', 'Inactive', 'Revoked', 'Transfered'];

// Group call-in notes are saved as "[Group Call-In Log] (For: YYYY-MM-DD) (Reason: …): …". No "For" date means the day it was submitted.
const parseGroupCallInNote = (text: string) => {
  const match = /^\[Group Call-In Log\](?: \(For: (\d{4}-\d{2}-\d{2})\))?/.exec(text || '');
  return match ? { forDate: match[1] || null } : null;
};

// Label shown above a case note. Group call-ins read "<date> · Group Call-In"; everything else keeps its category.
const caseNoteLabel = (note: any) => {
  const groupCallIn = note.category === 'Call-In' ? parseGroupCallInNote(note.comments) : null;
  if (!groupCallIn) return note.category;
  const dateLabel = groupCallIn.forDate ? new Date(`${groupCallIn.forDate}T00:00:00`).toLocaleDateString() : 'Day Of';
  return `${dateLabel} · Group Call-In`;
};

// Optional call-in reasons. Keep in sync with CALL_IN_REASONS in backend/server.js.
const CALL_IN_REASONS = ['Routine check-in', 'Missed appointment', 'Reschedule request', 'Transportation issue', 'Work conflict', 'Other'];

// Date and Time Helpers for Appointments
const getLocalDateString = (d: Date = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getLocalTimeString = (d: Date = new Date()) => {
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const getDefaultPolyTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 15);
  return getLocalTimeString(now);
};

// Date-only values (YYYY-MM-DD) are read as local dates; `new Date(str)` would treat them as UTC and can show the previous day
const parseLogDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  return new Date(value);
};

const formatLogMonthDay = (value?: string | null) => {
  const d = parseLogDate(value);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
};

const formatLogYear = (value?: string | null) => {
  const d = parseLogDate(value);
  return d ? String(d.getFullYear()) : '';
};

// Time only means something for timestamps; date-only values have no time of day
const formatLogTime = (value?: string | null) => {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const formatDisplayTime = (timeStr?: string) => {
  if (!timeStr) return '';
  if (/am|pm/i.test(timeStr)) return timeStr;
  const parts = timeStr.split(':');
  if (parts.length >= 2) {
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    return `${formattedHours}:${minutes} ${ampm}`;
  }
  return timeStr;
};

// Attendance balance math uses the same display sign as the balance shown on the card.
// Each row stores the balance after its session, so the "before" balance is rebuilt from that row alone.
const signedMoney = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const attendanceBalanceChange = (att: any) => {
  const fee = Number(att.groupfee || 0);
  const paid = Number(att.accountpaid || 0);
  return {
    fee,
    paid,
    before: toDisplayBalance(Number(att.accounttotal || 0) - fee + paid),
    after: toDisplayBalance(att.accounttotal),
  };
};

// Programs that use the SO phase schedule and show the last polygraph date
const SO_PROGRAM_TYPES = ['State SO', 'Federal SO'];
// BIP clients store a whole-number week (starting at 0) in the phase column instead of an SO phase
const isWholeNumber = (value: unknown) => /^\d+$/.test(String(value ?? '').trim());
const formatPhase = (programtype?: string | null, phase?: string | null) =>
  programtype === 'BIP' && isWholeNumber(phase) ? `Week ${phase}` : phase;
// Group program types offered for each client program type. Programs not listed see every group.
const GROUP_TYPES_BY_PROGRAM: Record<string, string[]> = {
  'State SO': ['SO', 'FED SO'],
  'Federal SO': ['SO', 'FED SO'],
  'BIP': ['BIP'],
};

// Ledger rows store the balance after each transaction. Working back from the amount gives the balance before it.
const ledgerBalanceChange = (fin: any) => {
  if (fin.finalbalance === null || fin.finalbalance === undefined) return null;
  const amount = Number(fin.amount || 0);
  const after = Number(fin.finalbalance);
  const before = fin.type === 'Charge' ? after - amount : after + amount;
  return { before: toDisplayBalance(before), after: toDisplayBalance(after) };
};

const POLY_CANCEL_REASONS =['Client requested cancellation', 'Client did not show', 'Client rescheduled', 'Examiner unavailable', 'Scheduling conflict', 'Other'];

// Group schedules are stored as text like "Thursdays @ 7:00 PM"; this picker builds and reads that same format
const SCHEDULE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SCHEDULE_TIMES = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
});
const formatSchedule = (day: string, time: string) => (day && time ? `${day}s @ ${time}` : '');
const parseSchedule = (value: string) => {
  const match = /^\s*([A-Za-z]+?)s?\s*@\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(value || '');
  const day = SCHEDULE_DAYS.find(d => match && d.toLowerCase() === match[1].toLowerCase()) || '';
  const time = match && day ? `${parseInt(match[2], 10)}:${match[3]} ${match[4].toUpperCase()}` : '';
  return { day, time };
};

const ScheduleSelect = ({ value, onChange, className }: { value: string; onChange: (v: string) => void; className: string }) => {
  const [day, setDay] = useState(() => parseSchedule(value).day);
  const [time, setTime] = useState(() => parseSchedule(value).time);
  // Pick up values set from outside (opening a group, cancelling the new-group form)
  useEffect(() => {
    if (value !== formatSchedule(day, time)) {
      const next = parseSchedule(value);
      setDay(next.day);
      setTime(next.time);
    }
  }, [value]);
  const pick = (nextDay: string, nextTime: string) => {
    setDay(nextDay);
    setTime(nextTime);
    onChange(formatSchedule(nextDay, nextTime));
  };
  return (
    <div className="flex gap-2">
      <select required value={day} onChange={(e) => pick(e.target.value, time)} className={`flex-1 ${className}`}>
        <option value="">Day...</option>
        {SCHEDULE_DAYS.map(d => <option key={d} value={d}>{d}s</option>)}
      </select>
      <select required value={time} onChange={(e) => pick(day, e.target.value)} className={`flex-1 ${className}`}>
        <option value="">Time...</option>
        {SCHEDULE_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
};

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
  const [emailInput, setEmailInput] = useState(rememberedEmail ?? 'justin.chandlerandassociates@hotmail.com');
  const [rememberMe, setRememberMe] = useState(rememberedEmail !== null);
  const [passwordInput, setPasswordInput] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [clients, setClients] = useState<any[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientFilters, setClientFilters] = useState({ agent: '', programtype: '', currentgroup: '', status: 'Active', feeoverride: '' });
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
  const [clientTab, setClientTab] = useState<'information' | 'attendance' | 'financials' | 'notes' | 'polygraphs'>('information');
  const [clientAttendance, setClientAttendance] = useState<any[]>([]);
  const [clientFinancials, setClientFinancials] = useState<any[]>([]);
  const [clientNotes, setClientNotes] = useState<any[]>([]);
  const [clientPolygraphs, setClientPolygraphs] = useState<any[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteCategory] = useState('Therapist');
  const [editingClientInfo, setEditingClientInfo] = useState(false);
  const [savingClientInfo, setSavingClientInfo] = useState(false);
  const [clientInfoError, setClientInfoError] = useState('');
  const [clientInfoForm, setClientInfoForm] = useState<any>({});
  const [clientFeeOverride, setClientFeeOverride] = useState<any>(null);
  const [showFeeOverrideForm, setShowFeeOverrideForm] = useState(false);
  const [feeOverrideInput, setFeeOverrideInput] = useState('');
  const [feeOverrideDate, setFeeOverrideDate] = useState('');

  // Attendance State
  const [isAccountOnly, setIsAccountOnly] = useState(false);
  // Custom fee charge (Business Administrators only)
  const [isCustomCharge, setIsCustomCharge] = useState(false);
  const [chargeClient, setChargeClient] = useState('');
  const [chargeInput, setChargeInput] = useState('');
  const [chargeNotes, setChargeNotes] = useState('');
  const chargeAmount = Number(chargeInput) || 0;
  const chargeClientRecord = clients.find(c => c.clientid === Number(chargeClient));
  const chargeCurrentBalance = Number(chargeClientRecord?.accountbalance || 0);
  const balanceAfterCharge = chargeCurrentBalance + chargeAmount;
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [paymentInput, setPaymentInput] = useState('');
  const paymentAmount = Number(paymentInput) || 0;
  const selectedClientRecord = clients.find(c => c.clientid === Number(selectedClient));
  const currentBalance = Number(selectedClientRecord?.accountbalance || 0);
  const balanceAfterPayment = currentBalance - paymentAmount;
  const formatMoney = (n: number) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`);
  const [comments, setComments] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Credit Card'>('Cash');
  // Billing details PayPal needs for card payments. Not saved yet; card number and CVV never touch our system.
  const emptyCardBilling = { cardholderName: '', receiptEmail: '', street: '', city: '', state: '', zip: '', country: 'US' };
  const [cardBilling, setCardBilling] = useState(emptyCardBilling);
  // Set only after a payment is saved to the account; drives the receipt printout
  const [lastPayment, setLastPayment] = useState<null | { clientName: string; docNumber: string; amount: number; method: string; notes: string; newBalance: number; processedBy: string; date: string }>(null);

  // Call-In State
  const [callInMode, setCallInMode] = useState<'client' | 'group'>('client');
  const [callInComment, setCallInComment] = useState('');
  const [callInReason, setCallInReason] = useState('');
  // Optional, group call-ins only: the day the call-in is for when the group meets on another day
  const [groupCallInDate, setGroupCallInDate] = useState('');

  // Polygraph State
  const [polySubTab, setPolySubTab] = useState<'admin' | 'schedule' | 'results'>('schedule');
  const [polySlots, setPolySlots] = useState<any[]>([]);
  const [polyLocation, setPolyLocation] = useState('Oklahoma City Office');
  const [polyAddress, setPolyAddress] = useState('123 Main St, OKC');
  const [polyDate, setPolyDate] = useState(() => getLocalDateString());
  const [polyTime, setPolyTime] = useState(() => getDefaultPolyTime());
  const [polyExaminer, setPolyExaminer] = useState('jvance@chandlercbt.com');
  const [polyType, setPolyType] = useState('Maintenance');
  
  // Assignment state per slot card
  const [slotAssignments, setSlotAssignments] = useState<{ [slotId: number]: string }>({});
  const [slotComments, setSlotComments] = useState<{ [slotId: number]: string }>({});
  // Slot awaiting the assignment confirmation box
  const [pendingAssignSlotId, setPendingAssignSlotId] = useState<number | null>(null);
  // Cancellation prompt for an assigned slot
  const [reopenTarget, setReopenTarget] = useState<any>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenNotes, setReopenNotes] = useState('');
  const [slotTypes, setSlotTypes] = useState<{ [slotId: number]: string }>({});

  // Active slot selected on Poly Results tab
  const [selectedSlotForResults, setSelectedSlotForResults] = useState<any>(null);
  const [resResultType, setResResultType] = useState('No Deception Indicated');
  const [resNotes, setResNotes] = useState('');

  // Groups Module State
  const [selectedGroupDetail, setSelectedGroupDetail] = useState<any>(null);
  const groupDetailRef = useRef<HTMLDivElement>(null);
  const [groupRoster, setGroupRoster] = useState<any[]>([]);
  const [assignClientSearch, setAssignClientSearch] = useState('');
  const [groupTab, setGroupTab] = useState<'roster' | 'assign' | 'schedule'>('roster');
  const [editGroupName, setEditGroupName] = useState('');
  const [editCounselor, setEditCounselor] = useState('');
  const [editSchedule, setEditSchedule] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editLocation, setEditLocation] = useState('');
  const [editProgramType, setEditProgramType] = useState('');
  const [editAddress, setEditAddress] = useState('');
  // Inactive groups stay in the directory but are hidden from every picker for new assignments and sessions
  const activeGroups = groups.filter(g => g.active !== false);
  const [showInactiveGroups, setShowInactiveGroups] = useState(false);
  // Normalize location names (e.g., "Oklahoma City" → "OKC")
  const normalizeLocation = (loc: string) => loc === 'Oklahoma City' ? 'OKC' : loc;
  // Reverse normalization for storage (e.g., "OKC" → "Oklahoma City")
  const denormalizeLocation = (loc: string) => loc === 'OKC' ? 'Oklahoma City' : loc;
  // Directory filters; an empty string means "all"
  const [groupFilters, setGroupFilters] = useState({ location: '', counselor: '', programtype: '', status: '' });
  const groupFilterActive = Object.values(groupFilters).some(Boolean);
  const distinctGroupValues = (key: 'location' | 'counselor' | 'programtype' | 'status') => {
    if (key === 'status') return ['Active', 'Inactive'];
    const values = Array.from(new Set(groups.map(g => {
      const val = g[key];
      return key === 'location' && val ? normalizeLocation(val) : val;
    }).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
    return values;
  };
  const emptyNewGroup = { groupName: '', location: '', counselor: '', programType: '', schedule: '', address: '' };
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroup, setNewGroup] = useState(emptyNewGroup);
  const inactiveGroupCount = groups.length - activeGroups.length;
  type GroupSortKey = 'groupname' | 'location' | 'counselor' | 'programtype' | 'schedule' | 'clientcount' | 'active';
  const [groupSort, setGroupSort] = useState<{ key: GroupSortKey; dir: 'asc' | 'desc' }>({ key: 'groupname', dir: 'asc' });
  const toggleGroupSort = (key: GroupSortKey) => {
    setGroupSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };
  const groupSortArrow = (key: GroupSortKey) => (groupSort.key === key ? (groupSort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const sortedDirectoryGroups = groups
    .filter(g => showInactiveGroups || g.active !== false)
    .filter(g => (!groupFilters.location || normalizeLocation(g.location) === groupFilters.location)
      && (!groupFilters.counselor || g.counselor === groupFilters.counselor)
      && (!groupFilters.programtype || g.programtype === groupFilters.programtype)
      && (!groupFilters.status || (groupFilters.status === 'Active' ? g.active !== false : g.active === false)))
    .sort((a, b) => {
      const read = (g: any) => (groupSort.key === 'active' ? (g.active !== false ? 1 : 0)
        : groupSort.key === 'clientcount' ? Number(g.clientcount || 0)
        : String(g[groupSort.key] ?? ''));
      const va = read(a);
      const vb = read(b);
      const result = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
      return groupSort.dir === 'asc' ? result : -result;
    });

  // Testing Module State
  const [testClient, setTestClient] = useState('');
  const [testType, setTestType] = useState('SOTP Pre/Post');
  const [testScore, setTestScore] = useState('');
  const [testNotes, setTestNotes] = useState('');
  const [clientTestHistory, setClientTestHistory] = useState<any[]>([]);

  // Reports State
  const [agentReportData, setAgentReportData] = useState<any[]>([]);
  const [depositReportData, setDepositReportData] = useState<any>(null);

  // Admin Module State
  const [employees, setEmployees] = useState<any[]>([]);
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const [empEmail, setEmpEmail] = useState('');
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState('Counselor');
  const [empLoc] = useState('Oklahoma City');
  // Email of the account being edited, or null when adding a new one
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [empActive, setEmpActive] = useState(true);
  const [accountFilter, setAccountFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [empPassword, setEmpPassword] = useState('');
  const [empSearch, setEmpSearch] = useState('');

  // Counselor dropdown choices: active employees with the Counselor role. A group's saved counselor is kept as an option even if that account is no longer listed
  const counselorOptions = employees.filter(e => e.role === 'Counselor' && e.active !== false).map(e => e.displayname as string).filter(Boolean);
  const counselorChoices = (current: string) => (current && !counselorOptions.includes(current) ? [current, ...counselorOptions] : counselorOptions);

  // Auto-scroll to group details when a group is selected
  useEffect(() => {
    if (selectedGroupDetail && groupDetailRef.current) {
      setTimeout(() => {
        groupDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    }
  }, [selectedGroupDetail]);

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
        setUser(res.user);
        setError('');
        loadDashboardData();
      } else {
        setError(res.error || 'Login failed.');
      }
    } catch (err: any) {
      setError('Server connection error. Ensure backend is running.');
    }
  };

  const loadDashboardData = async () => {
    try {
      const [clientData, groupData, slotData, empData, logData] = await Promise.all([
        getClients(), getGroups(), getPolygraphSlots(), getEmployees(), getSystemLogs()
      ]);
      setClients(clientData);
      setGroups(groupData);
      setPolySlots(slotData);
      setEmployees(empData);
      setSystemLogs(logData);
    } catch (err) {
      console.error('Failed to load data', err);
    }
  };

  // Polygraph Functions
  const handleCreateSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role !== 'Business Administrator' && role !== 'Polygrapher') {
      setError('Only Business Administrators and Polygraphers can create appointment slots.');
      return;
    }
    setLoading(true);
    setError('');

    const now = new Date();
    const todayStr = getLocalDateString(now);
    const currentTimeStr = getLocalTimeString(now);

    if (!polyDate) {
      setError('Please select an appointment date.');
      setLoading(false);
      return;
    }

    if (!polyTime) {
      setError('Please select an appointment time.');
      setLoading(false);
      return;
    }

    if (polyDate < todayStr) {
      setError(`Appointment date cannot be in the past. Please select today (${todayStr}) or a future date.`);
      setLoading(false);
      return;
    }

    if (polyDate === todayStr && polyTime <= currentTimeStr) {
      setError(`Appointment time must be in the future (after ${formatDisplayTime(currentTimeStr)}).`);
      setLoading(false);
      return;
    }

    if (!polyExaminer) {
      setError('Please select an examiner for the appointment slot.');
      setLoading(false);
      return;
    }

    try {
      const res = await createPolygraphSlot({ 
        location: polyLocation, 
        address: polyAddress, 
        date: polyDate, 
        time: polyTime, 
        polygrapher: polyExaminer, 
        type: polyType, 
        comments: 'Scheduled Slot', 
        slots: 1
      });

      if (res?.error) {
        setError(res.error);
      } else {
        setSuccessMsg('Polygraph appointment slot created successfully!');
        const freshSlots = await getPolygraphSlots();
        setPolySlots(freshSlots);
        setPolySubTab('schedule');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create slot.');
    } finally {
      setLoading(false);
    }
  };

  // Opens the confirmation box; the assignment is only saved when it is accepted
  const openAssignConfirm = (slotId: number) => {
    if (!slotAssignments[slotId]) {
      setError('Please select a client to assign to this slot.');
      return;
    }
    setPendingAssignSlotId(slotId);
  };

  const handleAssignSlotToClient = async (slotId: number) => {
    if (role !== 'Business Administrator') {
      setError('Only Business Administrators can assign polygraph slots to clients.');
      return;
    }
    const clientId = slotAssignments[slotId];
    const assignedType = slotTypes[slotId] || 'Maintenance';
    if (!clientId) {
      setError('Please select a client to assign to this slot.');
      return;
    }

    setLoading(true);
    try {
      const res = await assignPolygraphSlot(slotId, Number(clientId), assignedType, user.employeeemail, (slotComments[slotId] || '').trim());
      if (res?.error) {
        setError(res.error);
      } else {
        setSlotComments({ ...slotComments, [slotId]: '' });
        const client = clients.find(c => String(c.clientid) === clientId);
        setSuccessMsg(`Assigned ${assignedType} Polygraph slot to ${client ? client.lastname + ', ' + client.firstname : 'Client'}!`);
        const freshSlots = await getPolygraphSlots();
        setPolySlots(freshSlots);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to assign client to slot.');
    } finally {
      setLoading(false);
    }
  };

  // Opens the cancellation prompt; the reservation is only cancelled when it is submitted
  const handleReopenSlot = (slotId: number) => {
    setReopenReason('');
    setReopenNotes('');
    setReopenTarget(polySlots.find(s => s.slotid === slotId) || { slotid: slotId });
  };

  const confirmReopenSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenTarget || !reopenReason) return;
    const slotId = reopenTarget.slotid;
    setLoading(true);
    try {
      const res = await reopenPolygraphSlot(slotId, { reason: reopenReason, notes: reopenNotes, user: user.employeeemail });
      if (res?.error) {
        setError(res.error);
      } else {
        setReopenTarget(null);
        setSuccessMsg('Reservation cancelled. Polygraph slot is now open for new bookings!');
        if (selectedSlotForResults?.slotid === slotId) {
          setSelectedSlotForResults(null);
        }
        const freshSlots = await getPolygraphSlots();
        setPolySlots(freshSlots);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reopen slot.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSlot = async (slotId: number) => {
    if (!window.confirm('Are you sure you want to delete this open polygraph slot?')) {
      return;
    }
    setLoading(true);
    try {
      const res = await deletePolygraphSlot(slotId);
      if (res?.error) {
        setError(res.error);
      } else {
        setSuccessMsg('Open polygraph slot deleted successfully!');
        if (selectedSlotForResults?.slotid === slotId) {
          setSelectedSlotForResults(null);
        }
        const freshSlots = await getPolygraphSlots();
        setPolySlots(freshSlots);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete slot.');
    } finally {
      setLoading(false);
    }
  };

  const handlePolyResultSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!selectedSlotForResults) {
    setError('Please select an assigned polygraph slot first.');
    return;
  }

  try {
    await submitPolygraphResult({ 
      client: Number(selectedSlotForResults.assignedClientId), 
      date: new Date().toISOString().split('T')[0], 
      type: selectedSlotForResults.type || 'Maintenance', 
      results: resResultType, 
      polygrapher: selectedSlotForResults.polygrapher || user.employeeemail, 
      notes: resNotes 
    });

    if (selectedSlotForResults.slotid) {
      await deletePolygraphSlot(selectedSlotForResults.slotid);
    }

    setSelectedSlotForResults(null);
    setResNotes('');
    setSuccessMsg('Polygraph result recorded and slot removed permanently!');
    loadDashboardData();
  } catch (err: any) {
    setError(err.message || 'Error completing polygraph slot.');
  }
};

  // Group Management Functions
  const handleOpenGroup = async (group: any) => {
    setSelectedGroupDetail(group);
    setEditGroupName(group.groupname);
    setEditLocation(normalizeLocation(group.location || ''));
    setEditProgramType(group.programtype || '');
    setEditCounselor(group.counselor);
    setEditSchedule(group.schedule);
    setEditAddress(group.address || '');
    setEditActive(group.active !== false);
    const roster = await getGroupClients(group.groupid);
    setGroupRoster(roster);
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupDetail || user?.role === 'Office Admin') return;
    try {
      await updateGroup(selectedGroupDetail.groupid, {
        groupName: editGroupName,
        location: denormalizeLocation(editLocation),
        counselor: editCounselor,
        programType: editProgramType,
        schedule: editSchedule,
        address: editAddress,
        active: editActive
      });
      setSelectedGroupDetail({
        ...selectedGroupDetail,
        groupname: editGroupName, location: editLocation, counselor: editCounselor, programtype: editProgramType,
        schedule: editSchedule, address: editAddress, active: editActive
      });
      setSuccessMsg('Group details updated successfully!');
      loadDashboardData();
    } catch (err: any) {
      setError(err.message || 'Error updating group.');
    }
  };

  // New client form state. Program status and program type start at the most common values.
  const emptyNewClient = {
    firstname: '', middlename: '', lastname: '', docnumber: '', supervisingagent: '', programstartdate: '',
    programstatus: 'Active', phase: 'Phase 1 - Weekly', programtype: 'State SO', groupid: '',
    address: '', city: '', county: '', state: '', zip: '',
    mainphone: '', altphone: '', emergencycontact: '', emergencycontactphone: '', comments: '',
    treatmentfee: 180, vouchers: ''
  };
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClient, setNewClient] = useState(emptyNewClient);
  const newClientField = (label: string, key: keyof typeof emptyNewClient, type = 'text', required = false, listId?: string) => (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}{required ? ' *' : ''}</label>
      <input type={type} required={required} list={listId} value={newClient[key]} onChange={(e) => setNewClient({ ...newClient, [key]: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" />
    </div>
  );

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await createClient({ ...newClient, groupid: newClient.groupid || null });
      setSuccessMsg(res.message || 'Client added successfully!');
      setNewClient(emptyNewClient);
      setShowNewClientForm(false);
      loadDashboardData();
    } catch (err: any) {
      setError(err.message || 'Error adding client.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await createGroup({ ...newGroup, location: denormalizeLocation(newGroup.location) });
      setSuccessMsg(res.message || 'Group created successfully!');
      setNewGroup(emptyNewGroup);
      setShowNewGroupForm(false);
      loadDashboardData();
    } catch (err: any) {
      setError(err.message || 'Error creating group.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroupDetail || user?.role !== 'Business Administrator') return;
    if (!window.confirm(`Delete group "${selectedGroupDetail.groupname}"? This cannot be undone.`)) return;
    setLoading(true);
    try {
      const res = await deleteGroup(selectedGroupDetail.groupid);
      setSuccessMsg(res.message || 'Group deleted successfully!');
      setSelectedGroupDetail(null);
      setGroupRoster([]);
      setGroupTab('roster');
      setAssignClientSearch('');
      loadDashboardData();
    } catch (err: any) {
      setError(err.message || 'Error deleting group.');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignClient = async (clientId: number) => {
    if (!selectedGroupDetail) return;
    await assignClientToGroup(selectedGroupDetail.groupid, clientId);
    const updatedRoster = await getGroupClients(selectedGroupDetail.groupid);
    setGroupRoster(updatedRoster);
    setAssignClientSearch('');
    setSuccessMsg('Client reassigned to group successfully!');
  };

  // Testing Functions
  const handleTestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testClient) return;
    await submitTestResult({
      client: Number(testClient),
      testType,
      score: testScore,
      notes: testNotes,
      date: new Date().toISOString().split('T')[0]
    });
    setSuccessMsg('Test result saved successfully!');
    setTestScore('');
    setTestNotes('');
    const history = await getClientTests(Number(testClient));
    setClientTestHistory(history);
  };

  const handleSelectTestClient = async (clientId: string) => {
    setTestClient(clientId);
    if (clientId) {
      const history = await getClientTests(Number(clientId));
      setClientTestHistory(history);
    }
  };

  // Reports Generators
  const handleLoadReports = async (type: string) => {
    if (type === 'agent') {
      const data = await getAgentReport();
      setAgentReportData(data);
    } else if (type === 'deposit') {
      const data = await getDepositReport();
      setDepositReportData(data);
    }
  };

  // Admin User Creation
  const resetEmployeeForm = () => {
    setEditingEmail(null);
    setEmpEmail('');
    setEmpName('');
    setEmpRole('Counselor');
    setEmpActive(true);
    setEmpPassword('');
  };

  const startEditEmployee = (emp: any) => {
    setEditingEmail(emp.employeeemail);
    setEmpEmail(emp.employeeemail);
    setEmpName(emp.displayname || '');
    setEmpRole(emp.role || 'Counselor');
    setEmpActive(emp.active !== false);
    setEmpPassword('');
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingEmail) {
        await updateEmployee(editingEmail, { displayName: empName, role: empRole, active: empActive, updatedBy: user.employeeemail, password: empPassword });
        setSuccessMsg(empPassword ? 'Account updated and password changed!' : 'Account updated successfully!');
      } else {
        await addEmployee({
          employeeEmail: empEmail,
          displayName: empName,
          role: empRole,
          location: empLoc,
          active: true,
          password: empPassword
        });
        setSuccessMsg('Employee account created successfully!');
      }
      resetEmployeeForm();
      const updated = await getEmployees();
      setEmployees(updated);
    } catch (err: any) {
      setError(err.message || 'Error saving account.');
    }
  };

  // Drawer Log Loading
  const openClientLogs = async (client: any) => {
    setSelectedClientDetail(client);
    setClientTab('information');
    setEditingClientInfo(false);
    setClientInfoForm({ ...client });
    setShowFeeOverrideForm(false);
    setFeeOverrideInput('');
    setFeeOverrideDate('');
    setClientFeeOverride(null);
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
    try {
      const { override } = await fetchClientFeeOverride(client.clientid);
      setClientFeeOverride(override);
    } catch (err: any) {
      setClientInfoError(err.message || 'Could not load the temporary fee override.');
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim() || !selectedClientDetail) return;
    await addClientNote(selectedClientDetail.clientid, {
      user: user.employeeemail,
      comments: newNoteText,
      category: newNoteCategory
    });
    setNewNoteText('');
    const updatedNotes = await getClientNotes(selectedClientDetail.clientid);
    setClientNotes(updatedNotes);
  };

  const handleStandalonePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || paymentAmount <= 0) return;
    setLoading(true);
    setLastPayment(null);
    const client = clients.find(c => c.clientid === Number(selectedClient));
    const res = await submitAccountPayment({
      client: Number(selectedClient),
      amount: paymentAmount,
      comments,
      createdBy: user.employeeemail,
      paymentMethod
    });
    if (res.success) {
      setSuccessMsg(`${paymentMethod} payment recorded! Updated Balance: ${formatBalance(res.newBalance)}`);
      setLastPayment({
        clientName: client ? `${client.lastname}, ${client.firstname}` : `Client #${selectedClient}`,
        docNumber: client?.docnumber || '',
        amount: paymentAmount,
        method: paymentMethod,
        notes: comments,
        newBalance: Number(res.newBalance),
        processedBy: user.employeeemail,
        date: new Date().toLocaleString()
      });
      loadDashboardData();
      setComments('');
    } else {
      setError(res.error || 'Error recording payment.');
    }
    setLoading(false);
  };

  const handleCustomChargeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chargeClient || chargeAmount <= 0 || !chargeNotes.trim()) return;
    setLoading(true);
    const res = await submitCustomCharge({
      client: Number(chargeClient),
      amount: chargeAmount,
      comments: chargeNotes.trim(),
      createdBy: user.employeeemail
    });
    if (res.success) {
      setSuccessMsg(`Custom fee of ${formatMoney(chargeAmount)} charged! Updated Balance: ${formatBalance(res.newBalance)}`);
      loadDashboardData();
      setChargeInput('');
      setChargeNotes('');
    } else {
      setError(res.error || 'Error charging custom fee.');
    }
    setLoading(false);
  };

  const handleCallInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (callInMode === 'client') {
      await submitClientCallIn({ client: Number(selectedClient), date: new Date(), comment: callInComment, createdBy: user.employeeemail, reason: callInReason || null });
      setSuccessMsg('Client call-in logged successfully!');
    } else {
      const res = await submitGroupCallIn({ group: Number(selectedGroup), date: new Date(), comment: callInComment, createdBy: user.employeeemail, reason: callInReason || null, callInDate: groupCallInDate || null });
      const forText = res.forDate ? ` for ${new Date(`${res.forDate}T00:00:00`).toLocaleDateString()}` : '';
      setSuccessMsg(`Group call-in logged${forText} for ${res.count} active clients!`);
    }
    setCallInComment('');
    setCallInReason('');
    setGroupCallInDate('');
    loadDashboardData();
    setLoading(false);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-white tracking-wide">STOP System</h1>
            <p className="text-slate-400 text-sm mt-1">Chandler & Associates Management</p>
          </div>
          {error && <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-lg mb-4 text-sm flex items-center gap-2"><AlertCircle size={18} /> {error}</div>}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Employee Email</label>
              <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">Password</label>
              <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} autoComplete="current-password" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 text-sm" required />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="rounded accent-blue-500" />
              Remember me on this computer
            </label>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-lg transition text-sm shadow-lg shadow-blue-600/30">Secure Login</button>
          </form>
        </div>
      </div>
    );
  }

  // Role Permissions
  const role = user.role;
  // Office Admins can view group details but not change them (including active status)
  const canEditGroupDetails = role !== 'Office Admin';
  const canDeleteGroups = role === 'Business Administrator';
  const isAllowed = (tab: string) => {
    if (role === 'Office Admin' || role === 'Business Administrator') return true;
    if (role === 'Counselor' || role === 'Therapist') return ['clients', 'attendance', 'callin', 'polygraph', 'groups', 'testing'].includes(tab);
    if (role === 'Billing') return ['clients', 'attendance', 'reports'].includes(tab);
    if (role === 'Polygrapher') return ['polygraph'].includes(tab);
    if (role === 'Supervisor' || role === 'PO') return ['clients', 'reports'].includes(tab);
    // Unknown roles get no sections, rather than full access
    return false;
  };

  // Client directory search: matches name, DOC #, agent, group, program, phase, and status
  const clientSearchTerm = clientSearch.trim().toLowerCase();
  const clientFilterActive = Object.values(clientFilters).some(Boolean);
  const distinctClientValues = (key: 'agent' | 'programtype' | 'currentgroup' | 'status') => {
    if (key === 'status') return ['Active', 'Completed', 'Deceased', 'Discharged', 'Failed - Non Attendance', 'Failed - Non Compliance', 'Inactive', 'Revoked', 'Transfered'];
    if (key === 'agent') return Array.from(new Set(clients.map(c => c.supervisingagent).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
    if (key === 'programtype') return Array.from(new Set(clients.map(c => c.programtype).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
    if (key === 'currentgroup') return Array.from(new Set(clients.map(c => c.groupname).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
    return [];
  };
  const filteredClients = clients
    .filter(c => {
      if (clientSearchTerm && ![
        c.firstname, c.lastname, `${c.firstname} ${c.lastname}`, `${c.lastname}, ${c.firstname}`,
        c.docnumber, c.supervisingagent, c.groupname, c.programtype, c.phase, c.programstatus
      ].some(v => String(v ?? '').toLowerCase().includes(clientSearchTerm))) return false;

      if (clientFilters.agent && c.supervisingagent !== clientFilters.agent) return false;
      if (clientFilters.programtype && c.programtype !== clientFilters.programtype) return false;
      if (clientFilters.currentgroup && c.groupname !== clientFilters.currentgroup) return false;
      if (clientFilters.status && c.programstatus !== clientFilters.status) return false;
      if (clientFilters.feeoverride === 'active' && (c.activefeeoverride === null || c.activefeeoverride === undefined)) return false;
      if (clientFilters.feeoverride === 'none' && c.activefeeoverride !== null && c.activefeeoverride !== undefined) return false;

      return true;
    });

  // Filter assigned slots for Poly Results tab
  const assignedSlots = polySlots.filter(s => s.status === 'Assigned' || s.assignedClientId);

  // Filter examiners from employees
  const polyExaminers = employees.filter(e => 
    e.role === 'Polygrapher' || /polygraph|examiner/i.test(e.role || '') || /examiner/i.test(e.displayname || '')
  );
  const otherStaff = employees.filter(e => !polyExaminers.some(ex => ex.employeeemail === e.employeeemail));
  const getExaminerDisplayName = (email: string) => 
    employees.find(e => e.employeeemail === email)?.displayname || email;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header Navigation */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600/20 border border-blue-500/30 p-2 rounded-lg text-blue-400"><ShieldCheck size={24} /></div>
          <div>
            <h1 className="font-bold text-lg text-white">STOP Software Suite</h1>
            <p className="text-xs text-slate-400">Chandler & Associates — {user.location}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-medium text-white">{user.displayname}</p>
            <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20 font-semibold">{user.role}</span>
          </div>
          <button onClick={() => setUser(null)} className="bg-slate-800 hover:bg-slate-700 p-2 rounded-lg text-slate-400 hover:text-white transition"><LogOut size={18} /></button>
        </div>
      </header>

      {/* Main Navigation Tabs */}
      <nav className="bg-slate-900/60 border-b border-slate-800 px-6 flex gap-1 overflow-x-auto">
        <button onClick={() => setActiveTab('home')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'home' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><Home size={16} /> Home</button>
        {isAllowed('clients') && <button onClick={() => setActiveTab('clients')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'clients' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><Users size={16} /> Client Roster</button>}
        {isAllowed('attendance') && <button onClick={() => setActiveTab('attendance')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'attendance' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><ClipboardCheck size={16} /> Attendance & Sign-In</button>}
        {isAllowed('callin') && <button onClick={() => setActiveTab('callin')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'callin' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><PhoneCall size={16} /> Call-In Log</button>}
        {isAllowed('groups') && <button onClick={() => setActiveTab('groups')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'groups' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><Layers size={16} /> Groups</button>}
        {isAllowed('testing') && <button onClick={() => setActiveTab('testing')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'testing' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><CheckSquare size={16} /> Testing</button>}
        {isAllowed('polygraph') && <button onClick={() => setActiveTab('polygraph')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'polygraph' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><ShieldAlert size={16} /> Polygraphs</button>}
        {isAllowed('reports') && <button onClick={() => setActiveTab('reports')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'reports' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><BarChart3 size={16} /> Reports</button>}
        {isAllowed('admin') && <button onClick={() => setActiveTab('admin')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'admin' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><Settings size={16} /> Admin</button>}
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {successMsg && (
          <div className="bg-emerald-500/10 border border-emerald-500 text-emerald-400 p-4 rounded-xl mb-6 text-sm flex justify-between items-center">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg('')} className="text-emerald-400 hover:text-emerald-200 ml-4"><X size={16} /></button>
          </div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-400 p-4 rounded-xl mb-6 text-sm flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-200 ml-4"><X size={16} /></button>
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
                <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Clients</p>
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
                  { tab: 'callin', icon: PhoneCall, label: 'Call-In Log', description: 'Log client and group call-ins.' },
                  { tab: 'groups', icon: Layers, label: 'Groups', description: 'Manage group schedules, counselors, and rosters.' },
                  { tab: 'testing', icon: CheckSquare, label: 'Testing', description: 'Record and review test results.' },
                  { tab: 'polygraph', icon: ShieldAlert, label: 'Polygraphs', description: 'Schedule polygraph slots and record results.' },
                  { tab: 'reports', icon: BarChart3, label: 'Reports', description: 'Agent and deposit reports.' },
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

        {activeTab === 'clients' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <div className="p-5 border-b border-slate-800 space-y-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="font-semibold text-white">Active Client Directory</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Click any client row to view detailed attendance, ledger, notes, and polygraph logs.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setShowNewClientForm(s => !s)} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap">+ New Client</button>
                  <input
                    type="search"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Search name, DOC #, agent, group..."
                    className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs w-64 max-w-full"
                  />
                  <span className="text-xs bg-slate-800 px-3 py-1 rounded-full text-slate-300 whitespace-nowrap">
                    {filteredClients.length === clients.length ? `${clients.length} Registered Clients` : `${filteredClients.length} of ${clients.length} Clients`}
                  </span>
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                <select
                  value={clientFilters.agent}
                  onChange={(e) => setClientFilters({ ...clientFilters, agent: e.target.value })}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
                >
                  <option value="">Agent: All</option>
                  {distinctClientValues('agent').map(agent => (
                    <option key={agent} value={agent}>{agent}</option>
                  ))}
                </select>

                <select
                  value={clientFilters.programtype}
                  onChange={(e) => setClientFilters({ ...clientFilters, programtype: e.target.value })}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
                >
                  <option value="">Program Type: All</option>
                  {distinctClientValues('programtype').map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>

                <select
                  value={clientFilters.currentgroup}
                  onChange={(e) => setClientFilters({ ...clientFilters, currentgroup: e.target.value })}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
                >
                  <option value="">Current Group: All</option>
                  {distinctClientValues('currentgroup').map(group => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>

                <select
                  value={clientFilters.status}
                  onChange={(e) => setClientFilters({ ...clientFilters, status: e.target.value })}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
                >
                  <option value="">Status: All</option>
                  {distinctClientValues('status').map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>

                <select
                  value={clientFilters.feeoverride}
                  onChange={(e) => setClientFilters({ ...clientFilters, feeoverride: e.target.value })}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
                >
                  <option value="">Fee Override: All</option>
                  <option value="active">Reduced fee active</option>
                  <option value="none">No override</option>
                </select>

                {clientFilterActive && (
                  <button
                    type="button"
                    onClick={() => setClientFilters({ agent: '', programtype: '', currentgroup: '', status: 'Active', feeoverride: '' })}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            </div>

            {showNewClientForm && (
              <form onSubmit={handleCreateClient} className="p-5 border-b border-slate-800 bg-slate-950/50 space-y-4 text-sm">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Section 1 – Personal Info */}
                  <div className="md:col-span-3">
                    <h4 className="text-xs font-semibold text-blue-400 uppercase mb-3 tracking-wider">Personal Information</h4>
                  </div>
                  {newClientField('First Name', 'firstname', 'text', true)}
                  {newClientField('Middle Name', 'middlename')}
                  {newClientField('Last Name', 'lastname', 'text', true)}
                  {newClientField('DOC #', 'docnumber', 'text', true)}
                  {newClientField('Supervising Agent', 'supervisingagent', 'text', true)}
                  {newClientField('Program Start Date', 'programstartdate', 'date', true)}

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Program Status *</label>
                    <select required value={newClient.programstatus} onChange={(e) => setNewClient({ ...newClient, programstatus: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm">
                      {PROGRAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Section 2 – Program & Account Info */}
                  <div className="md:col-span-3">
                    <h4 className="text-xs font-semibold text-blue-400 uppercase mb-3 tracking-wider">Program &amp; Account Info</h4>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Program Type</label>
                    <select value={newClient.programtype} onChange={(e) => {
                      const programType = e.target.value;
                      setNewClient({
                        ...newClient,
                        programtype: programType,
                        phase: SO_PROGRAM_TYPES.includes(programType) ? 'Phase 1 - Weekly' : programType === 'BIP' ? '0' : '',
                        treatmentfee: programType === 'BIP' ? 35 : (programType === 'State SO' ? 180 : 0)
                      });
                    }} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm">
                      <option value="State SO">State SO</option>
                      <option value="Federal SO">Federal SO</option>
                      <option value="BIP">BIP</option>
                      <option value="Private Pay">Private Pay</option>
                      <option value="DOC">DOC</option>
                    </select>
                  </div>

                  {SO_PROGRAM_TYPES.includes(newClient.programtype) && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Phase</label>
                      <select value={newClient.phase} disabled className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm opacity-60 cursor-not-allowed">
                        {SO_PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  )}

                  {newClient.programtype === 'BIP' && (
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Week</label>
                      <input type="number" min={0} step={1} value={newClient.phase} onChange={(e) => setNewClient({ ...newClient, phase: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Group</label>
                    <select value={newClient.groupid} onChange={(e) => setNewClient({ ...newClient, groupid: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm">
                      <option value="">-- None --</option>
                      {activeGroups.filter(g => (!GROUP_TYPES_BY_PROGRAM[newClient.programtype || '']
                        || GROUP_TYPES_BY_PROGRAM[newClient.programtype || ''].includes((g.programtype || '').trim().toUpperCase()))
                      ).map(g => <option key={g.groupid} value={g.groupid}>{g.groupname}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Treatment Fee</label>
                    <input type="number" step="0.01" value={newClient.treatmentfee} onChange={(e) => setNewClient({ ...newClient, treatmentfee: Number(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" />
                  </div>

                  {newClientField('Vouchers', 'vouchers', 'number')}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Section 3 – Contact Info */}
                  <div className="md:col-span-3">
                    <h4 className="text-xs font-semibold text-blue-400 uppercase mb-3 tracking-wider">Contact Information</h4>
                  </div>
                  {newClientField('Address', 'address')}
                  {newClientField('City', 'city')}
                  {newClientField('County', 'county')}
                  {newClientField('State', 'state')}
                  {newClientField('ZIP', 'zip')}
                  {newClientField('Main Phone', 'mainphone', 'tel')}
                  {newClientField('Alt Phone', 'altphone', 'tel')}
                  {newClientField('Emergency Contact', 'emergencycontact')}
                  {newClientField('Emergency Phone', 'emergencycontactphone', 'tel')}
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Comments</label>
                  <textarea value={newClient.comments} onChange={(e) => setNewClient({ ...newClient, comments: e.target.value })} rows={2} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button type="button" onClick={() => { setShowNewClientForm(false); setNewClient(emptyNewClient); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Cancel</button>
                  <button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold">Add Client</button>
                </div>
              </form>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    <th className="p-3">Full Name</th>
                    <th className="p-3">DOC #</th>
                    <th className="p-3">Agent</th>
                    <th className="p-3">Program Type</th>
                    <th className="p-3">Phase</th>
                    <th className="p-3">Current Group</th>
                    <th className="p-3">Last Attended</th>
                    <th className="p-3">Last Poly</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-sm">
                  {filteredClients.map((c) => (
                    <tr key={c.clientid} onClick={() => openClientLogs(c)} className="hover:bg-slate-800/50 cursor-pointer transition">
                      <td className="p-3 font-medium text-white whitespace-nowrap">{c.lastname}, {c.firstname}</td>
                      <td className="p-3 text-slate-400 font-mono text-xs">{c.docnumber}</td>
                      <td className="p-3 text-slate-300 text-xs">{c.supervisingagent}</td>
                      <td className="p-3"><span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded text-xs font-semibold">{c.programtype || 'State SO'}</span></td>
                      <td className="p-3 text-xs"><span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">{formatPhase(c.programtype, c.phase) || 'N/A'}</span></td>
                      <td className="p-3 text-slate-300 text-xs">{c.groupname || 'Unassigned'}</td>
                      <td className="p-3 text-slate-400 text-xs">{c.lastattended ? new Date(c.lastattended).toLocaleDateString() : 'Never'}</td>
                      <td className="p-3 text-slate-400 text-xs">{c.lastpoly ? new Date(c.lastpoly).toLocaleDateString() : 'None'}</td>
                      <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.programstatus === 'Active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>{c.programstatus}</span></td>
                      <td className={`p-3 font-semibold ${toDisplayBalance(c.accountbalance) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(c.accountbalance)}</td>
                    </tr>
                  ))}
                  {filteredClients.length === 0 && (
                    <tr>
                      <td colSpan={10} className="p-6 text-center text-slate-500 text-sm">No clients match your filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CLIENT DETAILS DRAWER */}
        {selectedClientDetail && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex justify-end z-50">
            <div className="bg-slate-900 w-full max-w-4xl h-full border-l border-slate-800 flex flex-col shadow-2xl p-6 overflow-y-auto">
              <div className="flex justify-between items-start border-b border-slate-800 pb-4 mb-6">
                <div>
                  <h2 className="text-xl font-bold text-white">{selectedClientDetail.firstname} {selectedClientDetail.lastname}</h2>
                  <p className="text-xs text-slate-400 mt-1">DOC #: <span className="text-slate-200 font-mono">{selectedClientDetail.docnumber}</span> | Program: <span className="text-blue-400 font-semibold">{selectedClientDetail.programtype || 'State SO'}</span> | Agent: {selectedClientDetail.supervisingagent}</p>
                </div>
                <div className="flex gap-2">
                  {role === 'Business Administrator' && (
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Delete client ${selectedClientDetail.firstname} ${selectedClientDetail.lastname}? This action cannot be undone.`)) return;
                        setLoading(true);
                        try {
                          await deleteClient(selectedClientDetail.clientid);
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
                  <button onClick={() => setSelectedClientDetail(null)} className="text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800"><X size={20} /></button>
                </div>
              </div>

              <div className="flex border-b border-slate-800 gap-4 mb-6">
                <button onClick={() => setClientTab('information')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase ${clientTab === 'information' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><Users size={14} /> Information</button>
                <button onClick={() => setClientTab('attendance')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase ${clientTab === 'attendance' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><Calendar size={14} /> Attendance</button>
                <button onClick={() => setClientTab('financials')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase ${clientTab === 'financials' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><DollarSign size={14} /> Financial Ledger</button>
                <button onClick={() => setClientTab('notes')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase ${clientTab === 'notes' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><FileText size={14} /> Case Notes</button>
                <button onClick={() => setClientTab('polygraphs')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase ${clientTab === 'polygraphs' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><Activity size={14} /> Polygraphs</button>
              </div>

              {clientTab === 'information' && (
                <div className="space-y-5">
                  {clientInfoError && (
                    <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-lg text-sm flex justify-between items-center gap-3">
                      <span>{clientInfoError}</span>
                      <button onClick={() => setClientInfoError('')} className="text-red-400 hover:text-red-200"><X size={14} /></button>
                    </div>
                  )}

                  {/* Edit / Save toolbar */}
                  <div className="flex justify-end">
                    {!editingClientInfo ? (
                      <button
                        onClick={() => { setEditingClientInfo(true); setClientInfoForm({ ...selectedClientDetail }); }}
                        className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                      >
                        <Settings size={13} /> Edit Info
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingClientInfo(false)}
                          className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-1.5 rounded-lg text-xs font-semibold"
                        >Cancel</button>
                        <button
                          disabled={savingClientInfo}
                          onClick={async () => {
                            setSavingClientInfo(true);
                            setClientInfoError('');
                            try {
                              const res = await updateClient(selectedClientDetail.clientid, clientInfoForm);
                              // Prefer the row the server returned (includes joined group name); fall back to the form values
                              const saved = { ...selectedClientDetail, ...clientInfoForm, ...(res.client ?? {}) };
                              setSelectedClientDetail(saved);
                              setClients(prev => prev.map(c => c.clientid === saved.clientid ? { ...c, ...saved } : c));
                              setEditingClientInfo(false);
                            } catch (err: unknown) {
                              // Stay in edit mode so nothing typed is lost
                              setClientInfoError(err instanceof Error ? err.message : 'Failed to save client information.');
                            } finally {
                              setSavingClientInfo(false);
                            }
                          }}
                          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                        >
                          <CheckCircle2 size={13} /> Save Changes
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Section 1 – Personal Info */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
                    <h3 className="text-xs font-bold uppercase text-blue-400 mb-4 tracking-wider">Personal Information</h3>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                      {[
                        { label: 'First Name', field: 'firstname' },
                        { label: 'Last Name', field: 'lastname' },
                        { label: 'Middle Name', field: 'middlename' },
                        { label: 'DOC #', field: 'docnumber' },
                        { label: 'Supervising Agent', field: 'supervisingagent' },
                        { label: 'Program Status', field: 'programstatus' },
                        { label: (editingClientInfo ? clientInfoForm.programtype : selectedClientDetail.programtype) === 'BIP' ? 'Week' : 'Phase', field: 'phase' },
                        { label: 'Program Start Date', field: 'programstartdate' },
                        { label: 'Last Date Attended', field: 'lastdateattended' },
                      ].map(({ label, field }) => (
                        <div key={field}>
                          <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                          {editingClientInfo && field === 'programstatus' ? (
                            <select
                              value={clientInfoForm.programstatus || ''}
                              onChange={e => setClientInfoForm((f: any) => ({ ...f, programstatus: e.target.value }))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            >
                              <option value="">-- Select status --</option>
                              {PROGRAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                              {clientInfoForm.programstatus && !PROGRAM_STATUSES.includes(clientInfoForm.programstatus) && (
                                <option value={clientInfoForm.programstatus}>{clientInfoForm.programstatus} (current)</option>
                              )}
                            </select>
                          ) : editingClientInfo && field === 'phase' && SO_PROGRAM_TYPES.includes(clientInfoForm.programtype || '') ? (
                            <select
                              value={clientInfoForm.phase || ''}
                              onChange={e => {
                                const phase = e.target.value;
                                setClientInfoForm((f: any) => ({
                                  ...f,
                                  phase,
                                  ...(SO_TREATMENT_FEES[phase] !== undefined ? { treatmentfee: SO_TREATMENT_FEES[phase] } : {}),
                                }));
                              }}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            >
                              <option value="">-- Select phase --</option>
                              {SO_PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                              {clientInfoForm.phase && !SO_PHASES.includes(clientInfoForm.phase) && (
                                <option value={clientInfoForm.phase}>{clientInfoForm.phase} (current)</option>
                              )}
                            </select>
                          ) : editingClientInfo && field === 'phase' && clientInfoForm.programtype === 'BIP' ? (
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={clientInfoForm.phase ?? ''}
                              onChange={e => setClientInfoForm((f: any) => ({ ...f, phase: e.target.value }))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            />
                          ) : editingClientInfo ? (
                            <input
                              type={field.includes('date') || field.includes('Date') ? 'date' : 'text'}
                              value={clientInfoForm[field] ? (field.includes('date') || field.includes('Date') ? String(clientInfoForm[field]).split('T')[0] : clientInfoForm[field]) : ''}
                              onChange={e => setClientInfoForm((f: any) => ({ ...f, [field]: e.target.value }))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            />
                          ) : (
                            <p className="text-white font-medium">
                              {field.includes('date') || field.includes('Date')
                                ? (selectedClientDetail[field] ? new Date(selectedClientDetail[field]).toLocaleDateString() : '—')
                                : ((field === 'phase' ? formatPhase(selectedClientDetail.programtype, selectedClientDetail.phase) : selectedClientDetail[field]) || '—')}
                            </p>
                          )}
                        </div>
                      ))}
                      {/* Derived from polygraph results, so shown read-only and only for the SO programs */}
                      {SO_PROGRAM_TYPES.includes((editingClientInfo ? clientInfoForm.programtype : selectedClientDetail.programtype) || '') && (
                        <div>
                          <p className="text-xs text-slate-500 mb-0.5">Last Polygraph</p>
                          <p className="text-white font-medium">{selectedClientDetail.lastpoly ? new Date(selectedClientDetail.lastpoly).toLocaleDateString() : '—'}</p>
                        </div>
                      )}
                      <div className="col-span-2">
                        <p className="text-xs text-slate-500 mb-0.5">Comments</p>
                        {editingClientInfo ? (
                          <textarea
                            rows={3}
                            value={clientInfoForm.comments || ''}
                            onChange={e => setClientInfoForm((f: any) => ({ ...f, comments: e.target.value }))}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                          />
                        ) : (
                          <p className="text-white font-medium">{selectedClientDetail.comments || '—'}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Section 2 – Contact Info */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
                    <h3 className="text-xs font-bold uppercase text-blue-400 mb-4 tracking-wider">Contact Information</h3>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                      {[
                        { label: 'Address', field: 'address' },
                        { label: 'City', field: 'city' },
                        { label: 'County', field: 'county' },
                        { label: 'State', field: 'state' },
                        { label: 'Zip', field: 'zip' },
                        { label: 'Main Phone', field: 'mainphone' },
                        { label: 'Alt Phone', field: 'altphone' },
                        { label: 'Emergency Contact', field: 'emergencycontact' },
                        { label: 'Emergency Contact Phone', field: 'emergencycontactphone' },
                      ].map(({ label, field }) => (
                        <div key={field}>
                          <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                          {editingClientInfo ? (
                            <input
                              type="text"
                              value={clientInfoForm[field] || ''}
                              onChange={e => setClientInfoForm((f: any) => ({ ...f, [field]: e.target.value }))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            />
                          ) : (
                            <p className="text-white font-medium">{selectedClientDetail[field] || '—'}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Section 3 – Program & Account Info */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
                    <h3 className="text-xs font-bold uppercase text-blue-400 mb-4 tracking-wider">Program &amp; Account Info</h3>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                      <div>
                        <p className="text-xs text-slate-500 mb-0.5">Program Type</p>
                        {editingClientInfo ? (
                          <select
                            value={clientInfoForm.programtype || ''}
                            onChange={e => {
                              const programType = e.target.value;
                              setClientInfoForm((f: any) => ({
                                ...f,
                                programtype: programType,
                                ...(programType === 'BIP' ? { treatmentfee: 35 } : {}),
                                // Switching programs resets the phase/week to one that fits the new program
                                ...(SO_PROGRAM_TYPES.includes(programType) && !SO_PHASES.includes(f.phase) ? { phase: 'Phase 1 - Weekly' } : {}),
                                ...(programType === 'BIP' && !isWholeNumber(f.phase) ? { phase: '0' } : {}),
                              }));
                            }}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                          >
                            <option value="">-- Select --</option>
                            <option value="State SO">State SO</option>
                            <option value="Federal SO">Federal SO</option>
                            <option value="BIP">BIP</option>
                            <option value="Private Pay">Private Pay</option>
                            <option value="DOC">DOC</option>
                          </select>
                        ) : (
                          <p className="text-white font-medium">{selectedClientDetail.programtype || '—'}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-0.5">Group</p>
                        {editingClientInfo ? (
                          <select
                            value={clientInfoForm.groupid || ''}
                            onChange={e => setClientInfoForm((f: any) => ({ ...f, groupid: e.target.value }))}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                          >
                            <option value="">-- None --</option>
                            {groups.filter(g => (g.active !== false || g.groupid === clientInfoForm.groupid)
                              && (!GROUP_TYPES_BY_PROGRAM[clientInfoForm.programtype || '']
                                || GROUP_TYPES_BY_PROGRAM[clientInfoForm.programtype || ''].includes((g.programtype || '').trim().toUpperCase())
                                || g.groupid === clientInfoForm.groupid)
                            ).map(g => <option key={g.groupid} value={g.groupid}>{g.groupname}{g.active === false ? ' (inactive)' : ''}</option>)}
                          </select>
                        ) : (
                          <p className="text-white font-medium">{groups.find(g => g.groupid === selectedClientDetail.groupid)?.groupname || selectedClientDetail.groupid || '—'}</p>
                        )}
                      </div>
                      {[
                        { label: 'Treatment Fee', field: 'treatmentfee', prefix: '$' },
                        { label: 'Account Balance', field: 'accountbalance', prefix: '$' },
                        { label: 'Vouchers', field: 'vouchers', prefix: '' },
                      ].map(({ label, field, prefix }) => (
                        <div key={field}>
                          <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                          {editingClientInfo ? (
                            <input
                              type="number"
                              step="0.01"
                              value={field === 'accountbalance' && clientInfoForm[field] !== '' && clientInfoForm[field] != null ? toDisplayBalance(clientInfoForm[field]) : (clientInfoForm[field] ?? '')}
                              onChange={e => setClientInfoForm((f: any) => ({ ...f, [field]: field === 'accountbalance' && e.target.value !== '' ? toDisplayBalance(e.target.value) : e.target.value }))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            />
                          ) : field === 'accountbalance' ? (
                            <p className="font-medium text-emerald-400">{formatBalance(selectedClientDetail[field])}</p>
                          ) : (
                            <p className="font-medium text-white">
                              {prefix}{selectedClientDetail[field] != null ? Number(selectedClientDetail[field]).toFixed(2) : '—'}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Section 4 – Temporary Fee Override */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-xs font-bold uppercase text-blue-400 tracking-wider">Temporary Fee Override</h3>
                      {role === 'Business Administrator' && (
                        <button
                          type="button"
                          onClick={() => setShowFeeOverrideForm(!showFeeOverrideForm)}
                          className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                        >
                          {showFeeOverrideForm ? 'Cancel' : clientFeeOverride ? 'Change Temporary Fee' : 'Set Temporary Fee'}
                        </button>
                      )}
                    </div>

                    {clientFeeOverride ? (
                      <div className="bg-slate-900 border border-emerald-500/30 rounded-lg p-4 mb-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Reduced Fee</p>
                            <p className="text-white font-semibold text-lg">${Number(clientFeeOverride.reducedfee).toFixed(2)}</p>
                            <p className="text-xs text-slate-500 mt-0.5">Regular fee: ${Number(selectedClientDetail.treatmentfee || 0).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Expires (last day at reduced rate)</p>
                            {/* DATE columns arrive as an ISO timestamp; keep only the date part so it isn't shifted a day by time zones */}
                            <p className="text-white font-semibold">{parseLogDate(String(clientFeeOverride.expirationdate).split('T')[0])?.toLocaleDateString()}</p>
                          </div>
                        </div>
                        {role === 'Business Administrator' && (
                          <button
                            type="button"
                            onClick={async () => {
                              setLoading(true);
                              setClientInfoError('');
                              try {
                                await deleteClientFeeOverride(selectedClientDetail.clientid, user.employeeemail);
                                setClientFeeOverride(null);
                                setSuccessMsg('Temporary fee override removed. Regular fee will apply.');
                                loadDashboardData();
                              } catch (err: any) {
                                setClientInfoError(err.message || 'Failed to remove fee override.');
                              } finally {
                                setLoading(false);
                              }
                            }}
                            className="mt-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-lg text-xs font-semibold w-full"
                          >
                            Remove Override
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">No temporary fee override is active. Regular fee applies: ${Number(selectedClientDetail.treatmentfee || 0).toFixed(2)}</p>
                    )}

                    {showFeeOverrideForm && role === 'Business Administrator' && (
                      <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (feeOverrideInput === '' || !feeOverrideDate) {
                          setClientInfoError('Please enter a reduced fee and expiration date.');
                          return;
                        }
                        if (feeOverrideDate < getLocalDateString()) {
                          setClientInfoError('The expiration date cannot be in the past.');
                          return;
                        }
                        setLoading(true);
                        setClientInfoError('');
                        try {
                          const result = await saveClientFeeOverride(selectedClientDetail.clientid, Number(feeOverrideInput), feeOverrideDate, user.employeeemail);
                          setClientFeeOverride(result.override);
                          setShowFeeOverrideForm(false);
                          setFeeOverrideInput('');
                          setFeeOverrideDate('');
                          setSuccessMsg(`Temporary fee set to $${Number(feeOverrideInput).toFixed(2)} through ${parseLogDate(feeOverrideDate)?.toLocaleDateString()}.`);
                          loadDashboardData();
                        } catch (err: any) {
                          setClientInfoError(err.message || 'Failed to set fee override.');
                        } finally {
                          setLoading(false);
                        }
                      }} className="space-y-3 border-t border-slate-800 pt-4 mt-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Reduced Fee Amount *</label>
                          <input
                            type="number"
                            step="0.01"
                            value={feeOverrideInput}
                            onChange={(e) => setFeeOverrideInput(e.target.value)}
                            placeholder="e.g., 90.00"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Expiration Date *</label>
                          <input
                            type="date"
                            value={feeOverrideDate}
                            onChange={(e) => setFeeOverrideDate(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            required
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowFeeOverrideForm(false);
                              setFeeOverrideInput('');
                              setFeeOverrideDate('');
                            }}
                            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                          >
                            Set Override
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              )}

              {clientTab === 'attendance' && (

                <div className="space-y-3">{clientAttendance.map(att => (
                  <div key={att.attendanceid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex gap-5">
                    <div className="shrink-0 w-28 flex flex-col justify-center border-r border-slate-800 pr-5">
                      <p className="text-2xl font-bold text-white leading-tight">{formatLogMonthDay(att.date)}</p>
                      <p className="text-sm text-slate-400 mt-0.5">{formatLogYear(att.date)}</p>
                    </div>
                    <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex justify-between items-start gap-3">
                      <p className="font-semibold text-white">{att.groupname || 'Group Session'}</p>
                      <span className={`text-xs font-semibold whitespace-nowrap ${toDisplayBalance(att.accounttotal) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(att.accounttotal)} Balance</span>
                    </div>
                    {(() => { const c = attendanceBalanceChange(att); return (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
                        <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Fee Applied</p>
                        <p className="text-red-400 font-semibold mt-0.5">{signedMoney(c.fee)}</p>
                      </div>
                      <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
                        <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Amount Paid</p>
                        <p className="text-emerald-400 font-semibold mt-0.5">{signedMoney(c.paid)}</p>
                      </div>
                      <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-1">
                        <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Balance Change</p>
                        <div className="flex justify-between text-slate-300"><span>Previous</span><span>{signedMoney(c.before)}</span></div>
                        <div className="flex justify-between text-red-400"><span>- Fee</span><span>{signedMoney(-c.fee)}</span></div>
                        <div className="flex justify-between text-emerald-400"><span>+ Paid</span><span>{signedMoney(c.paid)}</span></div>
                        <div className={`flex justify-between border-t border-slate-800 pt-1 font-semibold ${c.after < 0 ? 'text-red-400' : 'text-white'}`}><span>New</span><span>{signedMoney(c.after)}</span></div>
                      </div>
                    </div>
                    ); })()}
                    <p className="text-xs text-slate-300">{att.comments || 'No comments'}</p>
                    </div>
                  </div>
                ))}</div>
              )}

              {clientTab === 'financials' && (
                <div className="space-y-3">{clientFinancials.map(fin => (<div key={fin.transactionid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex justify-between items-center text-sm"><div><p className="font-semibold text-white">
                      {fin.feetype || fin.type}
                      {fin.type === 'Payment' && fin.paymentmethod && (
                        <span className="ml-2 align-middle text-[10px] uppercase tracking-wide bg-slate-800 text-slate-300 px-2 py-0.5 rounded">{fin.paymentmethod}</span>
                      )}
                    </p><p className="text-xs text-slate-400">{new Date(fin.date).toLocaleString()} — {fin.comments}</p></div><div className="text-right">
                  <p className={`font-bold ${fin.type === 'Charge' ? 'text-red-400' : 'text-emerald-400'}`}>${Number(fin.amount).toFixed(2)}</p>
                  {(() => { const b = ledgerBalanceChange(fin); return b && (
                    <p className={`text-xs mt-1 ${b.after < 0 ? 'text-red-400' : 'text-slate-400'}`}>Balance {signedMoney(b.before)} → {signedMoney(b.after)}</p>
                  ); })()}
                </div></div>))}</div>
              )}

              {clientTab === 'notes' && (
                <div className="space-y-4">
                  <form onSubmit={handleAddNote} className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-3">
                    <textarea value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)} placeholder="Type case note..." rows={2} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
                    <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-semibold ml-auto flex items-center gap-1"><PlusCircle size={14} /> Save Note</button>
                  </form>
                  {clientNotes.map(n => (
                    <div key={n.noteid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex gap-5">
                      <div className="shrink-0 w-28 flex flex-col justify-center border-r border-slate-800 pr-5">
                        <p className="text-2xl font-bold text-white leading-tight">{formatLogMonthDay(n.date)}</p>
                        <p className="text-sm text-slate-400 mt-0.5">{formatLogYear(n.date)}</p>
                        <p className="text-xs text-slate-500 mt-1">{formatLogTime(n.date)}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-blue-400 font-semibold">{caseNoteLabel(n)}</span>
                        <p className="text-slate-200 mt-1 whitespace-pre-wrap">{n.comments}</p>
                        <p className="text-xs text-slate-500 text-right mt-2">— {n.User}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {clientTab === 'polygraphs' && (
                <div className="space-y-3">{clientPolygraphs.map(poly => (
                  <div key={poly.resultid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex gap-5">
                    <div className="shrink-0 w-28 flex flex-col justify-center border-r border-slate-800 pr-5">
                      <p className="text-2xl font-bold text-white leading-tight">{formatLogMonthDay(poly.date)}</p>
                      <p className="text-sm text-slate-400 mt-0.5">{formatLogYear(poly.date)}</p>
                      <p className="text-xs text-slate-500 mt-1">{formatLogTime(poly.date)}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-3 font-semibold text-white">
                        <span>{poly.type} Polygraph</span>
                        <span className="text-xs text-emerald-400 text-right">{poly.results}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Examiner: {getExaminerDisplayName(poly.polygrapher)}</p>
                    </div>
                  </div>
                ))}</div>
              )}
            </div>
          </div>
        )}

        {/* FULL ATTENDANCE & SIGN-IN TAB */}
        {activeTab === 'attendance' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
              <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
                <div><h2 className="text-lg font-bold text-white">Attendance Sign-In & Payment Entry</h2><p className="text-xs text-slate-400 mt-0.5">Record attendance, cross-group makeups, or standalone ledger payments.</p></div>
                <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button onClick={() => { setIsAccountOnly(false); setIsCustomCharge(false); }} className={`px-3 py-1.5 rounded text-xs font-semibold ${!isAccountOnly && !isCustomCharge ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Attendance + Payment</button>
                  <button onClick={() => { setIsAccountOnly(true); setIsCustomCharge(false); }} className={`px-3 py-1.5 rounded text-xs font-semibold ${isAccountOnly && !isCustomCharge ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Account-Only Payment</button>
                  {role === 'Business Administrator' && (
                    <button onClick={() => setIsCustomCharge(true)} className={`px-3 py-1.5 rounded text-xs font-semibold ${isCustomCharge ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Custom Charge</button>
                  )}
                </div>
              </div>

              {isCustomCharge && role === 'Business Administrator' ? (
                <form onSubmit={handleCustomChargeSubmit} className="space-y-5 max-w-xl">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Client</label>
                    <select value={chargeClient} onChange={(e) => setChargeClient(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required>
                      <option value="">Select a client…</option>
                      {clients.map(c => <option key={c.clientid} value={c.clientid}>{c.lastname}, {c.firstname}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Fee Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                      <input type="number" step="0.01" min="0.01" value={chargeInput} onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }} onChange={(e) => setChargeInput(e.target.value.replace(/-/g, ''))} placeholder="0.00" className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 pl-7 pr-3 text-white text-sm" required />
                    </div>
                    {chargeClientRecord ? (
                      <div className="mt-3 bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Current balance</span>
                          <span className={toDisplayBalance(chargeCurrentBalance) < 0 ? 'text-red-400' : 'text-emerald-400'}>{formatMoney(toDisplayBalance(chargeCurrentBalance))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">This charge</span>
                          <span className="text-red-400">-{formatMoney(chargeAmount)}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-800 pt-1.5">
                          <span className="font-semibold text-slate-300">Balance after charge</span>
                          <span className={`font-bold ${toDisplayBalance(balanceAfterCharge) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatMoney(toDisplayBalance(balanceAfterCharge))}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 mt-1.5">Select a client to see their account balance.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes</label>
                    <textarea value={chargeNotes} onChange={(e) => setChargeNotes(e.target.value)} rows={3} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" placeholder="Reason for this fee…" required />
                  </div>

                  <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
                    <button type="submit" disabled={loading || !chargeNotes.trim()} className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm mt-4">Charge Fee</button>
                  </div>
                </form>
              ) : !isAccountOnly ? (
                <GroupCheckInWorkflow
                  groups={activeGroups}
                  clients={clients}
                  createdBy={user.employeeemail}
                  onSuccess={setSuccessMsg}
                  onError={setError}
                  onSaved={loadDashboardData}
                />
              ) : (
                <>
                <form onSubmit={handleStandalonePaymentSubmit} className="space-y-5 max-w-xl">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Client</label>
                    <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required>
                      <option value="">Select a client…</option>
                      {clients.map(c => <option key={c.clientid} value={c.clientid}>{c.lastname}, {c.firstname}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Payment Method</label>
                    <div className="grid grid-cols-2 gap-3">
                      {(['Cash', 'Credit Card'] as const).map(method => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setPaymentMethod(method)}
                          className={`border rounded-lg py-2.5 text-sm font-semibold transition ${paymentMethod === method ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'}`}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>

                  {paymentMethod === 'Credit Card' && (
                    <CardPaymentFields value={cardBilling} onChange={setCardBilling} />
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Payment Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                      <input type="number" step="0.01" min="0" value={paymentInput} onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }} onChange={(e) => setPaymentInput(e.target.value.replace(/-/g, ''))} placeholder="0.00" className="w-full bg-slate-950 border border-slate-700 rounded-lg py-2.5 pl-7 pr-3 text-white text-sm" required />
                    </div>
                    {selectedClientRecord ? (
                      <div className="mt-3 bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Current balance</span>
                          <span className={toDisplayBalance(currentBalance) < 0 ? 'text-red-400' : 'text-emerald-400'}>{formatMoney(toDisplayBalance(currentBalance))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">This payment</span>
                          <span className="text-emerald-400">+{formatMoney(paymentAmount)}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-800 pt-1.5">
                          <span className="font-semibold text-slate-300">Balance after payment</span>
                          <span className={`font-bold ${toDisplayBalance(balanceAfterPayment) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatMoney(toDisplayBalance(balanceAfterPayment))}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 mt-1.5">Select a client to see their account balance.</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Notes <span className="normal-case font-normal text-slate-500">(optional)</span></label>
                    <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" placeholder="e.g. Cash payment, receipt #…" />
                  </div>

                  <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
                    <button type="button" onClick={() => window.print()} disabled={!lastPayment} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-semibold px-6 py-2.5 rounded-lg text-sm mt-4">Print Receipt</button>
                    <button type="submit" disabled={loading} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm mt-4">Process Payment</button>
                  </div>
                </form>

                {lastPayment && (
                  <>
                    <style>{`
                      @media print {
                        body * { visibility: hidden !important; }
                        #payment-receipt, #payment-receipt * { visibility: visible !important; }
                        #payment-receipt { display: block !important; position: absolute; left: 0; top: 0; width: 100%; }
                      }
                    `}</style>
                    <div id="payment-receipt" className="hidden bg-white text-black p-6 text-sm">
                      <h2 className="text-lg font-bold">Payment Receipt</h2>
                      <p className="text-xs text-gray-600 mb-3">{lastPayment.date}</p>
                      <hr className="mb-3 border-gray-300" />
                      <table className="w-full text-sm">
                        <tbody>
                          <tr><td className="py-1 text-gray-600">Client</td><td className="py-1 text-right font-medium">{lastPayment.clientName}</td></tr>
                          {lastPayment.docNumber && <tr><td className="py-1 text-gray-600">DOC #</td><td className="py-1 text-right">{lastPayment.docNumber}</td></tr>}
                          <tr><td className="py-1 text-gray-600">Payment method</td><td className="py-1 text-right">{lastPayment.method}</td></tr>
                          <tr><td className="py-1 text-gray-600">Amount paid</td><td className="py-1 text-right font-bold">${lastPayment.amount.toFixed(2)}</td></tr>
                          <tr><td className="py-1 text-gray-600">Balance after payment</td><td className="py-1 text-right">{formatMoney(toDisplayBalance(lastPayment.newBalance))}</td></tr>
                        </tbody>
                      </table>
                      {lastPayment.notes && <p className="mt-3 text-xs"><span className="text-gray-600">Notes:</span> {lastPayment.notes}</p>}
                      <hr className="my-3 border-gray-300" />
                      <p className="text-xs text-gray-600">Processed by {lastPayment.processedBy}</p>
                      <p className="text-xs text-gray-600 mt-3 text-center">Thank you.</p>
                    </div>
                  </>
                )}
                </>
              )}
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl flex flex-col justify-between">
              <div>
                <h3 className="font-semibold text-white mb-2 flex items-center gap-2"><Activity size={18} className="text-blue-400" /> Workflow Summary</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">Executes Attendance record, Financial Transaction, and Balance calculation.</p>
              </div>
              <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg"><p className="text-xs text-slate-400">User Session:</p><p className="text-sm font-semibold text-blue-400">{user.employeeemail}</p></div>
            </div>
          </div>
        )}

        {/* CALL-IN MODULE TAB */}
        {activeTab === 'callin' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl max-w-2xl mx-auto overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
              <div>
                <h2 className="text-lg font-bold text-white">Call-In Log</h2>
                <p className="text-xs text-slate-400 mt-1">Record a call-in for one client or for every active client in a group. Entries are saved to the client's notes and event log.</p>
              </div>
              <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0">
                <button type="button" onClick={() => setCallInMode('client')} className={`px-3 py-1.5 rounded text-xs font-semibold transition ${callInMode === 'client' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Client</button>
                <button type="button" onClick={() => setCallInMode('group')} className={`px-3 py-1.5 rounded text-xs font-semibold transition ${callInMode === 'group' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Group</button>
              </div>
            </div>

            <form onSubmit={handleCallInSubmit} className="p-6 space-y-5">
              {callInMode === 'client' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Client</label>
                  <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required>
                    <option value="">Select a client…</option>
                    {clients.map(c => <option key={c.clientid} value={c.clientid}>{c.lastname}, {c.firstname}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Group</label>
                  <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required>
                    <option value="">Select a group…</option>
                    {activeGroups.map(g => <option key={g.groupid} value={g.groupid}>{g.groupname}</option>)}
                  </select>
                  {selectedGroup && (
                    <p className="text-xs text-slate-500 mt-1.5">
                      Will be logged for {clients.filter(c => c.groupid === Number(selectedGroup) && c.programstatus === 'Active').length} active client(s) in this group.
                    </p>
                  )}
                  <div className="mt-4">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Call-In Is For <span className="normal-case font-normal text-slate-500">(optional)</span></label>
                    <input type="date" value={groupCallInDate} onChange={(e) => setGroupCallInDate(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
                    <p className="text-xs text-slate-500 mt-1.5">Leave blank for today. Set a date if the group meets on another day. It is still logged today and the date is noted on the entry.</p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Reason <span className="normal-case font-normal text-slate-500">(optional)</span></label>
                <select value={callInReason} onChange={(e) => setCallInReason(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
                  <option value="">No reason selected</option>
                  {CALL_IN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Details</label>
                <textarea value={callInComment} onChange={(e) => setCallInComment(e.target.value)} rows={4} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" placeholder="What did the client report?" required />
              </div>

              <div className="flex justify-end pt-4 border-t border-slate-800">
                <button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">Submit Call-In</button>
              </div>
            </form>
          </div>
        )}

        {/* GROUPS MODULE TAB */}
        {activeTab === 'groups' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl p-5">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-white">Group Directory</h2>
                  <button type="button" onClick={() => setShowNewGroupForm(s => !s)} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-semibold">+ New Group</button>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input type="checkbox" checked={showInactiveGroups} onChange={(e) => setShowInactiveGroups(e.target.checked)} className="accent-blue-600" />
                  Show inactive groups ({inactiveGroupCount})
                </label>
              </div>

              <div className="flex flex-wrap items-end gap-3 mb-4 text-xs">
                {([
                  ['location', 'Location', 'All locations'],
                  ['counselor', 'Counselor', 'All counselors'],
                  ['programtype', 'Program Type', 'All program types'],
                  ['status', 'Status', 'All statuses'],
                ] as const).map(([key, label, allLabel]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label className="text-slate-400">{label}</label>
                    <select value={groupFilters[key]} onChange={(e) => setGroupFilters({ ...groupFilters, [key]: e.target.value })} className="bg-slate-900 border border-slate-700 rounded p-1.5 text-white text-sm min-w-[12rem]">
                      <option value="">{allLabel}</option>
                      {distinctGroupValues(key).map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                ))}
                {groupFilterActive && (
                  <button type="button" onClick={() => setGroupFilters({ location: '', counselor: '', programtype: '', status: '' })} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-semibold">Clear filters</button>
                )}
              </div>

              {showNewGroupForm && (
                <form onSubmit={handleCreateGroup} className="bg-slate-950 border border-slate-800 rounded-lg p-4 mb-5 grid grid-cols-2 gap-4 text-sm">
                  <datalist id="group-locations">
                    {Array.from(new Set(groups.map(g => normalizeLocation(g.location)).filter(Boolean))).map(v => <option key={v} value={v} />)}
                  </datalist>
                  <datalist id="group-program-types">
                    {Array.from(new Set(groups.map(g => g.programtype).filter(Boolean))).map(v => <option key={v} value={v} />)}
                  </datalist>
                  <div><label className="block text-xs text-slate-400 mb-1">Group Name *</label><input type="text" required value={newGroup.groupName} onChange={(e) => setNewGroup({ ...newGroup, groupName: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" /></div>
                  <div><label className="block text-xs text-slate-400 mb-1">Location *</label><input type="text" required list="group-locations" value={newGroup.location} onChange={(e) => setNewGroup({ ...newGroup, location: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" /></div>
                  <div><label className="block text-xs text-slate-400 mb-1">Counselor *</label><select required value={newGroup.counselor} onChange={(e) => setNewGroup({ ...newGroup, counselor: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"><option value="">Select a counselor...</option>{counselorChoices(newGroup.counselor).map(name => <option key={name} value={name}>{name}</option>)}</select></div>
                  <div><label className="block text-xs text-slate-400 mb-1">Program Type *</label><input type="text" required list="group-program-types" value={newGroup.programType} onChange={(e) => setNewGroup({ ...newGroup, programType: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" /></div>
                  <div><label className="block text-xs text-slate-400 mb-1">Schedule *</label><ScheduleSelect value={newGroup.schedule} onChange={(v) => setNewGroup({ ...newGroup, schedule: v })} className="bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" /></div>
                  <div><label className="block text-xs text-slate-400 mb-1">Address</label><input type="text" value={newGroup.address} onChange={(e) => setNewGroup({ ...newGroup, address: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" /></div>
                  <div className="col-span-2 flex justify-end gap-2">
                    <button type="button" onClick={() => { setShowNewGroupForm(false); setNewGroup(emptyNewGroup); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Cancel</button>
                    <button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold">Create Group</button>
                  </div>
                </form>
              )}

              <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    <th className="p-3"><button onClick={() => toggleGroupSort('groupname')} className="uppercase tracking-wider hover:text-slate-200">Group Name{groupSortArrow('groupname')}</button></th>
                    <th className="p-3"><button onClick={() => toggleGroupSort('location')} className="uppercase tracking-wider hover:text-slate-200">Location{groupSortArrow('location')}</button></th>
                    <th className="p-3"><button onClick={() => toggleGroupSort('counselor')} className="uppercase tracking-wider hover:text-slate-200">Counselor{groupSortArrow('counselor')}</button></th>
                    <th className="p-3"><button onClick={() => toggleGroupSort('programtype')} className="uppercase tracking-wider hover:text-slate-200">Program Type{groupSortArrow('programtype')}</button></th>
                    <th className="p-3"><button onClick={() => toggleGroupSort('schedule')} className="uppercase tracking-wider hover:text-slate-200">Schedule{groupSortArrow('schedule')}</button></th>
                    <th className="p-3"><button onClick={() => toggleGroupSort('clientcount')} className="uppercase tracking-wider hover:text-slate-200">Assigned Clients{groupSortArrow('clientcount')}</button></th>
                    <th className="p-3"><button onClick={() => toggleGroupSort('active')} className="uppercase tracking-wider hover:text-slate-200">Status{groupSortArrow('active')}</button></th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-sm">
                  {sortedDirectoryGroups.map(g => (
                    <tr key={g.groupid} className="hover:bg-slate-800/50 transition">
                      <td className="p-3 font-medium text-white">{g.groupname}</td>
                      <td className="p-3 text-slate-400">{normalizeLocation(g.location)}</td>
                      <td className="p-3 text-slate-300">{g.counselor}</td>
                      <td className="p-3"><span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded text-xs">{g.programtype}</span></td>
                      <td className="p-3 text-slate-400">{g.schedule}</td>
                      <td className="p-3 font-bold text-slate-200">{g.clientcount || 0} Clients</td>
                      <td className="p-3">
                        {g.active === false
                          ? <span className="bg-slate-700/50 text-slate-400 px-2 py-0.5 rounded text-xs">Inactive</span>
                          : <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-xs">Active</span>}
                      </td>
                      <td className="p-3 text-right">
                        <button onClick={() => handleOpenGroup(g)} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg">Manage Group</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedGroupDetail && (
              <div ref={groupDetailRef} className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                  <h3 className="text-lg font-bold text-white">Managing: {selectedGroupDetail.groupname}</h3>
                  <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                    <button onClick={() => setGroupTab('roster')} className={`px-3 py-1 rounded text-xs font-semibold ${groupTab === 'roster' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Roster</button>
                    <button onClick={() => setGroupTab('assign')} className={`px-3 py-1 rounded text-xs font-semibold ${groupTab === 'assign' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Assign Clients</button>
                    <button onClick={() => setGroupTab('schedule')} className={`px-3 py-1 rounded text-xs font-semibold ${groupTab === 'schedule' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Group Details</button>
                  </div>
                  {canDeleteGroups && (
                    <button onClick={handleDeleteGroup} disabled={loading} className="ml-4 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-semibold">Delete Group</button>
                  )}
                </div>

                {groupTab === 'roster' && (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-400 uppercase font-semibold">Assigned Clients ({groupRoster.length})</p>
                    {groupRoster.map(c => (
                      <div key={c.clientid} className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex justify-between items-center text-sm">
                        <span className="font-medium text-white">{c.lastname}, {c.firstname} ({c.docnumber})</span>
                        <span className="text-xs text-slate-400">Balance: {formatBalance(c.accountbalance)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {groupTab === 'assign' && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-slate-400 uppercase font-semibold">Assign Client to this Group</p>
                      <input
                        type="search"
                        value={assignClientSearch}
                        onChange={(e) => setAssignClientSearch(e.target.value)}
                        placeholder="Search client name or DOC #..."
                        className="bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-white text-xs w-64 max-w-full"
                      />
                    </div>
                    {(() => {
                      const assignedClientIds = new Set(groupRoster.map(c => c.clientid));
                      const unassignedClients = clients.filter(c => !assignedClientIds.has(c.clientid));
                      const searchTerm = assignClientSearch.trim().toLowerCase();
                      const filteredClients = searchTerm
                        ? unassignedClients.filter(c => [
                            c.firstname, c.lastname, `${c.firstname} ${c.lastname}`, `${c.lastname}, ${c.firstname}`, c.docnumber
                          ].some(v => String(v ?? '').toLowerCase().includes(searchTerm)))
                        : unassignedClients;

                      return (
                        <div className="grid grid-cols-2 gap-4">
                          {filteredClients.length > 0 ? (
                            filteredClients.map(c => (
                              <div key={c.clientid} className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex justify-between items-center text-xs">
                                <span>{c.lastname}, {c.firstname} ({c.docnumber})</span>
                                <button onClick={() => handleAssignClient(c.clientid)} className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded">Assign</button>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-slate-500 italic col-span-2">
                              {searchTerm ? 'No clients match your search.' : 'All available clients are already assigned to this group.'}
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {groupTab === 'schedule' && (
                  <form onSubmit={handleUpdateGroup} className="space-y-4 max-w-2xl">
                    <datalist id="edit-group-locations">
                      {Array.from(new Set(groups.map(g => normalizeLocation(g.location)).filter(Boolean))).map(v => <option key={v} value={v} />)}
                    </datalist>
                    <datalist id="edit-group-program-types">
                      {Array.from(new Set(groups.map(g => g.programtype).filter(Boolean))).map(v => <option key={v} value={v} />)}
                    </datalist>
                    {!canEditGroupDetails && (
                      <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2">Group details are view-only for your role.</p>
                    )}
                    <fieldset disabled={!canEditGroupDetails} className="space-y-4 disabled:opacity-70">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div><label className="block text-xs text-slate-400 mb-1">Group Name *</label><input type="text" required value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" /></div>
                      <div><label className="block text-xs text-slate-400 mb-1">Location *</label><input type="text" required list="edit-group-locations" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" /></div>
                      <div><label className="block text-xs text-slate-400 mb-1">Counselor *</label><select required value={editCounselor} onChange={(e) => setEditCounselor(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm"><option value="">Select a counselor...</option>{counselorChoices(editCounselor).map(name => <option key={name} value={name}>{name}</option>)}</select></div>
                      <div><label className="block text-xs text-slate-400 mb-1">Program Type *</label><input type="text" required list="edit-group-program-types" value={editProgramType} onChange={(e) => setEditProgramType(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" /></div>
                      <div><label className="block text-xs text-slate-400 mb-1">Schedule *</label><ScheduleSelect value={editSchedule} onChange={setEditSchedule} className="bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" /></div>
                      <div><label className="block text-xs text-slate-400 mb-1">Address</label><input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" /></div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} className="accent-blue-600" />
                      Active (uncheck to deactivate; hides the group from new assignments and sessions)
                    </label>
                    {canEditGroupDetails && (
                      <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-xs font-semibold">Save Group Settings</button>
                    )}
                    </fieldset>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* TESTING MODULE TAB */}
        {activeTab === 'testing' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
              <h2 className="text-lg font-bold text-white border-b border-slate-800 pb-3">Test Entry</h2>
              <form onSubmit={handleTestSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Select Client</label>
                  <select value={testClient} onChange={(e) => handleSelectTestClient(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required>
                    <option value="">-- Choose Client --</option>
                    {clients.map(c => <option key={c.clientid} value={c.clientid}>{c.lastname}, {c.firstname}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Test Type</label>
                  <select value={testType} onChange={(e) => setTestType(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm">
                    <option value="SOTP Pre/Post">SOTP Pre/Post</option>
                    <option value="MRT Step Evaluation">MRT Step Evaluation</option>
                    <option value="BIP Homework Assessment">BIP Homework Assessment</option>
                    <option value="Cognitive Distortions Scale">Cognitive Distortions Scale</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Score / Evaluation</label>
                  <input type="text" value={testScore} onChange={(e) => setTestScore(e.target.value)} placeholder="e.g. 85%, Passed, Step 4 Complete" className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Clinical Notes</label>
                  <textarea value={testNotes} onChange={(e) => setTestNotes(e.target.value)} rows={3} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" placeholder="Enter notes..." />
                </div>
                <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">Save Test Result</button>
              </form>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
              <h2 className="text-lg font-bold text-white border-b border-slate-800 pb-3">Test History</h2>
              {clientTestHistory.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Select a client to view test history.</p>
              ) : (
                clientTestHistory.map(t => (
                  <div key={t.testid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm space-y-1">
                    <div className="flex justify-between font-semibold text-white">
                      <span>{t.testtype}</span>
                      <span className="text-blue-400 font-bold">{t.score}</span>
                    </div>
                    <p className="text-xs text-slate-400">{new Date(t.date).toLocaleDateString()} — {t.notes || 'No notes'}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* POLYGRAPH TAB */}
        {activeTab === 'polygraph' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-white">Polygraph Management Module</h2>
              <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button onClick={() => setPolySubTab('admin')} className={`px-3 py-1.5 rounded text-xs font-semibold ${polySubTab === 'admin' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Poly Admin</button>
                <button onClick={() => setPolySubTab('schedule')} className={`px-3 py-1.5 rounded text-xs font-semibold ${polySubTab === 'schedule' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Poly Schedule</button>
                <button onClick={() => setPolySubTab('results')} className={`px-3 py-1.5 rounded text-xs font-semibold ${polySubTab === 'results' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Poly Results</button>
              </div>
            </div>

            {polySubTab === 'admin' && (
              <>
                {(role !== 'Business Administrator' && role !== 'Polygrapher') && (
                  <p className="text-xs text-slate-400 italic bg-slate-950 border border-slate-700 rounded-lg p-3">
                    Only Business Administrators and Polygraphers can create appointment slots.
                  </p>
                )}
                {(role === 'Business Administrator' || role === 'Polygrapher') && (
                  <form onSubmit={handleCreateSlot} className="space-y-4 max-w-2xl">
                <h3 className="text-sm font-semibold text-blue-400">Create Single Appointment Slot</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Office Location</label>
                    <input type="text" value={polyLocation} onChange={(e) => setPolyLocation(e.target.value)} placeholder="Location" className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Address</label>
                    <input type="text" value={polyAddress} onChange={(e) => setPolyAddress(e.target.value)} placeholder="Address" className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Date</label>
                    <input 
                      type="date" 
                      min={getLocalDateString()} 
                      value={polyDate} 
                      onChange={(e) => {
                        const newDate = e.target.value;
                        setPolyDate(newDate);
                        const today = getLocalDateString();
                        const curTime = getLocalTimeString();
                        if (newDate === today && polyTime && polyTime < curTime) {
                          setPolyTime(curTime);
                        }
                      }} 
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm [color-scheme:dark]" 
                      required 
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">Min date: Today ({getLocalDateString()})</span>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Time</label>
                    <input 
                      type="time" 
                      min={polyDate === getLocalDateString() ? getLocalTimeString() : undefined} 
                      value={polyTime} 
                      onChange={(e) => setPolyTime(e.target.value)} 
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm [color-scheme:dark]" 
                      required 
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">
                      {polyDate === getLocalDateString() 
                        ? `Min time: ${formatDisplayTime(getLocalTimeString())} (active time)` 
                        : 'Future date: any time'}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Examiner</label>
                    <select
                      value={polyExaminer}
                      onChange={(e) => setPolyExaminer(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
                      required
                    >
                      <option value="">-- Choose Examiner --</option>
                      {polyExaminers.length > 0 && (
                        <optgroup label="Polygraph Examiners">
                          {polyExaminers.map(e => (
                            <option key={e.employeeemail} value={e.employeeemail}>
                              {e.displayname} ({e.employeeemail})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {otherStaff.length > 0 && (
                        <optgroup label="Other Staff">
                          {otherStaff.map(e => (
                            <option key={e.employeeemail} value={e.employeeemail}>
                              {e.displayname} - {e.role} ({e.employeeemail})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {employees.length === 0 && (
                        <option value="jvance@chandlercbt.com">Examiner J. Vance (jvance@chandlercbt.com)</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Slot Type</label>
                    <select value={polyType} onChange={(e) => setPolyType(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
                      <option value="Maintenance">Maintenance</option>
                      <option value="Instant">Instant Poly</option>
                      <option value="Sexual History">Sexual History</option>
                      <option value="Specific">Specific Issue</option>
                      <option value="Monitoring">Monitoring</option>
                    </select>
                  </div>
                </div>
                <button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">
                  {loading ? 'Creating...' : 'Create Appointment Slot'}
                </button>
                  </form>
                )}
              </>
            )}

            {pendingAssignSlotId !== null && (() => {
              const pendingSlot = polySlots.find(s => s.slotid === pendingAssignSlotId);
              const pendingClient = clients.find(c => String(c.clientid) === slotAssignments[pendingAssignSlotId]);
              const pendingComment = (slotComments[pendingAssignSlotId] || '').trim();
              const details: [string, string][] = [
                ['Client', pendingClient ? `${pendingClient.lastname}, ${pendingClient.firstname}` : 'Not selected'],
                ['Poly Type', slotTypes[pendingAssignSlotId] || 'Maintenance'],
                ['Location', pendingSlot?.location || '—'],
                ['Address', pendingSlot?.address || 'Not set'],
                ['Date', pendingSlot ? `${new Date(pendingSlot.date).toLocaleDateString()} @ ${formatDisplayTime(pendingSlot.time)}` : '—'],
                ['Examiner', pendingSlot ? getExaminerDisplayName(pendingSlot.polygrapher) : '—'],
              ];
              return (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md space-y-4 text-sm">
                    <div>
                      <h3 className="font-semibold text-white">Confirm Polygraph Assignment</h3>
                      <p className="text-xs text-slate-400 mt-1">Review the details below. This will be added to the client's case notes.</p>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                      {details.map(([label, value]) => (
                        <React.Fragment key={label}>
                          <dt className="text-slate-400 uppercase">{label}</dt>
                          <dd className={label === 'Client' ? 'text-emerald-400 font-semibold' : 'text-slate-200'}>{value}</dd>
                        </React.Fragment>
                      ))}
                      {pendingComment && (
                        <>
                          <dt className="text-slate-400 uppercase">Comment</dt>
                          <dd className="text-slate-200 whitespace-pre-wrap">{pendingComment}</dd>
                        </>
                      )}
                    </dl>
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setPendingAssignSlotId(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Go Back</button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={async () => {
                          const slotId = pendingAssignSlotId;
                          setPendingAssignSlotId(null);
                          await handleAssignSlotToClient(slotId);
                        }}
                        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold">
                        Accept & Assign
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {reopenTarget && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                <form onSubmit={confirmReopenSlot} className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md space-y-4 text-sm">
                  <div>
                    <h3 className="font-semibold text-white">Cancel Polygraph Reservation</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      {reopenTarget.assignedClientName ?`${reopenTarget.assignedClientName} will be notified in their case notes.` : 'The slot will be reopened for new bookings.'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Cancellation Reason *</label>
                    <select required value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm">
                      <option value="">Select a reason...</option>
                      {POLY_CANCEL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Notes <span className="normal-case text-slate-500">(optional)</span></label>
                    <textarea value={reopenNotes} onChange={(e) => setReopenNotes(e.target.value)} rows={3} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" placeholder="Add details for the case note..." />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setReopenTarget(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Keep Reservation</button>
                    <button type="submit" disabled={loading || !reopenReason} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold">Cancel Reservation & Reopen</button>
                  </div>
                </form>
              </div>
            )}

            {polySubTab === 'schedule' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-blue-400">Available Polygraph Slots & Client Assignment</h3>
                {polySlots.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No available slots scheduled.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {polySlots.map(slot => (
                      <div key={slot.slotid} className={`bg-slate-950 border ${slot.status === 'Assigned' ? 'border-emerald-500/40 bg-emerald-950/10' : 'border-slate-800'} p-4 rounded-xl text-sm space-y-3`}>
                        <div className="flex justify-between font-semibold text-white">
                          <span>{slot.location}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${slot.status === 'Assigned' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-blue-500/10 text-blue-400'}`}>
                            {slot.status === 'Assigned' ? 'Assigned' : '1 Open Slot'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">Date: {new Date(slot.date).toLocaleDateString()} @ {formatDisplayTime(slot.time)}</p>
                        <p className="text-xs text-slate-400">Address: {slot.address || 'Not set'}</p>
                        <p className="text-xs text-slate-400">Examiner: {getExaminerDisplayName(slot.polygrapher)}</p>

                        {slot.status === 'Assigned' ? (
                          <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-300 font-medium">Assigned Client: <strong className="text-emerald-400">{slot.assignedClientName}</strong></span>
                              <span className="bg-slate-800 text-slate-300 px-2 py-1 rounded text-xs">{slot.type}</span>
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => handleReopenSlot(slot.slotid)}
                                className="flex-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition">
                                <RotateCcw size={13} /> Cancel Reservation & Reopen
                              </button>
                            </div>
                          </div>
                        ) : role === 'Business Administrator' ? (
                          <div className="pt-2 border-t border-slate-800 space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs text-slate-400 uppercase mb-1">Assign Client</label>
                                <select 
                                  value={slotAssignments[slot.slotid] || ''} 
                                  onChange={(e) => setSlotAssignments({ ...slotAssignments, [slot.slotid]: e.target.value })}
                                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-xs">
                                  <option value="">-- Choose Client --</option>
                                  {clients.map(c => (
                                    <option key={c.clientid} value={c.clientid}>{c.lastname}, {c.firstname}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs text-slate-400 uppercase mb-1">Poly Type</label>
                                <select 
                                  value={slotTypes[slot.slotid] || 'Maintenance'} 
                                  onChange={(e) => setSlotTypes({ ...slotTypes, [slot.slotid]: e.target.value })}
                                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-xs">
                                  <option value="Instant">Instant Poly</option>
                                  <option value="Maintenance">Maintenance</option>
                                  <option value="Sexual History">Sexual History</option>
                                  <option value="Specific">Specific Issue</option>
                                  <option value="Monitoring">Monitoring</option>
                                </select>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-slate-400 uppercase mb-1">Comment <span className="normal-case text-slate-500">(optional)</span></label>
                              <textarea
                                value={slotComments[slot.slotid] || ''}
                                onChange={(e) => setSlotComments({ ...slotComments, [slot.slotid]: e.target.value })}
                                rows={2}
                                placeholder="Added to the client's case note when assigned..."
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-xs" />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => openAssignConfirm(slot.slotid)}
                                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded text-xs font-semibold">
                                Confirm & Assign Slot
                              </button>
                              <button 
                                onClick={() => handleDeleteSlot(slot.slotid)}
                                title="Delete open slot"
                                className="bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 px-3 py-2 rounded text-xs font-semibold flex items-center justify-center gap-1 transition">
                                <Trash2 size={13} /> Delete
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="pt-3 text-xs text-slate-400 italic">Only Business Administrators can assign polygraph slots to clients.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {polySubTab === 'results' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-semibold text-blue-400">Assigned Polygraph Appointments Pending Results</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Select an assigned client appointment to complete and record test results.</p>
                </div>

                {assignedSlots.length === 0 ? (
                  <div className="bg-slate-950 border border-slate-800 p-8 rounded-xl text-center">
                    <CheckCircle2 size={32} className="mx-auto text-slate-600 mb-2" />
                    <p className="text-slate-400 text-sm">No assigned polygraph appointments pending results.</p>
                    <p className="text-xs text-slate-500 mt-1">Assign clients to open slots under the Poly Schedule tab first.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {assignedSlots.map(slot => (
                      <div 
                        key={slot.slotid} 
                        onClick={() => setSelectedSlotForResults(slot)}
                        className={`cursor-pointer transition border p-4 rounded-xl text-sm space-y-2 ${
                          selectedSlotForResults?.slotid === slot.slotid 
                            ? 'bg-blue-950/30 border-blue-500 text-white shadow-lg shadow-blue-500/10' 
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}>
                        <div className="flex justify-between items-center font-bold">
                          <span className="text-white text-base">{slot.assignedClientName}</span>
                          <span className="text-xs bg-blue-500/20 text-blue-400 px-2.5 py-0.5 rounded-full border border-blue-500/30 font-semibold">{slot.type || 'Polygraph'}</span>
                        </div>
                        <div className="text-xs text-slate-400 space-y-0.5">
                          <p>Location: <span className="text-slate-300">{slot.location}</span></p>
                          <p>Scheduled: <span className="text-slate-300">{new Date(slot.date).toLocaleDateString()} @ {formatDisplayTime(slot.time)}</span></p>
                          <p>Examiner: <span className="text-slate-300">{getExaminerDisplayName(slot.polygrapher)}</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedSlotForResults && (
                  <form onSubmit={handlePolyResultSubmit} className="bg-slate-950 border border-blue-500/40 p-6 rounded-xl space-y-4 max-w-2xl mt-6">
                    <div className="border-b border-slate-800 pb-3 flex justify-between items-center">
                      <h4 className="font-bold text-white">Record Results for {selectedSlotForResults.assignedClientName}</h4>
                      <span className="text-xs text-slate-400">{selectedSlotForResults.type} Exam</span>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 uppercase mb-1">Polygraph Examination Result</label>
                      <select value={resResultType} onChange={(e) => setResResultType(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
                        <option value="No Deception Indicated">No Deception Indicated (NDI)</option>
                        <option value="Deception Indicated">Deception Indicated (DI)</option>
                        <option value="Inconclusive">Inconclusive (INC)</option>
                        <option value="No Opinion">No Opinion (NO)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 uppercase mb-1">Examiner Clinical Notes & Observations</label>
                      <textarea value={resNotes} onChange={(e) => setResNotes(e.target.value)} placeholder="Type examiner notes and exam observations..." rows={4} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">
                        Save Polygraph Result & Close Slot
                      </button>
                      <button 
                        type="button" 
                        onClick={() => handleReopenSlot(selectedSlotForResults.slotid)} 
                        className="bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition">
                        <RotateCcw size={15} /> Cancel Reservation & Reopen
                      </button>
                      <button type="button" onClick={() => setSelectedSlotForResults(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-2.5 rounded-lg text-sm">
                        Close
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* REPORTS TAB */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            <div className="flex gap-4 border-b border-slate-800 pb-4">
              <button onClick={() => handleLoadReports('agent')} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-xs font-semibold">Weekly Agent Report</button>
              <button onClick={() => handleLoadReports('deposit')} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-xs font-semibold">Monthly Deposit Report</button>
            </div>

            {agentReportData.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
                <h3 className="font-semibold text-white mb-4">Weekly Supervising Agent Summary</h3>
                <table className="w-full text-left border-collapse text-xs">
                  <thead><tr className="bg-slate-800/50 text-slate-400 uppercase"><th className="p-3">Client</th><th className="p-3">Agent</th><th className="p-3">Attended Sessions</th><th className="p-3">Last Poly</th><th className="p-3">Balance</th></tr></thead>
                  <tbody className="divide-y divide-slate-800 text-sm">
                    {agentReportData.map(r => (
                      <tr key={r.clientid}><td className="p-3 font-medium text-white">{r.lastname}, {r.firstname}</td><td className="p-3 text-slate-300">{r.supervisingagent}</td><td className="p-3">{r.totalattended}</td><td className="p-3 text-slate-400">{r.lastpolydate ? new Date(r.lastpolydate).toLocaleDateString() : 'None'}</td><td className="p-3 font-semibold text-slate-200">{formatBalance(r.accountbalance)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {depositReportData && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
                <h3 className="font-semibold text-white">Monthly Deposit Summary</h3>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800"><p className="text-xs text-slate-400">Total Revenue Collected</p><p className="text-2xl font-bold text-emerald-400">${depositReportData.totalRevenue.toFixed(2)}</p></div>
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800"><p className="text-xs text-slate-400">Total Charges Assessed</p><p className="text-2xl font-bold text-amber-400">${depositReportData.totalCharges.toFixed(2)}</p></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ADMIN TAB */}
        {activeTab === 'admin' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
              <h2 className="text-lg font-bold text-white border-b border-slate-800 pb-3">User Management</h2>
              {/* Only Business Administrators can create or edit accounts */}
              {role !== 'Business Administrator' && (
                <p className="text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded p-3">
                  Only Business Administrators can create or edit accounts.
                </p>
              )}
              {role === 'Business Administrator' && (
              <form onSubmit={handleSaveEmployee} className="space-y-3">
                {editingEmail && <p className="text-xs text-blue-400">Editing {editingEmail}. Email can't be changed.</p>}
                <input type="email" value={empEmail} onChange={(e) => setEmpEmail(e.target.value)} disabled={editingEmail !== null} placeholder="Employee Email" className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm disabled:opacity-50" required />
                <input type="text" value={empName} onChange={(e) => setEmpName(e.target.value)} placeholder="Full Display Name" className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required />
                <input type="password" value={empPassword} onChange={(e) => setEmpPassword(e.target.value)} autoComplete="new-password" placeholder={editingEmail ? 'New password (leave blank to keep current)' : 'Password'} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required={editingEmail === null} />
                <select value={empRole} onChange={(e) => setEmpRole(e.target.value)} disabled={editingEmail === user.employeeemail} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm disabled:opacity-50">
                  <option value="Office Admin">Office Admin</option>
                  <option value="Business Administrator">Business Administrator</option>
                  <option value="Counselor">Counselor</option>
                  <option value="Billing">Billing</option>
                  <option value="Polygrapher">Polygrapher</option>
                  <option value="Supervisor">Supervisor / PO</option>
                </select>
                {editingEmail && (
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={empActive} onChange={(e) => setEmpActive(e.target.checked)} disabled={editingEmail === user.employeeemail} className="rounded accent-blue-500 disabled:opacity-50" />
                    Active (inactive accounts cannot log in)
                  </label>
                )}
                {editingEmail === user.employeeemail && (
                  <p className="text-xs text-slate-500">You can change your own name here, but not your own role or active status.</p>
                )}
                <div className="flex gap-2">
                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded text-xs">{editingEmail ? 'Save Changes' : 'Save User Role'}</button>
                  {editingEmail && (
                    <button type="button" onClick={resetEmployeeForm} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold px-4 py-2 rounded text-xs">Cancel</button>
                  )}
                </div>
              </form>
              )}

              <div className="space-y-2 pt-4">
                <div className="flex justify-between items-center gap-3">
                  <p className="text-xs text-slate-400 font-semibold uppercase">System Accounts</p>
                  <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                    {(['active', 'inactive', 'all'] as const).map(f => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setAccountFilter(f)}
                        className={`px-3 py-1 rounded text-xs font-semibold transition ${accountFilter === f ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        {f === 'active' ? 'Active' : f === 'inactive' ? 'Inactive' : 'All'}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="search"
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-xs placeholder-slate-500"
                />
                {employees.filter(e => (accountFilter === 'all' || (accountFilter === 'active' ? e.active !== false : e.active === false)) && (empSearch.trim() === '' || `${e.displayname} ${e.employeeemail} ${e.role}`.toLowerCase().includes(empSearch.toLowerCase()))).map(e => (
                  <div key={e.employeeemail} className={`bg-slate-950 border p-3 rounded flex justify-between items-center gap-3 text-xs ${editingEmail === e.employeeemail ? 'border-blue-500' : 'border-slate-800'}`}>
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{e.displayname}</p>
                      <p className="text-slate-400 truncate">{e.employeeemail}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {e.active === false && <span className="bg-slate-700/50 text-slate-400 px-2 py-0.5 rounded font-semibold">Inactive</span>}
                      <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded font-semibold">{e.role}</span>
                      {role === 'Business Administrator' && (
                        <button type="button" onClick={() => startEditEmployee(e)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1 rounded font-semibold">Edit</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
              <h2 className="text-lg font-bold text-white border-b border-slate-800 pb-3">System Audit & Activity Logs</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {systemLogs.map(l => (
                  <div key={l.logid} className="bg-slate-950 border border-slate-800 p-3 rounded text-xs space-y-1">
                    <div className="flex justify-between text-slate-400"><span>{l.useremail}</span><span>{new Date(l.timestamp).toLocaleString()}</span></div>
                    <p className="text-white font-medium">{l.action}</p>
                    <p className="text-slate-400">{l.details}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}