import React, { Fragment, useState, useEffect, useRef } from 'react';
import { 
  Users, ClipboardCheck, ShieldCheck, LogOut, AlertCircle, X, FileText, 
  DollarSign, Calendar, PlusCircle, Activity, PhoneCall, ShieldAlert, 
  Layers, CheckSquare, BarChart3, Settings, CheckCircle2, Trash2, RotateCcw, Home, History,
  Paperclip, Eye, Download, Printer, Upload, Pencil, SlidersHorizontal, UserCheck, ClipboardList
} from 'lucide-react';
import {
  loginUser, getClients, getGroups, submitAccountPayment, submitCustomCharge,
  submitClientCallIn, submitGroupCallIn, getPolygraphSlots, createPolygraphSlot,
  submitPolygraphResult, deletePolygraphSlot, assignPolygraphSlot, reopenPolygraphSlot,
  getClientAttendance, getClientFinancials, adjustCashPayment, recordCardPaymentAction,
  getClientNotes, addClientNote, updateClientNote, deleteClientNote, getClientPolygraphs, getGroupClients, updateGroup, updateClient, setClientNoPolyRequired, changeClientProgramStatus,
  assignClientToGroup, createClient, createGroup, deleteGroup, deleteClient, updateEmployee, getClientTests, submitTestResult, getAgentReport,
  getDepositReport, getEmployees, addEmployee, getSystemLogs, fetchClientFeeOverride, saveClientFeeOverride, deleteClientFeeOverride,
  fetchPolyFeeOverride, savePolyFeeOverride, deletePolyFeeOverride,
  getOpenGroups, deleteOpenGroup, getClosedGroups, getClientChangeLog, getSupervisingAgents,
  getClientAttachments, uploadClientAttachment, fetchClientAttachment, renameClientAttachment, deleteClientAttachment, ATTACHMENT_MAX_BYTES
} from './api';
import type { CardPaymentAction, ClientAttachment, ClientChange, ClosedGroupSession, OpenGroupSession, PaymentChangeResult, PolyFeeOverride, PolyFeeOverrideResult, SupervisingAgent } from './api';
import { todayLocal } from './hooks/useGroupCheckIn';
import GroupCheckInWorkflow from './components/attendance/GroupCheckInWorkflow';
import { formatBalance, toDisplayBalance } from './utils/balance';
import { SO_PHASES, SO_TREATMENT_FEES } from './utils/soPhases';
import CardPaymentFields from './components/payments/CardPaymentFields';
import ClientPaymentDialog from './components/payments/ClientPaymentDialog';
import SupervisingAgentsTab from './components/agents/SupervisingAgentsTab';
import AgentPicker from './components/agents/AgentPicker';
import ClientPicker from './components/ClientPicker';
import GroupPicker from './components/GroupPicker';
import RecordFilterBar from './components/clients/RecordFilterBar';
import MonthHeader from './components/clients/MonthHeader';
import GroupIncomeReport from './components/reports/GroupIncomeReport';
import CounselorClientReport from './components/reports/CounselorClientReport';
import GroupCashDepositReport from './components/reports/GroupCashDepositReport';
import AssessmentsIndividualsTab from './components/sessions/AssessmentsIndividualsTab';
import SessionPriceList from './components/sessions/SessionPriceList';
import BipIntakePrompt from './components/sessions/BipIntakePrompt';
import ProgressTab from './components/sessions/ProgressTab';
import BipAssessmentPicker, { bipChoiceProblem, counselorChoices as bipCounselorChoices, openBipAssessment } from './components/sessions/BipAssessmentPicker';
import type { BipAssessmentChoice } from './components/sessions/BipAssessmentPicker';

// Client program statuses. 'Active' is used by group call-ins and the group roster, so keep that exact spelling.
const PROGRAM_STATUSES = ['Active', 'Completed', 'Deceased', 'Discharged Supervision', 'Inactive', 'Program Failed', 'Revoked', 'Terminated', 'Transferred'];
// Statuses that can be picked when adding or editing a client; the rest are only set through the Discharge button
const EDITABLE_PROGRAM_STATUSES = ['Active', 'Inactive'];

// Report tabs, in order. Counselors and Therapists only get the ones marked allRoles.
const REPORT_TABS = [
  { id: 'agent', label: 'Weekly Agent Report', allRoles: false },
  { id: 'deposit', label: 'Monthly Deposit Report', allRoles: false },
  { id: 'groupIncome', label: 'Group Income Report', allRoles: false },
  { id: 'cashDeposits', label: 'Group Cash Deposits', allRoles: true },
  { id: 'counselorClients', label: 'Counselor Client Report', allRoles: false },
];
const reportTabsFor = (role?: string) => REPORT_TABS.filter(t => t.allRoles || role === 'Business Administrator' || role === 'Office Admin');
// The picked report if the role can see it, otherwise the role's first report
const currentReportFor = (picked: string | null, role?: string) => {
  const tabs = reportTabsFor(role);
  return tabs.some(t => t.id === picked) ? picked : tabs[0]?.id ?? null;
};
// Discharge types a Business Administrator can pick; each becomes the client's program status
const DISCHARGE_STATUSES = ['Completed', 'Deceased', 'Discharged Supervision', 'Program Failed', 'Revoked', 'Transferred', 'Terminated'];
// Discharge types that require a subcategory (recorded on the case note and kept for recidivism reporting)
const DISCHARGE_SUBCATEGORIES: Record<string, string[]> = {
  'Program Failed': ['Attendance', 'Polys', 'Not Amenable'],
  'Revoked': ['Non Compliance', 'New SO Charge', 'New Criminal Charge'],
  'Terminated': ['Violence', 'New Criminal Charge'],
};

// Group call-in notes are saved as "[Group Call-In Log] (For: YYYY-MM-DD) (Reason: …): …". No "For" date means the day it was submitted.
const parseGroupCallInNote = (text: string) => {
  const match = /^\[Group Call-In Log\](?: \(For: (\d{4}-\d{2}-\d{2})\))?/.exec(text || '');
  return match ? { forDate: match[1] || null } : null;
};

// Label shown above a case note. Group call-ins read "<date> · Group Call-In"; everything else keeps its category.
// Group Directory filters; '' means all. Status starts on Active so inactive groups are hidden until asked for.
const DEFAULT_GROUP_FILTERS = { location: '', counselor: '', programtype: '', status: 'Active' };
// Client drawer list filters. Dates are YYYY-MM-DD, inclusive; '' means no filter.
const EMPTY_NOTE_FILTERS = { search: '', category: '', from: '', to: '', sort: 'newest' };
const EMPTY_ATTENDANCE_FILTERS = { search: '', group: '', type: '', payment: '', from: '', to: '', sort: 'newest' };
const EMPTY_LEDGER_FILTERS ={ search: '', type: '', feeType: '', method: '', from: '', to: '', sort: 'newest' };
// A timestamp's calendar day in the browser's time zone, as YYYY-MM-DD
const localYmd = (value: unknown) => {
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Calendar time between two YYYY-MM-DD days as "Same day", "5 days", "2 weeks, 3 days", or "3 months, 1 week"
const timeBetween = (fromYmd: string, toYmd: string) => {
  const [a, b] = [fromYmd, toYmd].sort();
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const start = new Date(ay, am - 1, ad);
  const end = new Date(by, bm - 1, bd);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (totalDays === 0) return 'Same day';
  if (totalDays < 14) return plural(totalDays, 'day');
  // Whole calendar months first, then the leftover days as weeks
  let months = (by - ay) * 12 + (bm - am);
  if (new Date(ay, am - 1 + months, ad) > end) months--;
  const leftover = Math.round((end.getTime() - new Date(ay, am - 1 + months, ad).getTime()) / 86400000);
  if (months < 2) {
    const weeks = Math.floor(totalDays / 7);
    return [plural(weeks, 'week'), totalDays % 7 ? plural(totalDays % 7, 'day') : ''].filter(Boolean).join(', ');
  }
  const years = Math.floor(months / 12);
  const parts = [years ? plural(years, 'year') : '', months % 12 ? plural(months % 12, 'month') : '', leftover >= 7 ? plural(Math.floor(leftover / 7), 'week') : ''];
  return parts.filter(Boolean).join(', ');
};

const sortedUnique = (values: unknown[]) => Array.from(new Set(values.filter(Boolean).map(String))).sort((a, b) => a.localeCompare(b));

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

// Change Log filter choices: the stored change type and how it is labelled
const CHANGE_LOG_TYPES: { type: string; label: string }[] = [
  { type: 'Client Created', label: 'Client Created' },
  { type: 'Program Status', label: 'Program Status' },
  { type: 'Program Type', label: 'Program Type' },
  { type: 'Supervising Agent', label: 'Supervising Agent' },
  { type: 'Group', label: 'Group' },
  { type: 'No Poly Required', label: 'No Poly Required' },
  { type: 'Fee Override', label: 'Temporary Fee Override' },
  { type: 'Poly Fee Override', label: 'Poly Fee Override' },
  { type: 'Payment Adjusted', label: 'Payment Adjusted' },
  { type: 'Payment Refunded', label: 'Payment Refunded' },
  { type: 'Payment Disputed', label: 'Payment Disputed' },
];

// Programs that use the SO phase schedule and show the last polygraph date
const SO_PROGRAM_TYPES = ['State SO', 'Federal SO', 'Voluntary SO'];
// Programs that start at the State SO default treatment fee (Phase 1 - Weekly)
const STATE_FEE_PROGRAM_TYPES = ['State SO', 'Voluntary SO'];
// BIP clients store a whole-number week (starting at 0) in the phase column instead of an SO phase
const isWholeNumber = (value: unknown) => /^\d+$/.test(String(value ?? '').trim());
const formatPhase = (programtype?: string | null, phase?: string | null) =>
  programtype === 'BIP' && isWholeNumber(phase) ? `Week ${phase}` : phase;
// Reads the calendar date of a date-only or ISO value as a local date, ignoring any time zone shift
const toLocalDay = (value: unknown) => {
  const [y, m, d] = String(value).split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
};
// Whole years since the birth date, or null when there is no valid date
const ageFromBirthDate = (value: unknown, today = new Date()) => {
  if (!value) return null;
  const born = toLocalDay(value);
  if (isNaN(born.getTime())) return null;
  const hadBirthday = today.getMonth() > born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate());
  const age = today.getFullYear() - born.getFullYear() - (hadBirthday ? 0 : 1);
  return age >= 0 ? age : null;
};
// Client Roster filters start on active clients only
const DEFAULT_CLIENT_FILTERS = { agent: '', programtype: '', phase: '', currentgroup: '', status: 'Active', feeoverride: '' };
// Dropdown choices for client Information fields; must match the server's lists
const CLIENT_FIELD_OPTIONS: Record<string, string[]> = {
  race: ['American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino', 'Native Hawaiian or Other Pacific Islander', 'White', 'Two or More Races', 'Other'],
  sex: ['Male', 'Female'],
};
const POLY_OVERDUE_MONTHS = 6;
// SO clients are overdue to attend once this many months have passed since their last attendance, by phase
const SO_ATTENDANCE_LIMIT_MONTHS: Record<string, number> = {
  'Phase 1 - Weekly': 1,
  'Phase 2 - Monthly': 2,
  'Phase 3 - Quarterly': 4,
  'Phase 4 - Semi Anual': 7,
};
// True when an SO client's last attendance is more than their phase allows. Clients who never attended, or without an SO phase, aren't flagged.
const isAttendanceOverdue = (client: any, today = new Date()) => {
  const limit = SO_ATTENDANCE_LIMIT_MONTHS[client.phase];
  // The latest attendance row's date, or the stored last date attended when that isn't loaded
  const lastValue = client.lastattended ?? client.lastdateattended;
  if (!SO_PROGRAM_TYPES.includes(client.programtype) || !limit || !lastValue) return false;
  const last = new Date(lastValue);
  if (isNaN(last.getTime())) return false;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return startOfToday > new Date(last.getFullYear(), last.getMonth() + limit, last.getDate());
};
// When the client's most recent polygraph was taken: the actual polygraph date, falling back to the recorded date for older results without one
const lastPolygraphTaken = (polygraphs: any[]): Date | null => {
  const taken = polygraphs
    .map(p => p.polygraphdatetime ? new Date(p.polygraphdatetime) : p.date ? toLocalDay(p.date) : null)
    .filter((d): d is Date => !!d && !isNaN(d.getTime()));
  return taken.length ? new Date(Math.max(...taken.map(d => d.getTime()))) : null;
};
const isPolygraphOverdue = (last: Date, today = new Date()) =>
  new Date(today.getFullYear(), today.getMonth(), today.getDate()) >= new Date(last.getFullYear(), last.getMonth() + POLY_OVERDUE_MONTHS, last.getDate());
// For a client booked into a polygraph: how long since their last one, or that they haven't taken one yet
const polygraphHistoryText = (polygraphs: any[], today = new Date()) => {
  const last = lastPolygraphTaken(polygraphs);
  if (!last) return 'No polygraph taken yet.';
  const since = timeBetween(localYmd(last), localYmd(today));
  return `${since === 'Same day' ? 'Last polygraph was today' : `${since} since last polygraph`} (${last.toLocaleDateString()})${isPolygraphOverdue(last, today) ? ', overdue' : ''}.`;
};
// Red polygraph notice for a client's account, or null when none applies. BIP clients don't take polygraphs.
const polygraphNotice = (client: any, polygraphs: any[], today = new Date()) => {
  if (client.programtype === 'BIP' || client.nopolyrequired) return null;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const last = lastPolygraphTaken(polygraphs);
  if (last) {
    return isPolygraphOverdue(last, today) ? 'Client is overdue for their next Polygraph' : null;
  }
  if (!client.lastdateattended) return null;
  const days = Math.round((startOfToday.getTime() - toLocalDay(client.lastdateattended).getTime()) / 86400000);
  return `Client hasn't taken their first polygraph in ${days} day${days === 1 ? '' : 's'}`;
};
// Group program types offered for each client program type. Programs not listed see every group.
const GROUP_TYPES_BY_PROGRAM: Record<string, string[]> = {
  'State SO': ['SO', 'FED SO'],
  'Federal SO': ['SO', 'FED SO'],
  'Voluntary SO': ['SO', 'FED SO'],
  'BIP': ['BIP'],
};

// Ledger rows store the balance after each transaction. Working back from the amount gives the balance before it.
// A client's poly fee voucher runs 0 to this; the server fills it when the poly fee is paid in full
const POLY_VOUCHER_MAX = 6;

// Splits dated records into months (YYYY-MM), newest month first unless sorting oldest first; rows keep their order within a month
const groupByMonth = <T extends { date: string }>(rows: T[], sort: string) => {
  const byMonth = new Map<string, T[]>();
  for (const row of rows) {
    const key = localYmd(row.date).slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(row);
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => (sort === 'oldest' ? a.localeCompare(b) : b.localeCompare(a)))
    .map(([key, list]) => {
      const [y, m] = key.split('-').map(Number);
      return { key, label: new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }), rows: list };
    });
};

const toggleInSet = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
};

// Refunds and disputes take money back off a credit card payment, so like a charge they add to what the client owes
const PAYMENT_REVERSAL_TYPES = ['Refund', 'Dispute'];
const addsToOwed = (fin: any) => fin.type === 'Charge' || PAYMENT_REVERSAL_TYPES.includes(fin.type);

// Financial Ledger row colors: fees red, refunds and disputes amber, payments green
const LEDGER_TONES = {
  charge: { text: 'text-red-400', badge: 'text-red-400 bg-red-500/10 border-red-500/30' },
  reversal: { text: 'text-amber-400', badge: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  payment: { text: 'text-emerald-400', badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
};

// What's left of a credit card payment after its refunds and disputes (a won dispute puts its amount back),
// and how much is in dispute while one is open
const cardPaymentStatus = (payment: any, ledger: any[]) => {
  let refunded = 0;
  let kept = Number(payment.amount || 0);
  let lastDispute = 0;
  for (const row of ledger) {
    if (row.relatedtransactionid !== payment.transactionid) continue;
    const amount = Number(row.amount || 0);
    if (row.type === 'Refund') refunded += amount;
    if (PAYMENT_REVERSAL_TYPES.includes(row.type)) kept -= amount;
    else if (row.type === 'Dispute Won') kept += amount;
    if (row.type === 'Dispute') lastDispute = amount;
  }
  return {
    refunded,
    kept: Math.round(kept * 100) / 100,
    openDispute: payment.disputestatus === 'Open' ? lastDispute : 0,
  };
};

const ledgerBalanceChange = (fin: any) => {
  if (fin.finalbalance === null || fin.finalbalance === undefined) return null;
  const amount = Number(fin.amount || 0);
  const after = Number(fin.finalbalance);
  // Poly fee payments are tracked apart from the account, so they leave the balance where it was
  const changesBalance = fin.feetype !== 'Poly Fee';
  const before = !changesBalance ? after : addsToOwed(fin) ? after - amount : after + amount;
  return { before: toDisplayBalance(before), after: toDisplayBalance(after), changesBalance };
};

const POLY_CANCEL_REASONS =['Client requested cancellation', 'Client late / did not show', 'Examiner rescheduled', 'Weather', 'Other'];

// Results that can keep the client in the NDI voucher incentive, but only by Business Administrator override
const POLY_INCENTIVE_OVERRIDE_RESULTS = ['Inconclusive', 'No Opinion'];

// Hours of notice a client must give for a requested cancellation to get their poly fee vouchers back
const POLY_CANCEL_NOTICE_HOURS = 48;

// When a slot starts, in local time. Times may be stored as "14:30:00" or "2:30 PM".
const slotStart = (slot: any): Date | null => {
  const [year, month, day] = String(slot?.date || '').split('T')[0].split('-').map(Number);
  const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*$/i.exec(String(slot?.time || ''));
  if (!year || !month || !day || !match) return null;
  let hours = parseInt(match[1], 10) % (match[3] ? 12 : 24);
  if (match[3]?.toLowerCase() === 'pm') hours += 12;
  return new Date(year, month - 1, day, hours, Number(match[2]));
};

// Whether a cancellation returns the booking's poly fee vouchers: true/false is fixed by the reason, null leaves it to staff
const polyVoucherReturnRule = (reason: string, slot: any): boolean | null => {
  switch (reason) {
    case 'Weather':
    case 'Examiner rescheduled':
      return true;
    case 'Client late / did not show':
      return false;
    case 'Client requested cancellation': {
      const start = slotStart(slot);
      return start ? start.getTime() - Date.now() > POLY_CANCEL_NOTICE_HOURS * 60 * 60 * 1000 : null;
    }
    default:
      return null;
  }
};

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
  const [clientFilters, setClientFilters] = useState(DEFAULT_CLIENT_FILTERS);
  // Filter row is hidden until toggled; the choice is remembered in this browser. Filters still apply while hidden.
  const [showClientFilters, setShowClientFilters] = useState(() => {
    try { return localStorage.getItem('showClientFilters') === 'true'; } catch { return false; }
  });
  const toggleClientFilters = () => setShowClientFilters(show => {
    try { localStorage.setItem('showClientFilters', String(!show)); } catch { /* storage unavailable */ }
    return !show;
  });
  // Filters changed from the defaults, shown on the Filters button so hidden filters aren't forgotten
  const changedClientFilterCount = (Object.keys(DEFAULT_CLIENT_FILTERS) as (keyof typeof DEFAULT_CLIENT_FILTERS)[])
    .filter(key => clientFilters[key] !== DEFAULT_CLIENT_FILTERS[key]).length;
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
  // Change Log tab (Business Administrators only); filter '' shows every type
  const [clientChangeLog, setClientChangeLog] = useState<ClientChange[]>([]);
  const [changeLogFilter, setChangeLogFilter] = useState('');
  const [changeLogStatus, setChangeLogStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [clientAttendance, setClientAttendance] = useState<any[]>([]);
  const [clientFinancials, setClientFinancials] = useState<any[]>([]);
  const [clientNotes, setClientNotes] = useState<any[]>([]);
  // Case Notes and Financial Ledger filters in the client drawer; reset whenever a client is opened
  const [noteFilters, setNoteFilters] = useState(EMPTY_NOTE_FILTERS);
  // The new-note form and the filter row stay closed until their buttons open them
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showNoteFilters, setShowNoteFilters] = useState(false);
  // Inline edit of one case note; noteError is shown under the note it belongs to
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  // Payment being corrected in the Financial Ledger (Business Administrators only): a cash adjustment, or a refund or dispute step on a card payment
  const [paymentAction, setPaymentAction] = useState<{ id: number; kind: 'adjust' | CardPaymentAction; amount: string; reason: string } | null>(null);
  const [paymentActionError, setPaymentActionError] = useState('');
  // Shown in the ledger after a poly fee payment change when the client is already booked into a polygraph with vouchers
  const [scheduledPolyNotice, setScheduledPolyNotice] = useState<{ slotId: number; text: string } | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<{ noteId: number; message: string } | null>(null);
  const [attendanceFilters, setAttendanceFilters] = useState(EMPTY_ATTENDANCE_FILTERS);
  const [showAttendanceFilters, setShowAttendanceFilters] = useState(false);
  const [showLedgerFilters, setShowLedgerFilters] = useState(false);
  // Attendance and ledger months (YYYY-MM) the user has collapsed
  const [collapsedAttendanceMonths, setCollapsedAttendanceMonths] = useState<Set<string>>(() => new Set());
  const [collapsedLedgerMonths, setCollapsedLedgerMonths] = useState<Set<string>>(() => new Set());
  const [ledgerFilters, setLedgerFilters] = useState(EMPTY_LEDGER_FILTERS);
  const [clientPolygraphs, setClientPolygraphs] = useState<any[]>([]);
  // Client whose polygraphs are loaded, so the notice never uses the previous client's results
  const [clientPolygraphsFor, setClientPolygraphsFor] = useState<number | null>(null);
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
  // Temporary poly fee override: a reduced poly fee for a number of fills
  const [clientPolyOverride, setClientPolyOverride] = useState<PolyFeeOverride | null>(null);
  const [showPolyOverrideForm, setShowPolyOverrideForm] = useState(false);
  const [polyOverrideFee, setPolyOverrideFee] = useState('');
  const [polyOverrideFills, setPolyOverrideFills] = useState('1');
  const [polyOverrideError, setPolyOverrideError] = useState('');
  // Scheduling a polygraph from the client account's Polygraphs section
  const [drawerPolySlot, setDrawerPolySlot] = useState('');
  const [drawerPolyType, setDrawerPolyType] = useState('Maintenance');
  const [drawerPolyComment, setDrawerPolyComment] = useState('');

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
  // Poly Schedule and Poly Results filters; '' means no filter. Dates are YYYY-MM-DD, inclusive.
  const [polyExaminerFilter, setPolyExaminerFilter] = useState('');
  const [polyLocationFilter, setPolyLocationFilter] = useState('');
  const [polyDateFrom, setPolyDateFrom] = useState('');
  const [polyDateTo, setPolyDateTo] = useState('');
  const [polyDateSort, setPolyDateSort] = useState<'asc' | 'desc'>('asc');
  const [polySlots, setPolySlots] = useState<any[]>([]);
  // Slot opened from a client's account; outlined on the Poly Schedule for a few seconds
  const [highlightedSlotId, setHighlightedSlotId] = useState<number | null>(null);
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
  // Payment prompt for a client who lacks the poly fee vouchers needed to be scheduled
  const [polyPaymentPrompt, setPolyPaymentPrompt] = useState<{ client: any; amountDue: number; notice: string } | null>(null);
  // Business Administrator prompt to schedule inside the post-NDI waiting period; the box must be ticked to bypass
  const [waitBypassPrompt, setWaitBypassPrompt] = useState<{ slotId: number; clientName: string; lastPolyDate: string; earliestDate: string } | null>(null);
  const [waitBypassConfirmed, setWaitBypassConfirmed] = useState(false);
  // Cancellation prompt for an assigned slot
  const [reopenTarget, setReopenTarget] = useState<any>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenNotes, setReopenNotes] = useState('');
  const [reopenReturnVouchers, setReopenReturnVouchers] = useState(true);
  // Business Administrator override of the voucher return the cancellation reason would otherwise lock
  const [reopenVoucherOverride, setReopenVoucherOverride] = useState(false);
  const [slotTypes, setSlotTypes] = useState<{ [slotId: number]: string }>({});

  // Active slot selected on Poly Results tab
  const [selectedSlotForResults, setSelectedSlotForResults] = useState<any>(null);
  const [resResultType, setResResultType] = useState('No Deception Indicated');
  // Incentive program continuation on an Inconclusive or No Opinion result: unchecked and locked unless a Business Administrator overrides
  const [resIncentiveContinued, setResIncentiveContinued] = useState(false);
  const [resIncentiveOverride, setResIncentiveOverride] = useState(false);
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
  // Normalize location names (e.g., "Oklahoma City" → "OKC")
  const normalizeLocation = (loc: string) => loc === 'Oklahoma City' ? 'OKC' : loc;
  // Reverse normalization for storage (e.g., "OKC" → "Oklahoma City")
  const denormalizeLocation = (loc: string) => loc === 'OKC' ? 'Oklahoma City' : loc;
  // Directory filters; an empty string means "all". The list starts on active groups only.
  const [groupFilters, setGroupFilters] = useState(DEFAULT_GROUP_FILTERS);
  const changedGroupFilterCount = (Object.keys(DEFAULT_GROUP_FILTERS) as (keyof typeof DEFAULT_GROUP_FILTERS)[])
    .filter(k => groupFilters[k] !== DEFAULT_GROUP_FILTERS[k]).length;
  const groupFilterActive = changedGroupFilterCount > 0;
  // Same behavior as the Client Roster Filters button: hidden until toggled, remembered in this browser.
  const [showGroupFilters, setShowGroupFilters] = useState(() => {
    try { return localStorage.getItem('showGroupFilters') === 'true'; } catch { return false; }
  });
  const toggleGroupFilters = () => setShowGroupFilters(show => {
    try { localStorage.setItem('showGroupFilters', String(!show)); } catch { /* storage unavailable */ }
    return !show;
  });
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
  type GroupSortKey = 'groupname' | 'location' | 'counselor' | 'programtype' | 'schedule' | 'clientcount' | 'active';
  const [groupSort, setGroupSort] = useState<{ key: GroupSortKey; dir: 'asc' | 'desc' }>({ key: 'groupname', dir: 'asc' });
  const toggleGroupSort = (key: GroupSortKey) => {
    setGroupSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };
  const groupSortArrow = (key: GroupSortKey) => (groupSort.key === key ? (groupSort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const sortedDirectoryGroups = groups
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
  const [agentReportData, setAgentReportData] = useState<any[] | null>(null);
  const [depositReportData, setDepositReportData] = useState<any>(null);
  const [reportsError, setReportsError] = useState('');
  // The report tab last picked; null until one is picked (the role's first report shows)
  const [reportTab, setReportTab] = useState<string | null>(null);

  // Admin Module State
  const [employees, setEmployees] = useState<any[]>([]);
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  // Supervising agent directory, suggested in the client forms' agent field
  const [directoryAgents, setDirectoryAgents] = useState<SupervisingAgent[]>([]);
  // System audit logs stay collapsed until requested
  const [showSystemLogs, setShowSystemLogs] = useState(false);
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
  // '' shows every user type
  const [empRoleFilter, setEmpRoleFilter] = useState('');

  // Counselor dropdown choices: active employees with the Counselor role. A group's saved counselor is kept as an option even if that account is no longer listed
  const counselorOptions = employees.filter(e => e.role === 'Counselor' && e.active !== false).map(e => e.displayname as string).filter(Boolean);
  const counselorChoices = (current: string) => (current && !counselorOptions.includes(current) ? [current, ...counselorOptions] : counselorOptions);

  // Auto-scroll to group details when a group is selected
  useEffect(() => {
    if (selectedGroupDetail && groupDetailRef.current) {
      setTimeout(() => {
        // The panel opens under the clicked row, so only scroll as far as needed to show it
        groupDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    if (user && activeTab === 'attendance') loadOpenGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeTab]);

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

  // To be scheduled for a polygraph a client needs a full set of poly fee vouchers and an account balance of
  // $0.00 or better (stored sign: positive = owes). Mirrors the server's check on assignment.
  const polySchedulingNeeds = (client: any) => {
    const vouchers = Number(client.polyfeevoucher ?? 0);
    const polyFeePaid = Number(client.polyfeepaid ?? 0);
    const polyFee = Number(client.polyfee ?? 0);
    const short = vouchers < POLY_VOUCHER_MAX;
    // Paying off the poly fee is what fills the vouchers, so it is only owed while they are short
    const polyDue = short ? Math.max(0, polyFee - polyFeePaid) : 0;
    const balanceDue = Math.max(0, Number(client.accountbalance) || 0);
    return { vouchers, polyFeePaid, polyFee, short, polyDue, balanceDue, met: !short && balanceDue === 0 };
  };

  // Offers one payment covering what blocks scheduling: the rest of the poly fee first (which fills the vouchers),
  // then the account balance. Short vouchers with nothing owed on the poly fee must be fixed in Edit Info.
  const promptPolyPayment = (client: any) => {
    const name = `${client.firstname} ${client.lastname}`;
    const { vouchers, polyFeePaid, polyFee, short, polyDue, balanceDue } = polySchedulingNeeds(client);
    if (short && polyDue <= 0) {
      setError(`${name} has ${vouchers}/${POLY_VOUCHER_MAX} poly fee vouchers but nothing is owed on the poly fee. Correct the vouchers in the client's Edit Info.`);
      return;
    }
    const needs = [
      short && `${POLY_VOUCHER_MAX} poly fee vouchers (has ${vouchers}/${POLY_VOUCHER_MAX}; poly fee paid $${polyFeePaid.toFixed(2)} / $${polyFee.toFixed(2)}, $${polyDue.toFixed(2)} remaining)`,
      balanceDue > 0 && `an account balance of $0.00 or better (owes $${balanceDue.toFixed(2)})`,
    ].filter(Boolean);
    setPolyPaymentPrompt({
      client,
      amountDue: polyDue + balanceDue,
      notice: `Scheduling ${name} for a polygraph needs ${needs.join(' and ')}. `
        + `Paying $${(polyDue + balanceDue).toFixed(2)} covers ${polyDue > 0 && balanceDue > 0 ? 'both' : 'it'}`
        + (polyDue > 0 ? '; the poly fee is paid first.' : '.'),
    });
  };

  // Opens the confirmation box; the assignment is only saved when it is accepted.
  // clientId is passed when the slot's choice was set in the same click (scheduling from a client's account).
  const openAssignConfirm = (slotId: number, clientId = slotAssignments[slotId]) => {
    if (!clientId) {
      setError('Please select a client to assign to this slot.');
      return;
    }
    const client = clients.find(c => String(c.clientid) === clientId);
    if (client && !polySchedulingNeeds(client).met) {
      promptPolyPayment(client);
      return;
    }
    setPendingAssignSlotId(slotId);
  };

  const handleAssignSlotToClient = async (slotId: number, bypassWaitPeriod = false) => {
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
      const res = await assignPolygraphSlot(slotId, Number(clientId), assignedType, user.employeeemail, (slotComments[slotId] || '').trim(), bypassWaitPeriod);
      const client = clients.find(c => String(c.clientid) === clientId);
      if (res?.code === 'POLY_TOO_SOON' && client) {
        // Only Business Administrators reach this point; offer the override instead of a plain refusal
        setWaitBypassConfirmed(false);
        setWaitBypassPrompt({
          slotId,
          clientName: `${client.lastname}, ${client.firstname}`,
          lastPolyDate: res.lastPolyDate,
          earliestDate: res.earliestDate,
        });
      } else if (res?.code === 'POLY_SCHEDULING_REQUIREMENTS' && client) {
        // The server's figures are current; refresh the client and ask for the payment
        const updated = { ...client, polyfeevoucher: res.vouchers, polyfeepaid: res.polyFeePaid, polyfee: res.polyFee, accountbalance: res.accountBalance };
        setClients(prev => prev.map(c => c.clientid === client.clientid ? updated : c));
        promptPolyPayment(updated);
      } else if (res?.error) {
        setError(res.error);
      } else {
        setSlotComments({ ...slotComments, [slotId]: '' });
        setSuccessMsg(`Assigned ${assignedType} Polygraph slot to ${client ? client.lastname + ', ' + client.firstname : 'Client'}!`);
        // Reloaded from the server: the vouchers and paid-in-full poly fee are spent, and spending the last fill of a
        // poly fee override puts the regular poly fee back, which only the server knows about
        const [freshSlots, freshClients] = await Promise.all([getPolygraphSlots(), getClients()]);
        setPolySlots(freshSlots);
        setClients(freshClients);
        // Scheduled from the client's account: show the booking and the spent vouchers there too
        setSelectedClientDetail((c: any) => (c ? { ...c, ...(freshClients.find((fc: any) => fc.clientid === c.clientid) ?? {}) } : c));
        setDrawerPolySlot('');
        setDrawerPolyComment('');
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
    setReopenReturnVouchers(true);
    setReopenVoucherOverride(false);
    setReopenTarget(polySlots.find(s => s.slotid === slotId) || { slotid: slotId });
  };

  const confirmReopenSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenTarget || !reopenReason) return;
    const slotId = reopenTarget.slotid;
    setLoading(true);
    try {
      const res = await reopenPolygraphSlot(slotId, { reason: reopenReason, notes: reopenNotes, returnVouchers: (reopenVoucherOverride ? null : polyVoucherReturnRule(reopenReason, reopenTarget)) ?? reopenReturnVouchers, overrideVoucherRule: reopenVoucherOverride, user: user.employeeemail });
      if (res?.error) {
        setError(res.error);
      } else {
        setReopenTarget(null);
        setSuccessMsg(res.reopened === false
          ? 'Reservation cancelled. The appointment time has passed, so the slot was closed instead of reopened.'
          : 'Reservation cancelled. Polygraph slot is now open for new bookings!');
        if (selectedSlotForResults?.slotid === slotId) {
          setSelectedSlotForResults(null);
        }
        // Clients are reloaded too: cancelling can return the booking's poly fee vouchers
        const [freshSlots, freshClients] = await Promise.all([getPolygraphSlots(), getClients()]);
        setPolySlots(freshSlots);
        setClients(freshClients);
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

  const clientId = Number(selectedSlotForResults.assignedClientId);
  if (!(clientId > 0)) {
    setError('This slot has no assigned client, so the result cannot be recorded.');
    return;
  }

  try {
    const res = await submitPolygraphResult({
      client: clientId,
      date: new Date().toISOString().split('T')[0],
      type: selectedSlotForResults.type || 'Maintenance',
      results: resResultType,
      polygrapher: selectedSlotForResults.polygrapher || user.employeeemail,
      notes: resNotes,
      // The server reads the polygraph's date and time from the slot
      slotId: selectedSlotForResults.slotid,
      incentiveContinued: POLY_INCENTIVE_OVERRIDE_RESULTS.includes(resResultType) && resIncentiveOverride && resIncentiveContinued,
      user: user.employeeemail
    });
    // Keep the slot unless the result was saved, so nothing is lost
    if (res?.error) throw new Error(res.error);

    if (selectedSlotForResults.slotid) {
      await deletePolygraphSlot(selectedSlotForResults.slotid);
    }

    setSelectedSlotForResults(null);
    setResNotes('');
    setResIncentiveContinued(false);
    setResIncentiveOverride(false);
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
  // Start date defaults to today's local date, computed each time the form is reset.
  const getEmptyNewClient = () => ({
    firstname: '', middlename: '', lastname: '', docnumber: '', supervisingagent: '',
    programstartdate: new Date().toLocaleDateString('en-CA'),
    // Program type starts blank and must be chosen; phase and treatment fee are filled in from it
    programstatus: 'Active', phase: '', programtype: '', groupid: '',
    address: '', city: '', county: '', state: '', zip: '',
    mainphone: '', altphone: '', emergencycontact: '', emergencycontactphone: '', comments: '',
    treatmentfee: 0, vouchers: ''
  });
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClient, setNewClient] = useState(getEmptyNewClient);
  const newClientField = (label: string, key: keyof ReturnType<typeof getEmptyNewClient>, type = 'text', required = false, listId?: string) => (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}{required ? ' *' : ''}</label>
      <input type={type} required={required} list={listId} value={newClient[key]} onChange={(e) => setNewClient({ ...newClient, [key]: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" />
    </div>
  );

  // Asked after a client is created as BIP or switched to BIP: open a BIP Intake or DV Assessment, or none
  const [bipIntakePrompt, setBipIntakePrompt] = useState<{ clientid: number; name: string; groupCounselor?: string | null } | null>(null);
  const counselorOfGroup = (groupid: unknown) => groups.find(g => String(g.groupid) === String(groupid ?? ''))?.counselor ?? null;

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await createClient({ ...newClient, groupid: newClient.groupid || null, createdBy: user.employeeemail });
      setSuccessMsg(res.message || 'Client added successfully!');
      if (newClient.programtype === 'BIP') {
        setBipIntakePrompt({ clientid: res.clientId, name: `${newClient.lastname.trim()}, ${newClient.firstname.trim()}`, groupCounselor: counselorOfGroup(newClient.groupid) });
      }
      setNewClient(getEmptyNewClient());
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
    await assignClientToGroup(selectedGroupDetail.groupid, clientId, user.employeeemail);
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
  // The agent and deposit reports are fetched fresh each time their tab is shown
  const currentReport = currentReportFor(reportTab, user?.role);
  useEffect(() => {
    if (activeTab !== 'reports' || (currentReport !== 'agent' && currentReport !== 'deposit')) return;
    let cancelled = false;
    setReportsError('');
    if (currentReport === 'agent') {
      setAgentReportData(null);
      getAgentReport()
        .then(data => { if (!cancelled) setAgentReportData(data); })
        .catch(() => { if (!cancelled) setReportsError('Failed to load the weekly agent report.'); });
    } else {
      setDepositReportData(null);
      getDepositReport()
        .then(data => { if (!cancelled) setDepositReportData(data); })
        .catch(() => { if (!cancelled) setReportsError('Failed to load the monthly deposit report.'); });
    }
    return () => { cancelled = true; };
  }, [activeTab, currentReport]);

  // Admin User Creation. The form stays closed until New User or an account's Edit opens it.
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const resetEmployeeForm = () => {
    setShowEmployeeForm(false);
    setEditingEmail(null);
    setEmpEmail('');
    setEmpName('');
    setEmpRole('Counselor');
    setEmpActive(true);
    setEmpPassword('');
  };

  const startEditEmployee = (emp: any) => {
    setShowEmployeeForm(true);
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

  // No Poly Required stays locked until a Business Administrator overrides it; each change is saved right away
  const [noPolyOverride, setNoPolyOverride] = useState(false);
  const [noPolySaving, setNoPolySaving] = useState(false);
  const handleNoPolyRequiredChange = async (checked: boolean) => {
    if (!selectedClientDetail) return;
    const clientid = selectedClientDetail.clientid;
    setNoPolySaving(true);
    try {
      const saved = await setClientNoPolyRequired(clientid, checked, user.employeeemail);
      setSelectedClientDetail((c: any) => (c && c.clientid === clientid ? { ...c, nopolyrequired: saved } : c));
      setClients(prev => prev.map(c => c.clientid === clientid ? { ...c, nopolyrequired: saved } : c));
      setClientNotes(await getClientNotes(clientid));
      setNoPolyOverride(false);
      setSuccessMsg(`No Poly Required ${saved ? 'checked' : 'unchecked'} for ${selectedClientDetail.firstname} ${selectedClientDetail.lastname}.`);
    } catch (err: any) {
      setError(err.message || 'Failed to update No Poly Required.');
    } finally {
      setNoPolySaving(false);
    }
  };

  // A discharged client's program status is locked; only the Activate button changes it
  const clientIsDischarged = DISCHARGE_STATUSES.includes(selectedClientDetail?.programstatus);

  // Program status dialog: Discharge (Business Administrators only) or Activate (any account type, discharged clients only).
  // Pick a status and write a note, Proceed, then confirm.
  const [statusDialog, setStatusDialog] = useState<'discharge' | 'activate' | null>(null);
  const [statusDialogChoice, setStatusDialogChoice] = useState('');
  const [statusDialogSubcategory, setStatusDialogSubcategory] = useState('');
  const [statusDialogNote, setStatusDialogNote] = useState('');
  const [statusDialogConfirming, setStatusDialogConfirming] = useState(false);
  const [statusDialogSaving, setStatusDialogSaving] = useState(false);
  const [statusDialogError, setStatusDialogError] = useState('');
  // Activating a BIP client also offers to open a BIP Reinstate (or a new intake when a reinstate isn't allowed)
  const [reinstateChoice, setReinstateChoice] = useState<BipAssessmentChoice>({ choice: '', provider: '' });
  const offerReinstate = statusDialog === 'activate' && selectedClientDetail?.programtype === 'BIP';
  const openStatusDialog = (action: 'discharge' | 'activate') => {
    setStatusDialogError('');
    setReinstateChoice({ choice: '', provider: bipCounselorChoices(employees, counselorOfGroup(selectedClientDetail?.groupid)).defaultCounselor });
    setStatusDialogChoice('');
    setStatusDialogSubcategory('');
    setStatusDialogNote('');
    setStatusDialogConfirming(false);
    setStatusDialog(action);
  };
  const handleStatusDialogConfirm = async () => {
    if (!selectedClientDetail || !statusDialog) return;
    const clientid = selectedClientDetail.clientid;
    setStatusDialogSaving(true);
    setStatusDialogError('');
    try {
      const programstatus = await changeClientProgramStatus(statusDialog, clientid, statusDialogChoice, statusDialogSubcategory || null, statusDialogNote.trim(), user.employeeemail);
      setSelectedClientDetail((c: any) => (c && c.clientid === clientid ? { ...c, programstatus } : c));
      setClientInfoForm((f: any) => (f && f.clientid === clientid ? { ...f, programstatus } : f));
      setClients(prev => prev.map(c => c.clientid === clientid ? { ...c, programstatus } : c));
      setClientNotes(await getClientNotes(clientid));
      if (clientTab === 'changelog') await openChangeLog();
      // Discharging also saves a discharge summary PDF to the client's attachments
      if (clientTab === 'attachments') setClientAttachments(await getClientAttachments(clientid));
      setStatusDialog(null);
      setSuccessMsg(statusDialog === 'activate'
        ? `${selectedClientDetail.firstname} ${selectedClientDetail.lastname} set to ${programstatus}.`
        : `${selectedClientDetail.firstname} ${selectedClientDetail.lastname} discharged as ${programstatus}. Discharge summary saved to Attachments.`);
      if (offerReinstate && reinstateChoice.choice !== 'none') {
        // The client is already activated; a failure here only means the assessment wasn't opened
        try {
          const name = await openBipAssessment(clientid, reinstateChoice, user.employeeemail);
          setSuccessMsg(`${selectedClientDetail.firstname} ${selectedClientDetail.lastname} set to ${programstatus}. ${name} opened on the Assessments & Individuals tab.`);
        } catch (err: any) {
          setError(`Client activated, but the assessment could not be opened: ${err.message || 'unknown error'}. Open it on the Assessments & Individuals tab.`);
        }
      }
    } catch (err: any) {
      // Shown inside the dialog, which stays on the confirm step so it can be retried
      setStatusDialogError(err.message || `Failed to ${statusDialog} client.`);
    } finally {
      setStatusDialogSaving(false);
    }
  };

  // Loaded each time the tab is opened so it includes changes made since the drawer opened
  const openChangeLog = async () => {
    if (!selectedClientDetail) return;
    setClientTab('changelog');
    setChangeLogStatus('loading');
    try {
      setClientChangeLog(await getClientChangeLog(selectedClientDetail.clientid, user.employeeemail));
      setChangeLogStatus('ready');
    } catch (err: any) {
      setClientChangeLog([]);
      setChangeLogStatus('error');
      setError(err.message || 'Failed to load the change log.');
    }
  };

  // Drawer Log Loading
  const openClientLogs = async (client: any) => {
    setNoPolyOverride(false);
    setStatusDialog(null);
    setClientAttachments([]);
    setAttachmentsStatus('idle');
    setAttachmentError('');
    setChangeLogFilter('');
    setClientChangeLog([]);
    setChangeLogStatus('idle');
    setNoteFilters(EMPTY_NOTE_FILTERS);
    setShowNoteForm(false);
    setShowNoteFilters(false);
    setNewNoteText('');
    setEditingNoteId(null);
    setNoteError(null);
    setAttendanceFilters(EMPTY_ATTENDANCE_FILTERS);
    setShowAttendanceFilters(false);
    setCollapsedAttendanceMonths(new Set());
    setCollapsedLedgerMonths(new Set());
    setShowLedgerFilters(false);
    setLedgerFilters(EMPTY_LEDGER_FILTERS);
    setPaymentAction(null);
    setPaymentActionError('');
    setScheduledPolyNotice(null);
    setSelectedClientDetail(client);
    setClientTab('information');
    setEditingClientInfo(false);
    setClientInfoForm({ ...client });
    setShowFeeOverrideForm(false);
    setFeeOverrideInput('');
    setFeeOverrideDate('');
    setClientFeeOverride(null);
    setClientPolyOverride(null);
    setShowPolyOverrideForm(false);
    setPolyOverrideError('');
    setDrawerPolySlot('');
    setDrawerPolyType('Maintenance');
    setDrawerPolyComment('');
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
    try {
      const { override } = await fetchClientFeeOverride(client.clientid);
      setClientFeeOverride(override);
    } catch (err: any) {
      setClientInfoError(err.message || 'Could not load the temporary fee override.');
    }
    try {
      const { override } = await fetchPolyFeeOverride(client.clientid);
      setClientPolyOverride(override);
    } catch (err: any) {
      setPolyOverrideError(err.message || 'Could not load the poly fee override.');
    }
  };

  // Poly fields changed by a poly fee override; applied to the open client and the client list
  const applyPolyOverrideResult = (clientid: number, res: PolyFeeOverrideResult) => {
    const changes = { polyfeepaid: res.polyFeePaid, polyfee: res.polyFee, polyfeevoucher: res.polyFeeVoucher };
    setSelectedClientDetail((c: any) => (c && c.clientid === clientid ? { ...c, ...changes } : c));
    setClients(prev => prev.map(c => c.clientid === clientid ? { ...c, ...changes } : c));
  };

  // Attachments: loaded each time the tab is opened. View/Print only open types the browser can show safely;
  // everything else (and anything that could run script, like HTML or SVG) is download only.
  const [clientAttachments, setClientAttachments] = useState<ClientAttachment[]>([]);
  const [attachmentsStatus, setAttachmentsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const VIEWABLE_ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'text/plain'];
  const canViewAttachment = (a: ClientAttachment) => VIEWABLE_ATTACHMENT_TYPES.includes(a.contenttype);
  const formatFileSize = (bytes: number) =>
    bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  const openAttachments = async () => {
    if (!selectedClientDetail) return;
    setClientTab('attachments');
    setAttachmentError('');
    setAttachmentsStatus('loading');
    try {
      setClientAttachments(await getClientAttachments(selectedClientDetail.clientid));
      setAttachmentsStatus('ready');
    } catch (err: any) {
      setClientAttachments([]);
      setAttachmentsStatus('error');
      setAttachmentError(err.message || 'Could not load attachments.');
    }
  };

  const handleAttachmentUpload = async (files: FileList | null) => {
    if (!selectedClientDetail || !files || files.length === 0) return;
    const clientid = selectedClientDetail.clientid;
    const tooBig = Array.from(files).filter(f => f.size > ATTACHMENT_MAX_BYTES);
    if (tooBig.length > 0) {
      setAttachmentError(`Larger than 25 MB: ${tooBig.map(f => f.name).join(', ')}`);
      return;
    }
    setAttachmentUploading(true);
    setAttachmentError('');
    try {
      for (const file of Array.from(files)) {
        await uploadClientAttachment(clientid, file, user.employeeemail);
      }
      setClientAttachments(await getClientAttachments(clientid));
      setSuccessMsg(files.length === 1 ? `Attached ${files[0].name}.` : `Attached ${files.length} files.`);
    } catch (err: any) {
      setAttachmentError(err.message || 'Upload failed.');
      setClientAttachments(await getClientAttachments(clientid).catch(() => clientAttachments));
    } finally {
      setAttachmentUploading(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  };

  // mode: view opens a new tab, download saves the file, print sends it to a hidden frame's print dialog
  const handleAttachmentOpen = async (attachment: ClientAttachment, mode: 'view' | 'download' | 'print') => {
    setAttachmentError('');
    // Opened before the fetch so the browser doesn't treat it as a blocked popup
    const viewer = mode === 'view' ? window.open('', '_blank') : null;
    try {
      const url = URL.createObjectURL(await fetchClientAttachment(attachment));
      if (mode === 'view') {
        if (viewer) viewer.location.href = url; else window.open(url, '_blank');
      } else if (mode === 'download') {
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.filename;
        link.click();
      } else {
        const frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        frame.onload = () => {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          setTimeout(() => frame.remove(), 60000);
        };
        frame.src = url;
        document.body.appendChild(frame);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: any) {
      viewer?.close();
      setAttachmentError(err.message || 'Could not open the attachment.');
    }
  };

  // Rename happens in place on the attachment row; Enter saves, Escape cancels
  const [renamingAttachmentId, setRenamingAttachmentId] = useState<number | null>(null);
  const [attachmentRenameValue, setAttachmentRenameValue] = useState('');
  const [attachmentRenameSaving, setAttachmentRenameSaving] = useState(false);
  const startAttachmentRename = (attachment: ClientAttachment) => {
    setAttachmentError('');
    setRenamingAttachmentId(attachment.attachmentid);
    setAttachmentRenameValue(attachment.filename);
  };
  const handleAttachmentRename = async (attachment: ClientAttachment) => {
    const name = attachmentRenameValue.trim();
    if (!name || name === attachment.filename) {
      setRenamingAttachmentId(null);
      return;
    }
    setAttachmentRenameSaving(true);
    setAttachmentError('');
    try {
      const saved = await renameClientAttachment(attachment.attachmentid, name, user.employeeemail);
      setClientAttachments(prev => prev.map(a => a.attachmentid === saved.attachmentid ? saved : a));
      setRenamingAttachmentId(null);
    } catch (err: any) {
      setAttachmentError(err.message || 'Failed to rename the attachment.');
    } finally {
      setAttachmentRenameSaving(false);
    }
  };

  const handleAttachmentDelete = async (attachment: ClientAttachment) => {
    if (!window.confirm(`Delete ${attachment.filename}? This cannot be undone.`)) return;
    setAttachmentError('');
    try {
      await deleteClientAttachment(attachment.attachmentid, user.employeeemail);
      setClientAttachments(prev => prev.filter(a => a.attachmentid !== attachment.attachmentid));
    } catch (err: any) {
      setAttachmentError(err.message || 'Failed to delete the attachment.');
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
    setShowNoteForm(false);
    const updatedNotes = await getClientNotes(selectedClientDetail.clientid);
    setClientNotes(updatedNotes);
  };

  // Matches the server rule: the note's author or a Business Administrator
  const canChangeNote = (note: any) =>
    user?.role === 'Business Administrator' || String(note.User || '').trim().toLowerCase() === String(user?.employeeemail || '').trim().toLowerCase();

  const handleSaveNoteEdit = async (noteId: number) => {
    if (!editNoteText.trim()) {
      setNoteError({ noteId, message: 'The note cannot be empty.' });
      return;
    }
    setNoteSaving(true);
    setNoteError(null);
    try {
      const saved = await updateClientNote(noteId, { user: user.employeeemail, comments: editNoteText });
      setClientNotes(notes => notes.map(n => (n.noteid === noteId ? saved : n)));
      setEditingNoteId(null);
    } catch (err: any) {
      setNoteError({ noteId, message: err.message || 'Failed to save the note.' });
    } finally {
      setNoteSaving(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!window.confirm('Delete this case note? This cannot be undone.')) return;
    setNoteError(null);
    try {
      await deleteClientNote(noteId, user.employeeemail);
      setClientNotes(notes => notes.filter(n => n.noteid !== noteId));
      if (editingNoteId === noteId) setEditingNoteId(null);
    } catch (err: any) {
      setNoteError({ noteId, message: err.message || 'Failed to delete the note.' });
    }
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

  const handlePaymentAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentAction || !selectedClientDetail) return;
    const { id, kind } = paymentAction;
    const reason = paymentAction.reason.trim();
    const amount = Number(paymentAction.amount);
    const needsAmount = kind === 'adjust' || kind === 'refund' || kind === 'dispute';
    if ((needsAmount && !(amount > 0)) || !reason) return;
    const clientid = selectedClientDetail.clientid;
    setLoading(true);
    setPaymentActionError('');
    try {
      const res: PaymentChangeResult = kind === 'adjust'
        ? await adjustCashPayment(id, { amount, reason, user: user.employeeemail })
        : await recordCardPaymentAction(id, { action: kind, amount: needsAmount ? amount : undefined, reason, user: user.employeeemail });
      const changes: any = { accountbalance: res.newBalance };
      if (res.polyFeePaid !== undefined) changes.polyfeepaid = res.polyFeePaid;
      if (res.polyFeeVoucher !== undefined) changes.polyfeevoucher = res.polyFeeVoucher;
      setSelectedClientDetail((c: any) => (c && c.clientid === clientid ? { ...c, ...changes } : c));
      setClients(prev => prev.map(c => c.clientid === clientid ? { ...c, ...changes } : c));
      setPaymentAction(null);
      const what = {
        adjust: `Payment adjusted to ${formatMoney(amount)}.`,
        refund: `Refund of ${formatMoney(amount)} recorded.`,
        dispute: `Dispute of ${formatMoney(amount)} recorded; the amount is owed again until the dispute is won.`,
        'dispute-won': 'Dispute marked won; the payment is applied again.',
        'dispute-lost': 'Dispute marked lost.',
      }[kind];
      setSuccessMsg(`${what} Updated Balance: ${formatBalance(res.newBalance)}.`
        + (res.vouchersRemoved ? ` ${res.vouchersRemoved} poly fee voucher(s) removed.` : '')
        + (res.vouchersAdded ? ' Poly fee paid in full; vouchers filled.' : '')
        + (res.attendanceUpdated ? ' The check-in it was taken at and the Group Income Report were updated too.' : ''));
      if (res.scheduledPolygraph) {
        const p = res.scheduledPolygraph;
        setScheduledPolyNotice({
          slotId: p.slotId,
          text: `This client already has a polygraph scheduled ${new Date(`${p.date}T00:00:00`).toLocaleDateString()}${p.time ? ` @ ${formatDisplayTime(p.time)}` : ''}${p.location ? ` (${p.location})` : ''} using poly fee vouchers. Changing the poly fee payment did not cancel it or return the vouchers.`,
        });
      }
      // Later ledger and attendance rows carry the new balance; a poly fee change can add or take back an override fill
      const [att, fin, poly] = await Promise.all([getClientAttendance(clientid), getClientFinancials(clientid), fetchPolyFeeOverride(clientid)]);
      setClientAttendance(att);
      setClientFinancials(fin);
      setClientPolyOverride(poly.override);
    } catch (err: any) {
      setPaymentActionError(err.message || 'Could not save the change.');
    } finally {
      setLoading(false);
    }
  };

  const handleCallInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Typed text that was never picked from the list leaves no client or group selected
    if (callInMode === 'client' ? !selectedClient : !selectedGroup) return;
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

  // Scrolls to and briefly outlines a slot opened from a client's account. Kept above the sign-in return so the hook count never changes.
  useEffect(() => {
    if (highlightedSlotId === null || activeTab !== 'polygraph') return;
    document.getElementById(`poly-slot-${highlightedSlotId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = setTimeout(() => setHighlightedSlotId(null), 4000);
    return () => clearTimeout(timer);
  }, [highlightedSlotId, activeTab]);

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
    // Reports holds only the Group Cash Deposits report for them
    if (role === 'Counselor' || role === 'Therapist') return ['clients', 'attendance', 'sessions', 'callin', 'polygraph', 'groups', 'testing', 'reports', 'agents'].includes(tab);
    if (role === 'Polygrapher') return ['polygraph'].includes(tab);
    // Unknown roles get no sections, rather than full access
    return false;
  };

  // Client directory search: matches name, DOC #, agent, group, program, phase, and status
  const clientSearchTerm = clientSearch.trim().toLowerCase();
  const clientFilterActive = Object.values(clientFilters).some(Boolean);
  const distinctClientValues = (key: 'agent' | 'programtype' | 'phase' | 'currentgroup' | 'status') => {
    if (key === 'status') return PROGRAM_STATUSES;
    if (key === 'phase') {
      // SO phases in phase order, then BIP weeks by number, then anything else
      const rank = (p: string) => SO_PHASES.includes(p) ? SO_PHASES.indexOf(p) : isWholeNumber(p) ? 100 + Number(p) : Infinity;
      return Array.from(new Set(clients.map(c => String(c.phase ?? '').trim()).filter(Boolean)))
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    }
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
      if (clientFilters.phase && String(c.phase ?? '').trim() !== clientFilters.phase) return false;
      if (clientFilters.currentgroup && c.groupname !== clientFilters.currentgroup) return false;
      if (clientFilters.status && c.programstatus !== clientFilters.status) return false;
      if (clientFilters.feeoverride === 'active' && (c.activefeeoverride === null || c.activefeeoverride === undefined)) return false;
      if (clientFilters.feeoverride === 'none' && c.activefeeoverride !== null && c.activefeeoverride !== undefined) return false;

      return true;
    });

  // Client drawer: Attendance, Case Notes, and Financial Ledger after filters and sort
  const byDate = (sort: string) => (a: any, b: any) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    return sort === 'oldest' ? diff : -diff;
  };
  const attendanceSearch = attendanceFilters.search.trim().toLowerCase();
  const shownAttendance = clientAttendance.filter(a => {
    const day = localYmd(a.date);
    const paid = Number(a.accountpaid || 0) > 0;
    if (attendanceFilters.group && (a.groupname || 'Group Session') !== attendanceFilters.group) return false;
    if (attendanceFilters.type && a.type !== attendanceFilters.type) return false;
    if (attendanceFilters.payment === 'Paid' && !paid) return false;
    if (attendanceFilters.payment === 'No Payment' && paid) return false;
    if (attendanceFilters.from && day < attendanceFilters.from) return false;
    if (attendanceFilters.to && day > attendanceFilters.to) return false;
    if (attendanceSearch && ![a.groupname, a.groupschedule, a.type, a.comments, a.paymentmethod].some(v => String(v ?? '').toLowerCase().includes(attendanceSearch))) return false;
    return true;
  }).sort(byDate(attendanceFilters.sort));
  const noteSearch = noteFilters.search.trim().toLowerCase();
  const shownNotes = clientNotes.filter(n => {
    const day = localYmd(n.date);
    if (noteFilters.category && n.category !== noteFilters.category) return false;
    if (noteFilters.from && day < noteFilters.from) return false;
    if (noteFilters.to && day > noteFilters.to) return false;
    if (noteSearch && ![n.comments, n.User, caseNoteLabel(n)].some(v => String(v ?? '').toLowerCase().includes(noteSearch))) return false;
    return true;
  }).sort(byDate(noteFilters.sort));

  const ledgerSearch = ledgerFilters.search.trim().toLowerCase();
  const shownLedger = clientFinancials.filter(f => {
    const day = localYmd(f.date);
    if (ledgerFilters.type && f.type !== ledgerFilters.type) return false;
    if (ledgerFilters.feeType && f.feetype !== ledgerFilters.feeType) return false;
    if (ledgerFilters.method && f.paymentmethod !== ledgerFilters.method) return false;
    if (ledgerFilters.from && day < ledgerFilters.from) return false;
    if (ledgerFilters.to && day > ledgerFilters.to) return false;
    if (ledgerSearch && ![f.comments, f.feetype, f.type, f.paymentmethod, Number(f.amount).toFixed(2)].some(v => String(v ?? '').toLowerCase().includes(ledgerSearch))) return false;
    return true;
  }).sort((a, b) => {
    if (ledgerFilters.sort === 'amount-high') return Number(b.amount) - Number(a.amount);
    if (ledgerFilters.sort === 'amount-low') return Number(a.amount) - Number(b.amount);
    return byDate(ledgerFilters.sort)(a, b);
  });

  // A reservation cancelled after its appointment time closes the slot instead of reopening it
  const reopenStart = reopenTarget ? slotStart(reopenTarget) : null;
  const reopenPassed = reopenStart !== null && reopenStart.getTime() <= Date.now();

  // Only active Polygraphers can be picked as the examiner for a new slot
  const activePolygraphers = employees.filter(e => e.role === 'Polygrapher' && e.active !== false);
  const getExaminerDisplayName = (email: string) =>
    employees.find(e => e.employeeemail === email)?.displayname || email;

  // Examiner filter choices: every examiner with a slot on the schedule, listed by name
  const polyExaminerChoices = Array.from(new Set(polySlots.map(s => s.polygrapher).filter(Boolean) as string[]))
    .map(email => ({ email, name: getExaminerDisplayName(email) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const polyLocationChoices = Array.from(new Set(polySlots.map(s => s.location).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  const polyFiltersActive = !!(polyExaminerFilter || polyLocationFilter || polyDateFrom || polyDateTo);
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

  // The polygraph slot a client is booked into, if any
  const assignedSlotFor = (clientId: number) =>
    polySlots.find(s => s.status === 'Assigned' && Number(s.assignedClientId) === Number(clientId)) ?? null;

  // Leaves the client account for the Poly Schedule with filters cleared, so the slot is in the list, and outlines it
  const openPolySlot = (slotId: number) => {
    setSelectedClientDetail(null);
    setPolyExaminerFilter('');
    setPolyLocationFilter('');
    setPolyDateFrom('');
    setPolyDateTo('');
    setPolySubTab('schedule');
    setActiveTab('polygraph');
    setHighlightedSlotId(slotId);
  };

  const slotSummary = (slot: any) =>
    `${new Date(slot.date).toLocaleDateString()} @ ${formatDisplayTime(slot.time)}${slot.location ? ` · ${slot.location}` : ''}`;

  // Roster, Assign Clients, and Group Details for the open group in the Group Directory. Shown under the group's row.
  const renderGroupDetailPanel = () => selectedGroupDetail && (
    <div ref={groupDetailRef} className="p-6 space-y-4 text-left">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <h3 className="text-lg font-bold text-white">Managing: {selectedGroupDetail.groupname}</h3>
        <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button onClick={() => setGroupTab('roster')} className={`px-3 py-1 rounded text-xs font-semibold ${groupTab === 'roster' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Roster</button>
          <button onClick={() => setGroupTab('assign')} className={`px-3 py-1 rounded text-xs font-semibold ${groupTab === 'assign' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Assign Clients</button>
          <button onClick={() => setGroupTab('schedule')} className={`px-3 py-1 rounded text-xs font-semibold ${groupTab === 'schedule' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Group Details</button>
        </div>
        <div className="flex items-center gap-2">
          {canDeleteGroups && (
            <button onClick={handleDeleteGroup} disabled={loading} className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-semibold">Delete Group</button>
          )}
          <button type="button" onClick={() => setSelectedGroupDetail(null)} aria-label="Close group" className="text-slate-400 hover:text-white p-1 rounded bg-slate-800"><X size={16} /></button>
        </div>
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
  );

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
          {isAllowed('admin') && <button onClick={() => setActiveTab('admin')} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'admin' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' : 'bg-slate-800 border border-transparent text-slate-400 hover:bg-slate-700 hover:text-white'}`}><Settings size={16} /> Admin</button>}
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
        {isAllowed('sessions') && <button onClick={() => setActiveTab('sessions')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'sessions' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><ClipboardList size={16} /> Assessments & Individuals</button>}
        {isAllowed('callin') && <button onClick={() => setActiveTab('callin')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'callin' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><PhoneCall size={16} /> Call-In Log</button>}
        {isAllowed('groups') && <button onClick={() => setActiveTab('groups')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'groups' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><Layers size={16} /> Groups</button>}
        {isAllowed('testing') && <button onClick={() => setActiveTab('testing')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'testing' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><CheckSquare size={16} /> Testing</button>}
        {isAllowed('polygraph') && <button onClick={() => setActiveTab('polygraph')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'polygraph' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><ShieldAlert size={16} /> Polygraphs</button>}
        {isAllowed('reports') && <button onClick={() => setActiveTab('reports')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'reports' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><BarChart3 size={16} /> Reports</button>}
        {isAllowed('agents') && <button onClick={() => setActiveTab('agents')} className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm whitespace-nowrap transition ${activeTab === 'agents' ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}><UserCheck size={16} /> Supervising Agents</button>}
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
                  <button
                    type="button"
                    onClick={toggleClientFilters}
                    aria-expanded={showClientFilters}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showClientFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
                  >
                    <SlidersHorizontal size={13} /> Filters
                    {changedClientFilterCount > 0 && (
                      <span className="bg-blue-600 text-white rounded-full px-1.5 text-[10px] leading-4">{changedClientFilterCount}</span>
                    )}
                  </button>
                  <span className="text-xs bg-slate-800 px-3 py-1 rounded-full text-slate-300 whitespace-nowrap">
                    {filteredClients.length === clients.length ? `${clients.length} Registered Clients` : `${filteredClients.length} of ${clients.length} Clients`}
                  </span>
                </div>
              </div>

              {showClientFilters && (
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
                  value={clientFilters.phase}
                  onChange={(e) => setClientFilters({ ...clientFilters, phase: e.target.value })}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
                >
                  <option value="">Phase: All</option>
                  {distinctClientValues('phase').map(phase => (
                    // BIP clients store a week number as their phase
                    <option key={phase} value={phase}>{isWholeNumber(phase) ? `Week ${phase} (BIP)` : phase}</option>
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
                    onClick={() => setClientFilters(DEFAULT_CLIENT_FILTERS)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
              )}
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
                  {newClientField('DOC #', 'docnumber')}
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Supervising Agent</label>
                    <AgentPicker value={newClient.supervisingagent} onChange={v => setNewClient({ ...newClient, supervisingagent: v })} agents={directoryAgents} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" />
                  </div>
                  {newClientField('Program Start Date', 'programstartdate', 'date', true)}

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Program Status *</label>
                    <select required value={newClient.programstatus} onChange={(e) => setNewClient({ ...newClient, programstatus: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm">
                      {EDITABLE_PROGRAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Section 2 – Program & Account Info */}
                  <div className="md:col-span-3">
                    <h4 className="text-xs font-semibold text-blue-400 uppercase mb-3 tracking-wider">Program &amp; Account Info</h4>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Program Type *</label>
                    <select required value={newClient.programtype} onChange={(e) => {
                      const programType = e.target.value;
                      setNewClient({
                        ...newClient,
                        programtype: programType,
                        phase: SO_PROGRAM_TYPES.includes(programType) ? 'Phase 1 - Weekly' : programType === 'BIP' ? '0' : '',
                        treatmentfee: programType === 'BIP' ? 35 : (STATE_FEE_PROGRAM_TYPES.includes(programType) ? SO_TREATMENT_FEES['Phase 1 - Weekly'] : 0)
                      });
                    }} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm">
                      <option value="">Select a program type...</option>
                      <option value="State SO">State SO</option>
                      <option value="Federal SO">Federal SO</option>
                      <option value="BIP">BIP</option>
                      <option value="Voluntary SO">Voluntary SO</option>
                      <option value="Poly Only">Poly Only</option>
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
                      {/* New BIP clients always start at week 0; attendance counts it up */}
                      <input type="number" value={newClient.phase} disabled className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm opacity-60 cursor-not-allowed" />
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
                  <button type="button" onClick={() => { setShowNewClientForm(false); setNewClient(getEmptyNewClient()); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Cancel</button>
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
                      <td
                        className={`p-3 text-xs ${isAttendanceOverdue(c) ? 'text-red-400 font-semibold' : 'text-slate-400'}`}
                        title={isAttendanceOverdue(c) ? `Overdue: more than ${SO_ATTENDANCE_LIMIT_MONTHS[c.phase]} month${SO_ATTENDANCE_LIMIT_MONTHS[c.phase] === 1 ? '' : 's'} since last attended for ${c.phase}` : undefined}
                      >
                        {c.lastattended ? new Date(c.lastattended).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="p-3 text-slate-400 text-xs">{c.lastpoly ? new Date(c.lastpoly).toLocaleDateString() : 'None'}</td>
                      <td className="p-3"><span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${c.programstatus === 'Active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`} title={c.programstatus}>{c.programstatus === 'Discharged Supervision' ? 'Discharged' : c.programstatus}</span></td>
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
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex justify-end z-50">
            <div className="bg-slate-900 w-full max-w-6xl h-full border-l border-slate-800 flex flex-col shadow-2xl p-6 overflow-y-auto">
              <div className="flex justify-between items-start border-b border-slate-800 pb-4 mb-6">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-bold text-white">{selectedClientDetail.firstname} {selectedClientDetail.lastname}</h2>
                    <span
                      title="Account balance"
                      className={`text-sm font-semibold px-2.5 py-0.5 rounded-full border ${toDisplayBalance(selectedClientDetail.accountbalance) < 0 ? 'text-red-400 bg-red-500/10 border-red-500/30' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'}`}
                    >
                      {formatBalance(selectedClientDetail.accountbalance)} Balance
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">DOC #: <span className="text-slate-200 font-mono">{selectedClientDetail.docnumber}</span> | Program: <span className="text-blue-400 font-semibold">{selectedClientDetail.programtype || 'State SO'}</span> | Agent: {selectedClientDetail.supervisingagent}</p>
                </div>
                <div className="flex gap-2">
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
                      onClick={() => openStatusDialog('activate')}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                    >
                      <RotateCcw size={14} /> Activate
                    </button>
                  ) : role === 'Business Administrator' && (
                    <button
                      type="button"
                      onClick={() => openStatusDialog('discharge')}
                      className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                    >
                      <LogOut size={14} /> Discharge
                    </button>
                  )}
                  {role === 'Business Administrator' && (
                    <button
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
                  <button onClick={() => setSelectedClientDetail(null)} className="text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800"><X size={20} /></button>
                </div>
              </div>

              {statusDialog && (statusDialog === 'activate' || role === 'Business Administrator') && (() => {
                const activating = statusDialog === 'activate';
                const label = activating ? 'Activation' : 'Discharge';
                const choices = activating ? EDITABLE_PROGRAM_STATUSES : DISCHARGE_STATUSES;
                const actionButton = activating ? 'bg-blue-600 hover:bg-blue-500' : 'bg-amber-600 hover:bg-amber-500';
                const subcategories = activating ? undefined : DISCHARGE_SUBCATEGORIES[statusDialogChoice];
                const choiceLabel = statusDialogSubcategory ? `${statusDialogChoice} (${statusDialogSubcategory})` : statusDialogChoice;
                return (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="status-dialog-title">
                  <div className={`bg-slate-900 border rounded-xl p-6 w-full max-w-md space-y-4 text-sm ${activating ? 'border-blue-500/40' : 'border-amber-500/40'}`}>
                    <div>
                      <h3 id="status-dialog-title" className="font-semibold text-white">{activating ? 'Activate Client' : 'Discharge Client'}</h3>
                      <p className="text-xs text-slate-400 mt-1">
                        <span className="text-emerald-400 font-semibold">{selectedClientDetail.firstname} {selectedClientDetail.lastname}</span> · Current status: {selectedClientDetail.programstatus || 'None'}
                      </p>
                    </div>
                    {!statusDialogConfirming ? (
                      <>
                        <div>
                          <p className="block text-xs text-slate-400 uppercase mb-2">{activating ? 'New Status' : 'Discharge Type'}</p>
                          <div className="grid grid-cols-2 gap-2">
                            {choices.map(s => (
                              <label key={s} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs ${statusDialogChoice === s ? (activating ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-amber-500 bg-amber-500/10 text-white') : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
                                <input type="radio" name="status-dialog-choice" value={s} checked={statusDialogChoice === s} onChange={() => { setStatusDialogChoice(s); setStatusDialogSubcategory(''); }} className={activating ? 'accent-blue-500' : 'accent-amber-500'} />
                                {s}
                              </label>
                            ))}
                          </div>
                        </div>
                        {subcategories && (
                          <div>
                            <p className="block text-xs text-slate-400 uppercase mb-2">{statusDialogChoice} Subcategory</p>
                            <div className="grid grid-cols-2 gap-2">
                              {subcategories.map(s => (
                                <label key={s} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs ${statusDialogSubcategory === s ? 'border-amber-500 bg-amber-500/10 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
                                  <input type="radio" name="status-dialog-subcategory" value={s} checked={statusDialogSubcategory === s} onChange={() => setStatusDialogSubcategory(s)} className="accent-amber-500" />
                                  {s}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <label htmlFor="status-dialog-note" className="block text-xs text-slate-400 uppercase mb-1">{label} Note</label>
                          <textarea
                            id="status-dialog-note"
                            rows={4}
                            value={statusDialogNote}
                            onChange={e => setStatusDialogNote(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                          />
                        </div>
                        {offerReinstate && (
                          <div className="border-t border-slate-800 pt-4">
                            <p className="block text-xs text-slate-400 uppercase mb-2">BIP Reinstate Assessment</p>
                            <BipAssessmentPicker
                              mode="reinstate"
                              clientId={selectedClientDetail.clientid}
                              employees={employees}
                              groupCounselor={counselorOfGroup(selectedClientDetail.groupid)}
                              value={reinstateChoice}
                              onChange={setReinstateChoice}
                            />
                          </div>
                        )}
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setStatusDialog(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Cancel</button>
                          <button
                            type="button"
                            disabled={!statusDialogChoice || (!!subcategories && !statusDialogSubcategory) || !statusDialogNote.trim() || (offerReinstate && !!bipChoiceProblem(reinstateChoice))}
                            onClick={() => setStatusDialogConfirming(true)}
                            className={`${actionButton} disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-semibold`}
                          >
                            Proceed
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className={`text-xs rounded-lg p-3 border ${activating ? 'text-blue-300 bg-blue-500/10 border-blue-500/30' : 'text-amber-300 bg-amber-500/10 border-amber-500/30'}`}>
                          The program status will change from <span className="font-semibold">{selectedClientDetail.programstatus || 'None'}</span> to <span className="font-semibold">{choiceLabel}</span>, and this note will be added to the case notes.{!activating && ' A discharge summary PDF will be saved to the client\'s attachments.'}
                          {offerReinstate && reinstateChoice.choice !== 'none' && <> A <span className="font-semibold">{reinstateChoice.name}</span> assessment will be opened with {reinstateChoice.provider}.</>}
                        </p>
                        <p className="text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-3 whitespace-pre-wrap">{label} - {choiceLabel}: {statusDialogNote.trim()}</p>
                        {statusDialogError && (
                          <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{statusDialogError}</p>
                        )}
                        <div className="flex justify-end gap-2">
                          <button type="button" disabled={statusDialogSaving} onClick={() => { setStatusDialogError(''); setStatusDialogConfirming(false); }} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Back</button>
                          <button
                            type="button"
                            disabled={statusDialogSaving}
                            onClick={handleStatusDialogConfirm}
                            className={`${actionButton} disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-semibold`}
                          >
                            {statusDialogSaving ? 'Saving...' : activating ? 'Confirm Activation' : 'Confirm Discharge'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                );
              })()}

              {(() => {
                if (clientPolygraphsFor !== selectedClientDetail.clientid) return null;
                // Booked into a polygraph: the notice shows the appointment and how long since the last one, instead of the red warning
                const slot = assignedSlotFor(selectedClientDetail.clientid);
                if (slot) {
                  const start = slotStart(slot);
                  const upcoming = !start || start.getTime() > Date.now();
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
                        <button type="button" onClick={() => openPolySlot(slot.slotid)} className="shrink-0 text-xs font-semibold underline hover:text-white">View Slot</button>
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

              {/* Labels stay on one line; the row scrolls sideways when the drawer is too narrow for every tab.
                  shrink-0 keeps the drawer's column layout from squeezing the scrolling row down to nothing. */}
              <div className="flex shrink-0 border-b border-slate-800 gap-4 mb-6 overflow-x-auto overflow-y-hidden [scrollbar-width:thin] [scrollbar-color:#334155_transparent]">
                <button onClick={() => setClientTab('information')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase whitespace-nowrap shrink-0 ${clientTab === 'information' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><Users size={14} /> Information</button>
                <button onClick={() => setClientTab('progress')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase whitespace-nowrap shrink-0 ${clientTab === 'progress' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><ClipboardList size={14} /> Progress</button>
                <button onClick={() => setClientTab('attendance')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase whitespace-nowrap shrink-0 ${clientTab === 'attendance' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><Calendar size={14} /> Attendance</button>
                <button onClick={() => setClientTab('financials')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase whitespace-nowrap shrink-0 ${clientTab === 'financials' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><DollarSign size={14} /> Financial Ledger</button>
                <button onClick={() => setClientTab('notes')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase whitespace-nowrap shrink-0 ${clientTab === 'notes' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><FileText size={14} /> Case Notes</button>
                {selectedClientDetail.programtype !== 'BIP' && (
                  <button onClick={() => setClientTab('polygraphs')} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase whitespace-nowrap shrink-0 ${clientTab === 'polygraphs' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><Activity size={14} /> Polygraphs</button>
                )}
                <button onClick={openAttachments} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase whitespace-nowrap shrink-0 ${clientTab === 'attachments' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><Paperclip size={14} /> Attachments</button>
                {role === 'Business Administrator' && (
                  <button onClick={openChangeLog} className={`flex items-center gap-2 pb-3 border-b-2 text-xs font-semibold uppercase whitespace-nowrap shrink-0 ${clientTab === 'changelog' ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-400'}`}><History size={14} /> Change Log</button>
                )}
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
                              const res = await updateClient(selectedClientDetail.clientid, { ...clientInfoForm, updatedBy: user.employeeemail });
                              // Prefer the row the server returned (includes joined group name); fall back to the form values
                              const saved = { ...selectedClientDetail, ...clientInfoForm, ...(res.client ?? {}) };
                              setSelectedClientDetail(saved);
                              setClients(prev => prev.map(c => c.clientid === saved.clientid ? { ...c, ...saved } : c));
                              setEditingClientInfo(false);
                              if (saved.programtype === 'BIP' && selectedClientDetail.programtype !== 'BIP') {
                                setBipIntakePrompt({ clientid: saved.clientid, name: `${saved.lastname}, ${saved.firstname}`, groupCounselor: counselorOfGroup(saved.groupid) });
                              }
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
                        { label: 'Date of Birth', field: 'dateofbirth' },
                        { label: 'Sex', field: 'sex' },
                        { label: 'Race', field: 'race' },
                        { label: 'Supervising Agent', field: 'supervisingagent' },
                        { label: 'Program Status', field: 'programstatus' },
                        { label: 'Program Start Date', field: 'programstartdate' },
                        { label: 'Last Date Attended', field: 'lastdateattended' },
                      ].map(({ label, field }) => (
                        <div key={field}>
                          <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                          {editingClientInfo && field === 'programstatus' && clientIsDischarged ? (
                            // Locked while discharged; the Activate button is the only way out
                            <div>
                              <p className="w-full bg-slate-900/50 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-400 text-sm cursor-not-allowed">{selectedClientDetail.programstatus}</p>
                              <p className="text-xs text-slate-500 mt-1">Locked while discharged. Use Activate to change it.</p>
                            </div>
                          ) : editingClientInfo && field === 'programstatus' ? (
                            <select
                              value={clientInfoForm.programstatus || ''}
                              onChange={e => setClientInfoForm((f: any) => ({ ...f, programstatus: e.target.value }))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            >
                              <option value="">-- Select status --</option>
                              {EDITABLE_PROGRAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : editingClientInfo && CLIENT_FIELD_OPTIONS[field] ? (
                            <select
                              value={clientInfoForm[field] || ''}
                              onChange={e => setClientInfoForm((f: any) => ({ ...f, [field]: e.target.value }))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            >
                              <option value="">-- Select {label.toLowerCase()} --</option>
                              {CLIENT_FIELD_OPTIONS[field].map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : editingClientInfo && field === 'supervisingagent' ? (
                            <AgentPicker
                              value={clientInfoForm.supervisingagent || ''}
                              onChange={v => setClientInfoForm((f: any) => ({ ...f, supervisingagent: v }))}
                              agents={directoryAgents}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            />
                          ) : editingClientInfo ? (
                            <div className="flex items-center gap-3">
                              <input
                                type={field.includes('date') || field.includes('Date') ? 'date' : 'text'}
                                value={clientInfoForm[field] ? (field.includes('date') || field.includes('Date') ? String(clientInfoForm[field]).split('T')[0] : clientInfoForm[field]) : ''}
                                max={field === 'dateofbirth' ? todayLocal() : undefined}
                                onChange={e => setClientInfoForm((f: any) => ({ ...f, [field]: e.target.value }))}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                              />
                              {field === 'dateofbirth' && ageFromBirthDate(clientInfoForm.dateofbirth) !== null && (
                                <span className="text-xs text-slate-400 whitespace-nowrap">Age {ageFromBirthDate(clientInfoForm.dateofbirth)}</span>
                              )}
                            </div>
                          ) : (
                            <p
                              className={field === 'lastdateattended' && isAttendanceOverdue(selectedClientDetail) ? 'text-red-400 font-semibold' : 'text-white font-medium'}
                              title={field === 'lastdateattended' && isAttendanceOverdue(selectedClientDetail)
                                ? `Overdue: more than ${SO_ATTENDANCE_LIMIT_MONTHS[selectedClientDetail.phase]} month${SO_ATTENDANCE_LIMIT_MONTHS[selectedClientDetail.phase] === 1 ? '' : 's'} since last attended for ${selectedClientDetail.phase}`
                                : undefined}
                            >
                              {field === 'dateofbirth'
                                ? (selectedClientDetail.dateofbirth
                                    ? <>{toLocalDay(selectedClientDetail.dateofbirth).toLocaleDateString()} <span className="text-slate-400 font-normal">(Age {ageFromBirthDate(selectedClientDetail.dateofbirth)})</span></>
                                    : '—')
                                : field.includes('date') || field.includes('Date')
                                ? (selectedClientDetail[field] ? new Date(selectedClientDetail[field]).toLocaleDateString() : '—')
                                : (selectedClientDetail[field] || '—')}
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
                              setClientInfoForm((f: any) => {
                                // Switching programs resets the phase/week to one that fits the new program
                                const phase = SO_PROGRAM_TYPES.includes(programType) && !SO_PHASES.includes(f.phase) ? 'Phase 1 - Weekly'
                                  : programType === 'BIP' && !isWholeNumber(f.phase) ? '0'
                                  : f.phase;
                                // BIP is $35; Federal SO has no treatment fee; State and Voluntary SO take the fee for the phase
                                const treatmentfee = programType === 'BIP' ? 35
                                  : programType === 'Federal SO' ? 0
                                  : STATE_FEE_PROGRAM_TYPES.includes(programType) && SO_TREATMENT_FEES[phase] !== undefined ? SO_TREATMENT_FEES[phase]
                                  : f.treatmentfee;
                                return { ...f, programtype: programType, phase, treatmentfee };
                              });
                            }}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                          >
                            <option value="">-- Select --</option>
                            <option value="State SO">State SO</option>
                            <option value="Federal SO">Federal SO</option>
                            <option value="BIP">BIP</option>
                            <option value="Voluntary SO">Voluntary SO</option>
                            <option value="Poly Only">Poly Only</option>
                          </select>
                        ) : (
                          <p className="text-white font-medium">{selectedClientDetail.programtype || '—'}</p>
                        )}
                      </div>
                      {/* SO programs pick a phase (which sets the treatment fee); BIP clients store a whole-number week */}
                      <div>
                        <p className="text-xs text-slate-500 mb-0.5">{(editingClientInfo ? clientInfoForm.programtype : selectedClientDetail.programtype) === 'BIP' ? 'Week' : 'Phase'}</p>
                        {editingClientInfo && SO_PROGRAM_TYPES.includes(clientInfoForm.programtype || '') ? (
                          <select
                            value={clientInfoForm.phase || ''}
                            onChange={e => {
                              const phase = e.target.value;
                              setClientInfoForm((f: any) => ({
                                ...f,
                                phase,
                                // Federal SO has no treatment fee, so its phase doesn't set one
                                ...(STATE_FEE_PROGRAM_TYPES.includes(f.programtype) && SO_TREATMENT_FEES[phase] !== undefined ? { treatmentfee: SO_TREATMENT_FEES[phase] } : {}),
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
                        ) : editingClientInfo && clientInfoForm.programtype === 'BIP' ? (
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
                            type="text"
                            value={clientInfoForm.phase || ''}
                            onChange={e => setClientInfoForm((f: any) => ({ ...f, phase: e.target.value }))}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                          />
                        ) : (
                          <p className="text-white font-medium">{formatPhase(selectedClientDetail.programtype, selectedClientDetail.phase) || '—'}</p>
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
                        { label: 'Poly Fee Voucher', field: 'polyfeevoucher', prefix: '', step: '1', min: 0, max: POLY_VOUCHER_MAX },
                      ].map(({ label, field, prefix, step = '0.01', min, max }) => (
                        <div key={field}>
                          <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                          {editingClientInfo ? (
                            <input
                              type="number"
                              step={step}
                              min={min}
                              max={max}
                              value={field === 'accountbalance' && clientInfoForm[field] !== '' && clientInfoForm[field] != null ? toDisplayBalance(clientInfoForm[field]) : (clientInfoForm[field] ?? '')}
                              onChange={e => setClientInfoForm((f: any) => ({ ...f, [field]: field === 'accountbalance' && e.target.value !== '' ? toDisplayBalance(e.target.value) : e.target.value }))}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                            />
                          ) : field === 'accountbalance' ? (
                            <p className={`font-medium ${toDisplayBalance(selectedClientDetail[field]) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(selectedClientDetail[field])}</p>
                          ) : field === 'polyfeevoucher' ? (
                            <p className="font-medium text-white">{Number(selectedClientDetail[field] ?? 0)}/{POLY_VOUCHER_MAX}</p>
                          ) : (
                            <p className="font-medium text-white">
                              {prefix}{selectedClientDetail[field] != null ? Number(selectedClientDetail[field]).toFixed(2) : '—'}
                            </p>
                          )}
                        </div>
                      ))}
                      {/* Poly fee progress: amount paid so far out of the total poly fee */}
                      <div>
                        <p className="text-xs text-slate-500 mb-0.5">Poly Fee (Paid / Total)</p>
                        {editingClientInfo ? (
                          <div className="flex items-center gap-2">
                            {(['polyfeepaid', 'polyfee'] as const).map((field, i) => (
                              <Fragment key={field}>
                                {i === 1 && <span className="text-slate-500">/</span>}
                                <input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  aria-label={field === 'polyfeepaid' ? 'Poly fee paid' : 'Poly fee total'}
                                  value={clientInfoForm[field] ?? ''}
                                  onChange={e => setClientInfoForm((f: any) => ({ ...f, [field]: e.target.value }))}
                                  // The total belongs to an active poly fee override; change it there
                                  disabled={field === 'polyfee' && !!clientPolyOverride}
                                  title={field === 'polyfee' && clientPolyOverride ? 'Set by the Temporary Poly Fee Override' : undefined}
                                  className="w-full min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm disabled:opacity-50"
                                />
                              </Fragment>
                            ))}
                          </div>
                        ) : (() => {
                          const paid = Number(selectedClientDetail.polyfeepaid ?? 0);
                          const total = Number(selectedClientDetail.polyfee ?? 250);
                          const status = paid >= total ? { text: 'Paid in full', color: 'text-emerald-400' }
                            : paid > 0 ? { text: `$${(total - paid).toFixed(2)} remaining`, color: 'text-amber-400' }
                            : { text: 'Not paid', color: 'text-slate-500' };
                          return (
                            <p className="font-medium text-white">
                              ${paid.toFixed(2)} / ${total.toFixed(2)}
                              <span className={`ml-2 text-xs font-normal ${status.color}`}>{status.text}</span>
                            </p>
                          );
                        })()}
                      </div>
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

                  {/* Section 5 – Temporary Poly Fee Override: a reduced poly fee for a number of fills, not a date */}
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-xs font-bold uppercase text-blue-400 tracking-wider">Temporary Poly Fee Override</h3>
                      {role === 'Business Administrator' && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowPolyOverrideForm(!showPolyOverrideForm);
                            setPolyOverrideError('');
                            setPolyOverrideFee(clientPolyOverride ? Number(clientPolyOverride.reducedfee).toFixed(2) : '');
                            setPolyOverrideFills(clientPolyOverride ? String(clientPolyOverride.fillsallowed) : '1');
                          }}
                          className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                        >
                          {showPolyOverrideForm ? 'Cancel' : clientPolyOverride ? 'Change Poly Fee Override' : 'Set Poly Fee Override'}
                        </button>
                      )}
                    </div>

                    {clientPolyOverride ? (
                      <div className="bg-slate-900 border border-emerald-500/30 rounded-lg p-4 mb-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Reduced Poly Fee</p>
                            <p className="text-white font-semibold text-lg">${Number(clientPolyOverride.reducedfee).toFixed(2)}</p>
                            <p className="text-xs text-slate-500 mt-0.5">Regular poly fee: ${Number(clientPolyOverride.regularfee).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500 mb-1">Fills Used</p>
                            <p className="text-white font-semibold text-lg">{clientPolyOverride.fillsused} of {clientPolyOverride.fillsallowed}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {Number(clientPolyOverride.fillsused) >= Number(clientPolyOverride.fillsallowed)
                                ? 'Last fill granted; the regular fee returns when its vouchers are used to schedule a polygraph.'
                                : `${Number(clientPolyOverride.fillsallowed) - Number(clientPolyOverride.fillsused)} more fill(s) at the reduced fee.`}
                            </p>
                          </div>
                        </div>
                        {role === 'Business Administrator' && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={async () => {
                              const clientid = selectedClientDetail.clientid;
                              setLoading(true);
                              setPolyOverrideError('');
                              try {
                                const res = await deletePolyFeeOverride(clientid, user.employeeemail);
                                applyPolyOverrideResult(clientid, res);
                                setClientPolyOverride(null);
                                setShowPolyOverrideForm(false);
                                setSuccessMsg(`Poly fee override removed. Poly fee is back to $${Number(res.polyFee).toFixed(2)}.`
                                  + (res.vouchersRemoved ? ` ${res.vouchersRemoved} poly fee voucher(s) removed because the poly fee is no longer paid in full.` : ''));
                              } catch (err: any) {
                                setPolyOverrideError(err.message || 'Failed to remove the poly fee override.');
                              } finally {
                                setLoading(false);
                              }
                            }}
                            className="mt-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-lg text-xs font-semibold w-full disabled:opacity-50"
                          >
                            Remove Override
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">No poly fee override is active. Regular poly fee applies: ${Number(selectedClientDetail.polyfee ?? 250).toFixed(2)}</p>
                    )}

                    {polyOverrideError && <p className="text-xs text-red-400 mt-2">{polyOverrideError}</p>}

                    {showPolyOverrideForm && role === 'Business Administrator' && (
                      <form onSubmit={async (e) => {
                        e.preventDefault();
                        const fee = Number(polyOverrideFee);
                        const fills = Number(polyOverrideFills);
                        if (polyOverrideFee === '' || !(fee >= 0) || !Number.isInteger(fills) || fills < 1) {
                          setPolyOverrideError('Enter a reduced poly fee and how many fills it applies to.');
                          return;
                        }
                        const clientid = selectedClientDetail.clientid;
                        setLoading(true);
                        setPolyOverrideError('');
                        try {
                          const res = await savePolyFeeOverride(clientid, { reducedFee: fee, fills, user: user.employeeemail });
                          applyPolyOverrideResult(clientid, res);
                          setClientPolyOverride(res.override ?? null);
                          setShowPolyOverrideForm(false);
                          setSuccessMsg(`Poly fee set to $${fee.toFixed(2)} for ${fills} fill${fills === 1 ? '' : 's'}.`
                            + (res.vouchersAdded ? ' What the client has already paid covers it, so the poly fee vouchers were filled.' : '')
                            + (res.vouchersRemoved ? ` ${res.vouchersRemoved} poly fee voucher(s) removed because the poly fee is no longer paid in full.` : ''));
                        } catch (err: any) {
                          setPolyOverrideError(err.message || 'Failed to save the poly fee override.');
                        } finally {
                          setLoading(false);
                        }
                      }} className="space-y-3 border-t border-slate-800 pt-4 mt-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Reduced Poly Fee *</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={polyOverrideFee}
                              onChange={(e) => setPolyOverrideFee(e.target.value)}
                              placeholder="e.g., 150.00"
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                              required
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">Number of Fills *</label>
                            <input
                              type="number"
                              step="1"
                              min={Math.max(1, Number(clientPolyOverride?.fillsused ?? 0))}
                              max={20}
                              value={polyOverrideFills}
                              onChange={(e) => setPolyOverrideFills(e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-sm"
                              required
                            />
                          </div>
                        </div>
                        <p className="text-xs text-slate-500">
                          A fill is the poly fee being paid in full, which fills the {POLY_VOUCHER_MAX} poly fee vouchers. The reduced fee applies until the last fill's vouchers
                          are used to schedule a polygraph; then the regular fee (${Number(clientPolyOverride?.regularfee ?? selectedClientDetail.polyfee ?? 250).toFixed(2)}) returns.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setShowPolyOverrideForm(false); setPolyOverrideError(''); }}
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

                <div className="space-y-3">
                  {(() => {
                    // Filters set but hidden are counted on the button so they aren't forgotten
                    const activeAttendanceFilters = [attendanceFilters.search.trim(), attendanceFilters.group, attendanceFilters.type, attendanceFilters.payment, attendanceFilters.from, attendanceFilters.to].filter(Boolean).length;
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowAttendanceFilters(show => !show)}
                          aria-expanded={showAttendanceFilters}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showAttendanceFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
                        >
                          <SlidersHorizontal size={13} /> Filters
                          {activeAttendanceFilters > 0 && (
                            <span className="bg-blue-600 text-white rounded-full px-1.5 text-[10px] leading-4">{activeAttendanceFilters}</span>
                          )}
                        </button>
                        <span className="ml-auto text-xs text-slate-500">
                          {shownAttendance.length === clientAttendance.length ? `${clientAttendance.length} sessions` : `Showing ${shownAttendance.length} of ${clientAttendance.length}`}
                        </span>
                      </div>
                    );
                  })()}
                  {showAttendanceFilters && (
                    <RecordFilterBar
                      search={attendanceFilters.search}
                      onSearch={v => setAttendanceFilters(f => ({ ...f, search: v }))}
                      searchPlaceholder="Group, type, or comments..."
                      selects={[
                        { label: 'Group', value: attendanceFilters.group, onChange: v => setAttendanceFilters(f => ({ ...f, group: v })), allLabel: 'All Groups', options: sortedUnique(clientAttendance.map(a => a.groupname || 'Group Session')) },
                        { label: 'Type', value: attendanceFilters.type, onChange: v => setAttendanceFilters(f => ({ ...f, type: v })), allLabel: 'All Types', options: sortedUnique(clientAttendance.map(a => a.type)) },
                        { label: 'Payment', value: attendanceFilters.payment, onChange: v => setAttendanceFilters(f => ({ ...f, payment: v })), allLabel: 'All', options: ['Paid', 'No Payment'] },
                      ]}
                      from={attendanceFilters.from}
                      to={attendanceFilters.to}
                      onFrom={v => setAttendanceFilters(f => ({ ...f, from: v }))}
                      onTo={v => setAttendanceFilters(f => ({ ...f, to: v }))}
                      sort={attendanceFilters.sort}
                      onSort={v => setAttendanceFilters(f => ({ ...f, sort: v }))}
                      sortOptions={[
                        { value: 'newest', label: 'Newest First' },
                        { value: 'oldest', label: 'Oldest First' },
                      ]}
                      shown={shownAttendance.length}
                      total={clientAttendance.length}
                      onClear={() => setAttendanceFilters(f => ({ ...EMPTY_ATTENDANCE_FILTERS, sort: f.sort }))}
                    />
                  )}
                  {shownAttendance.length === 0 && clientAttendance.length > 0 && (
                    <p className="text-center text-slate-500 text-sm py-4">No attendance matches these filters.</p>
                  )}
                  {groupByMonth(shownAttendance, attendanceFilters.sort).map(month => {
                      const totals = month.rows.reduce((t, att) => {
                        const c = attendanceBalanceChange(att);
                        return { fee: t.fee + c.fee, paid: t.paid + c.paid, change: t.change + (c.after - c.before) };
                      }, { fee: 0, paid: 0, change: 0 });
                      const change = Math.round(totals.change * 100) / 100;
                      const collapsed = collapsedAttendanceMonths.has(month.key);
                      return (
                  <div key={month.key} className="space-y-2">
                    <MonthHeader label={month.label} count={month.rows.length} noun="session" collapsed={collapsed} onToggle={() => setCollapsedAttendanceMonths(prev => toggleInSet(prev, month.key))}>
                      <span className="text-slate-500">Fees <span className="text-red-400 font-semibold">{signedMoney(totals.fee)}</span></span>
                      <span className="text-slate-500">Paid <span className="text-emerald-400 font-semibold">{signedMoney(totals.paid)}</span></span>
                      <span className="text-slate-500">Change <span className={`font-semibold ${change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-slate-400'}`}>{change > 0 ? '+' : ''}{signedMoney(change)}</span></span>
                    </MonthHeader>
                  {!collapsed && month.rows.map(att => (
                  // One compact row per session: date, group, then fee, paid, and the balance before → after
                  (() => { const c = attendanceBalanceChange(att); return (
                  <div key={att.attendanceid} className="bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-xl text-sm flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="shrink-0 w-16 border-r border-slate-800 pr-4">
                      <p className="font-bold text-white leading-tight">{formatLogMonthDay(att.date)}</p>
                      <p className="text-[11px] text-slate-500">{formatLogYear(att.date)}</p>
                    </div>
                    <div className="flex-1 min-w-[10rem]">
                      <p className="font-semibold text-white truncate">
                        {att.groupname || 'Group Session'}
                        {att.groupschedule && <span className="ml-2 text-xs font-normal text-slate-400">{att.groupschedule}</span>}
                      </p>
                      {att.comments && <p className="text-xs text-slate-400 truncate" title={att.comments}>{att.comments}</p>}
                    </div>
                    <div className="shrink-0 flex gap-5 text-xs text-right">
                      <div>
                        <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Fee</p>
                        <p className="text-red-400 font-semibold">{signedMoney(c.fee)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Paid</p>
                        <p className="text-emerald-400 font-semibold">{signedMoney(c.paid)}</p>
                      </div>
                      {(() => { const change = Math.round((c.after - c.before) * 100) / 100; return (
                        <div>
                          <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Change</p>
                          <p className={`font-semibold ${change > 0 ? 'text-emerald-400' : change < 0 ? 'text-red-400' : 'text-slate-400'}`}>{change > 0 ? '+' : ''}{signedMoney(change)}</p>
                        </div>
                      ); })()}
                      <div>
                        <p className="text-slate-500 uppercase tracking-wide text-[10px] font-semibold">Balance</p>
                        <p className="whitespace-nowrap">
                          <span className="text-slate-400">{signedMoney(c.before)} → </span>
                          <span className={`font-semibold ${c.after < 0 ? 'text-red-400' : 'text-white'}`}>{signedMoney(c.after)}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                  ); })()
                  ))}
                  </div>
                      );
                  })}
                </div>
              )}

              {clientTab === 'financials' && (
                <div className="space-y-3">
                  {scheduledPolyNotice && (
                    <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3 text-sm text-amber-300 flex items-start justify-between gap-3">
                      <p><AlertCircle size={15} className="inline mr-1.5 -mt-0.5" />{scheduledPolyNotice.text}</p>
                      <div className="shrink-0 flex items-center gap-3">
                        {isAllowed('polygraph') && (
                          <button type="button" onClick={() => openPolySlot(scheduledPolyNotice.slotId)} className="text-xs font-semibold underline hover:text-white">View Slot</button>
                        )}
                        <button type="button" onClick={() => setScheduledPolyNotice(null)} aria-label="Dismiss" className="hover:text-white"><X size={15} /></button>
                      </div>
                    </div>
                  )}
                  {(() => {
                    // Filters set but hidden are counted on the button so they aren't forgotten
                    const activeLedgerFilters = [ledgerFilters.search.trim(), ledgerFilters.type, ledgerFilters.feeType, ledgerFilters.method, ledgerFilters.from, ledgerFilters.to].filter(Boolean).length;
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowLedgerFilters(show => !show)}
                          aria-expanded={showLedgerFilters}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showLedgerFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
                        >
                          <SlidersHorizontal size={13} /> Filters
                          {activeLedgerFilters > 0 && (
                            <span className="bg-blue-600 text-white rounded-full px-1.5 text-[10px] leading-4">{activeLedgerFilters}</span>
                          )}
                        </button>
                        <span className="ml-auto text-xs text-slate-500">
                          {shownLedger.length === clientFinancials.length ? `${clientFinancials.length} entries` : `Showing ${shownLedger.length} of ${clientFinancials.length}`}
                        </span>
                      </div>
                    );
                  })()}
                  {showLedgerFilters && <RecordFilterBar
                    search={ledgerFilters.search}
                    onSearch={v => setLedgerFilters(f => ({ ...f, search: v }))}
                    searchPlaceholder="Comments, fee type, amount..."
                    selects={[
                      { label: 'Type', value: ledgerFilters.type, onChange: v => setLedgerFilters(f => ({ ...f, type: v })), allLabel: 'All Types', options: sortedUnique(clientFinancials.map(f => f.type)) },
                      { label: 'Fee Type', value: ledgerFilters.feeType, onChange: v => setLedgerFilters(f => ({ ...f, feeType: v })), allLabel: 'All Fee Types', options: sortedUnique(clientFinancials.map(f => f.feetype)) },
                      { label: 'Method', value: ledgerFilters.method, onChange: v => setLedgerFilters(f => ({ ...f, method: v })), allLabel: 'All Methods', options: sortedUnique(clientFinancials.map(f => f.paymentmethod)) },
                    ]}
                    from={ledgerFilters.from}
                    to={ledgerFilters.to}
                    onFrom={v => setLedgerFilters(f => ({ ...f, from: v }))}
                    onTo={v => setLedgerFilters(f => ({ ...f, to: v }))}
                    sort={ledgerFilters.sort}
                    onSort={v => setLedgerFilters(f => ({ ...f, sort: v }))}
                    sortOptions={[
                      { value: 'newest', label: 'Newest First' },
                      { value: 'oldest', label: 'Oldest First' },
                      { value: 'amount-high', label: 'Amount: High to Low' },
                      { value: 'amount-low', label: 'Amount: Low to High' },
                    ]}
                    shown={shownLedger.length}
                    total={clientFinancials.length}
                    onClear={() => setLedgerFilters(f => ({ ...EMPTY_LEDGER_FILTERS, sort: f.sort }))}
                  />}
                  {shownLedger.length === 0 && clientFinancials.length > 0 && (
                    <p className="text-center text-slate-500 text-sm py-4">No ledger entries match these filters.</p>
                  )}
                  {groupByMonth(shownLedger, ledgerFilters.sort).map(month => {
                    const charges = month.rows.filter(f => f.type === 'Charge').reduce((t, f) => t + Number(f.amount || 0), 0);
                    // Net of refunds and disputes
                    const payments = month.rows.filter(f => f.type !== 'Charge')
                      .reduce((t, f) => t + (PAYMENT_REVERSAL_TYPES.includes(f.type) ? -1 : 1) * Number(f.amount || 0), 0);
                    const collapsed = collapsedLedgerMonths.has(month.key);
                    return (
                  <div key={month.key} className="space-y-2">
                    <MonthHeader label={month.label} count={month.rows.length} noun="entry" collapsed={collapsed} onToggle={() => setCollapsedLedgerMonths(prev => toggleInSet(prev, month.key))}>
                      <span className="text-slate-500">Fees <span className={`font-semibold ${charges > 0 ? 'text-red-400' : 'text-slate-400'}`}>{charges > 0 ? '-' : ''}{signedMoney(charges)}</span></span>
                      <span className="text-slate-500">Payments <span className={`font-semibold ${payments > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>{payments > 0 ? '+' : ''}{signedMoney(payments)}</span></span>
                    </MonthHeader>
                  {!collapsed && month.rows.map(fin => {
                    // Charges (fees) are red and refunds/disputes amber, both adding to what's owed; payments are green and take away from it
                    const charge = fin.type === 'Charge';
                    const reversal = PAYMENT_REVERSAL_TYPES.includes(fin.type);
                    const minus = charge || reversal;
                    const tone = charge ? LEDGER_TONES.charge : reversal ? LEDGER_TONES.reversal : LEDGER_TONES.payment;
                    const badge = charge ? 'Fee' : fin.type === 'Payment' ? 'Payment' : fin.type;
                    const isPoly = fin.feetype === 'Poly Fee';
                    const isAdmin = role === 'Business Administrator';
                    // Payments saved before the method was recorded were all cash
                    const canAdjust = isAdmin && fin.type === 'Payment' && (!fin.paymentmethod || fin.paymentmethod === 'Cash');
                    const card = fin.type === 'Payment' && fin.paymentmethod === 'Credit Card' ? cardPaymentStatus(fin, clientFinancials) : null;
                    const disputeOpen = fin.disputestatus === 'Open';
                    const action = paymentAction?.id === fin.transactionid ? paymentAction : null;
                    const startAction = (kind: 'adjust' | CardPaymentAction, amount: number) => {
                      setPaymentAction({ id: fin.transactionid, kind, amount: amount > 0 ? amount.toFixed(2) : '', reason: '' });
                      setPaymentActionError('');
                    };
                    const linkClass = 'inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white';
                    return (<div key={fin.transactionid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm"><div className="flex justify-between items-center"><div><p className="font-semibold text-white">
                      {fin.feetype || fin.type}
                      <span className={`ml-2 align-middle text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${tone.badge}`}>{badge}</span>
                      {!charge && fin.paymentmethod && (
                        <span className="ml-2 align-middle text-[10px] uppercase tracking-wide bg-slate-800 text-slate-300 px-2 py-0.5 rounded">{fin.paymentmethod}</span>
                      )}
                      {fin.disputestatus && (
                        <span className={`ml-2 align-middle text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${disputeOpen ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' : fin.disputestatus === 'Won' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-red-400 bg-red-500/10 border-red-500/30'}`}>Dispute {fin.disputestatus}</span>
                      )}
                    </p><p className="text-xs text-slate-400">{new Date(fin.date).toLocaleString()} — {fin.comments}</p>
                    {fin.adjustedon && (
                      <p className="text-xs text-amber-400 mt-1">
                        Adjusted from {formatMoney(Number(fin.originalamount))} by {fin.adjustedby} on {new Date(fin.adjustedon).toLocaleDateString()}{fin.adjustmentreason ? `: ${fin.adjustmentreason}` : ''}
                      </p>
                    )}
                    {card && card.kept < Number(fin.amount) && (
                      <p className="text-xs text-amber-400 mt-1">
                        {card.refunded > 0 && <>Refunded {formatMoney(card.refunded)}. </>}
                        {card.openDispute > 0 && <>{formatMoney(card.openDispute)} in dispute. </>}
                        Kept {formatMoney(card.kept)} of {formatMoney(Number(fin.amount))}.
                      </p>
                    )}
                    </div><div className="text-right shrink-0 pl-4">
                  <p className={`font-bold ${tone.text}`}>{minus ? '-' : '+'}${Number(fin.amount).toFixed(2)}</p>
                  {(() => { const b = ledgerBalanceChange(fin); return b && (
                    <p className={`text-xs mt-1 ${b.after < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                      {b.changesBalance ? <>Balance {signedMoney(b.before)} → {signedMoney(b.after)}</> : <>Balance unchanged: {signedMoney(b.after)}</>}
                    </p>
                  ); })()}
                  {!action && (
                    <div className="mt-1 flex justify-end gap-3">
                      {canAdjust && <button type="button" onClick={() => startAction('adjust', Number(fin.amount))} className={linkClass}><Pencil size={12} /> Adjust</button>}
                      {isAdmin && card && !disputeOpen && card.kept > 0 && (
                        <>
                          <button type="button" onClick={() => startAction('refund', card.kept)} className={linkClass}>Refund</button>
                          <button type="button" onClick={() => startAction('dispute', card.kept)} className={linkClass}>Dispute</button>
                        </>
                      )}
                      {isAdmin && card && disputeOpen && (
                        <>
                          <button type="button" onClick={() => startAction('dispute-won', 0)} className={linkClass}>Dispute Won</button>
                          <button type="button" onClick={() => startAction('dispute-lost', 0)} className={linkClass}>Dispute Lost</button>
                        </>
                      )}
                    </div>
                  )}
                </div></div>
                {action && (() => {
                  const needsAmount = action.kind === 'adjust' || action.kind === 'refund' || action.kind === 'dispute';
                  const entered = Number(action.amount) || 0;
                  const max = action.kind === 'adjust' ? Infinity : card?.kept ?? 0;
                  // Change to what was paid on this payment: positive means the client paid more
                  const paidChange = action.kind === 'adjust' ? entered - Number(fin.amount)
                    : action.kind === 'dispute-won' ? (card?.openDispute ?? 0)
                    : action.kind === 'dispute-lost' ? 0
                    : -entered;
                  const amountOk = !needsAmount || (entered > 0 && entered <= max + 0.005 && (action.kind !== 'adjust' || Math.abs(paidChange) >= 0.005));
                  let preview: React.ReactNode = null;
                  if (action.kind === 'dispute-lost') {
                    preview = <>The disputed {formatMoney(card?.openDispute ?? 0)} stays owed{isPoly ? ' on the poly fee' : ''}.</>;
                  } else if (Math.abs(paidChange) >= 0.005 && isPoly) {
                    const fee = Number(selectedClientDetail.polyfee || 0);
                    const paidBefore = Number(selectedClientDetail.polyfeepaid || 0);
                    const paidAfter = paidBefore + paidChange;
                    const wasFull = fee > 0 && paidBefore >= fee;
                    const isFull = fee > 0 && paidAfter >= fee;
                    preview = <>
                      Poly fee paid {formatMoney(paidBefore)} → {formatMoney(paidAfter)} of {formatMoney(fee)}.
                      {wasFull && !isFull && <span className="text-amber-400"> No longer paid in full: the vouchers that paying in full added are removed.</span>}
                      {!wasFull && isFull && <span className="text-emerald-400"> Paid in full: vouchers fill to {POLY_VOUCHER_MAX}.</span>}
                    </>;
                  } else if (Math.abs(paidChange) >= 0.005) {
                    const newBalance = Number(selectedClientDetail.accountbalance || 0) - paidChange;
                    preview = <>
                      Balance {formatBalance(selectedClientDetail.accountbalance)} → {formatBalance(newBalance)}.
                      {action.kind === 'adjust' ? ' Later ledger and attendance balances move by the same amount.' : ['Group Fee', 'Assessment Fee', 'Individual Fee'].includes(fin.feetype) ? ' The check-in it was taken at and the Group Income Report are updated too.' : ''}
                    </>;
                  }
                  const title = { adjust: 'Adjust cash payment', refund: 'Refund', dispute: 'Dispute (owed again until won)', 'dispute-won': 'Dispute won: apply the payment again', 'dispute-lost': 'Dispute lost' }[action.kind];
                  const submitLabel = { adjust: 'Save Adjustment', refund: 'Record Refund', dispute: 'Record Dispute', 'dispute-won': 'Mark Won', 'dispute-lost': 'Mark Lost' }[action.kind];
                  return (
                  <form onSubmit={handlePaymentAction} className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                    <p className="text-xs font-semibold text-slate-300">{title}</p>
                    <div className="flex flex-wrap gap-2">
                      {needsAmount && (
                        <div className="relative w-36">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={Number.isFinite(max) ? max : undefined}
                            value={action.amount}
                            onKeyDown={(e) => { if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault(); }}
                            onChange={(e) => setPaymentAction({ ...action, amount: e.target.value.replace(/-/g, '') })}
                            aria-label={action.kind === 'adjust' ? 'Correct payment amount' : 'Amount'}
                            autoFocus
                            required
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg py-2 pl-7 pr-3 text-white text-sm"
                          />
                        </div>
                      )}
                      <input
                        type="text"
                        value={action.reason}
                        onChange={(e) => setPaymentAction({ ...action, reason: e.target.value })}
                        placeholder="Reason…"
                        autoFocus={!needsAmount}
                        required
                        className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-sm"
                      />
                    </div>
                    {needsAmount && Number.isFinite(max) && <p className="text-xs text-slate-500">Up to {formatMoney(max)} (what's left of this payment).</p>}
                    {preview && <p className="text-xs text-slate-400">{preview}</p>}
                    {isPoly && action.kind !== 'dispute-lost' && (() => {
                      // Booking the polygraph already used the vouchers, so changing this payment can't take them back
                      const slot = assignedSlotFor(selectedClientDetail.clientid);
                      return slot && (
                        <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-2.5 text-xs text-amber-300 flex items-start justify-between gap-3">
                          <p>
                            <AlertCircle size={13} className="inline mr-1 -mt-0.5" />
                            This client already has a polygraph scheduled ({slotSummary(slot)}) using poly fee vouchers.
                            Changing this payment won't cancel it or return those vouchers.
                          </p>
                          {isAllowed('polygraph') && (
                            <button type="button" onClick={() => openPolySlot(slot.slotid)} className="shrink-0 underline hover:text-white">View Slot</button>
                          )}
                        </div>
                      );
                    })()}
                    {paymentActionError && <p className="text-xs text-red-400">{paymentActionError}</p>}
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => { setPaymentAction(null); setPaymentActionError(''); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">Cancel</button>
                      <button
                        type="submit"
                        disabled={loading || !amountOk || !action.reason.trim()}
                        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                      >
                        {submitLabel}
                      </button>
                    </div>
                  </form>
                  );
                })()}
                </div>);
                  })}
                  </div>
                    );
                  })}</div>
              )}

              {clientTab === 'notes' && (
                <div className="space-y-4">
                  {(() => {
                    // Filters set but hidden are counted on the button so they aren't forgotten
                    const activeNoteFilters = [noteFilters.search.trim(), noteFilters.category, noteFilters.from, noteFilters.to].filter(Boolean).length;
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowNoteForm(show => !show)}
                          aria-expanded={showNoteForm}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border ${showNoteForm ? 'bg-blue-500/10 border-blue-500 text-blue-300' : 'bg-blue-600 hover:bg-blue-500 border-transparent text-white'}`}
                        >
                          <PlusCircle size={14} /> New Note
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowNoteFilters(show => !show)}
                          aria-expanded={showNoteFilters}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showNoteFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
                        >
                          <SlidersHorizontal size={13} /> Filters
                          {activeNoteFilters > 0 && (
                            <span className="bg-blue-600 text-white rounded-full px-1.5 text-[10px] leading-4">{activeNoteFilters}</span>
                          )}
                        </button>
                        <span className="ml-auto text-xs text-slate-500">
                          {shownNotes.length === clientNotes.length ? `${clientNotes.length} notes` : `Showing ${shownNotes.length} of ${clientNotes.length}`}
                        </span>
                      </div>
                    );
                  })()}
                  {showNoteForm && (
                    <form onSubmit={handleAddNote} className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-3">
                      <textarea value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)} placeholder="Type case note..." rows={3} autoFocus className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => { setShowNoteForm(false); setNewNoteText(''); }} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold">Cancel</button>
                        <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1"><PlusCircle size={14} /> Save Note</button>
                      </div>
                    </form>
                  )}
                  {showNoteFilters && <RecordFilterBar
                    search={noteFilters.search}
                    onSearch={v => setNoteFilters(f => ({ ...f, search: v }))}
                    searchPlaceholder="Note text or author..."
                    selects={[
                      { label: 'Category', value: noteFilters.category, onChange: v => setNoteFilters(f => ({ ...f, category: v })), allLabel: 'All Categories', options: sortedUnique(clientNotes.map(n => n.category)) },
                    ]}
                    from={noteFilters.from}
                    to={noteFilters.to}
                    onFrom={v => setNoteFilters(f => ({ ...f, from: v }))}
                    onTo={v => setNoteFilters(f => ({ ...f, to: v }))}
                    sort={noteFilters.sort}
                    onSort={v => setNoteFilters(f => ({ ...f, sort: v }))}
                    sortOptions={[
                      { value: 'newest', label: 'Newest First' },
                      { value: 'oldest', label: 'Oldest First' },
                    ]}
                    shown={shownNotes.length}
                    total={clientNotes.length}
                    onClear={() => setNoteFilters(f => ({ ...EMPTY_NOTE_FILTERS, sort: f.sort }))}
                  />}
                  {shownNotes.length === 0 && clientNotes.length > 0 && (
                    <p className="text-center text-slate-500 text-sm py-4">No case notes match these filters.</p>
                  )}
                  {shownNotes.map(n => (
                    <div key={n.noteid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex gap-5">
                      <div className="shrink-0 w-28 flex flex-col justify-center border-r border-slate-800 pr-5">
                        <p className="text-2xl font-bold text-white leading-tight">{formatLogMonthDay(n.date)}</p>
                        <p className="text-sm text-slate-400 mt-0.5">{formatLogYear(n.date)}</p>
                        <p className="text-xs text-slate-500 mt-1">{formatLogTime(n.date)}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-blue-400 font-semibold">{caseNoteLabel(n)}</span>
                          {canChangeNote(n) && editingNoteId !== n.noteid && (
                            <span className="flex gap-3 text-xs">
                              <button type="button" onClick={() => { setEditingNoteId(n.noteid); setEditNoteText(n.comments || ''); setNoteError(null); }} className="inline-flex items-center gap-1 text-slate-400 hover:text-white"><Pencil size={12} /> Edit</button>
                              <button type="button" onClick={() => handleDeleteNote(n.noteid)} className="inline-flex items-center gap-1 text-slate-400 hover:text-red-400"><Trash2 size={12} /> Delete</button>
                            </span>
                          )}
                        </div>
                        {editingNoteId === n.noteid ? (
                          <div className="mt-2 space-y-2">
                            <textarea value={editNoteText} onChange={(e) => setEditNoteText(e.target.value)} rows={3} autoFocus className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
                            <div className="flex justify-end gap-2">
                              <button type="button" onClick={() => { setEditingNoteId(null); setNoteError(null); }} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">Cancel</button>
                              <button type="button" onClick={() => handleSaveNoteEdit(n.noteid)} disabled={noteSaving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">{noteSaving ? 'Saving…' : 'Save Changes'}</button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-slate-200 mt-1 whitespace-pre-wrap">{n.comments}</p>
                        )}
                        {noteError && noteError.noteId === n.noteid && <p className="text-xs text-red-400 mt-1">{noteError.message}</p>}
                        <p className="text-xs text-slate-500 text-right mt-2">
                          — {n.User}
                          {n.editedon && <span className="italic"> · edited {new Date(n.editedon).toLocaleString()}{n.editedby && n.editedby !== n.User ? ` by ${n.editedby}` : ''}</span>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {clientTab === 'polygraphs' && selectedClientDetail.programtype !== 'BIP' && (
                <div className="space-y-3">
                  <div className="bg-slate-950 border border-slate-800 px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <label className={`flex items-center gap-1.5 text-slate-200 whitespace-nowrap ${noPolyOverride && !noPolySaving ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                        <input
                          type="checkbox"
                          checked={!!selectedClientDetail.nopolyrequired}
                          disabled={!noPolyOverride || noPolySaving}
                          onChange={e => handleNoPolyRequiredChange(e.target.checked)}
                          className="accent-blue-500 disabled:opacity-60"
                        />
                        No Poly Required
                      </label>
                      <span className="text-slate-500 truncate">
                        {noPolySaving
                          ? 'Saving...'
                          : noPolyOverride
                            ? 'Override on: check or uncheck to save (recorded in case notes).'
                            : 'Locked'}
                      </span>
                    </div>
                    {role === 'Business Administrator' && (
                      <button
                        type="button"
                        disabled={noPolySaving}
                        onClick={() => setNoPolyOverride(o => !o)}
                        className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
                      >
                        {noPolyOverride ? 'Cancel Override' : 'Override'}
                      </button>
                    )}
                  </div>
                  {(() => {
                    const slot = assignedSlotFor(selectedClientDetail.clientid);
                    if (!slot) {
                      // Not booked: open slots that haven't started yet, soonest first
                      const openSlots = polySlots
                        .filter(s => s.status === 'Open' && (slotStart(s)?.getTime() ?? Infinity) > Date.now())
                        .sort((a, b) => (slotStart(a)?.getTime() ?? Infinity) - (slotStart(b)?.getTime() ?? Infinity));
                      const needs = polySchedulingNeeds(selectedClientDetail);
                      return (
                        <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Schedule Polygraph</p>
                            <p className={`text-xs ${needs.met ? 'text-emerald-400' : 'text-amber-400'}`}>
                              Vouchers {Number(selectedClientDetail.polyfeevoucher ?? 0)}/{POLY_VOUCHER_MAX}
                              {!needs.met && ' · payment needed before scheduling'}
                            </p>
                          </div>
                          {role !== 'Business Administrator' ? (
                            <p className="text-xs text-slate-400 italic">Only Business Administrators can assign polygraph slots to clients.</p>
                          ) : openSlots.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">No open polygraph slots are coming up. Add slots under Polygraphs › Poly Admin.</p>
                          ) : (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (!drawerPolySlot) return;
                                const slotId = Number(drawerPolySlot);
                                const clientId = String(selectedClientDetail.clientid);
                                // Same per-slot choices the Poly Schedule uses, so the confirmation, payment, and waiting-period prompts work unchanged
                                setSlotAssignments(prev => ({ ...prev, [slotId]: clientId }));
                                setSlotTypes(prev => ({ ...prev, [slotId]: drawerPolyType }));
                                setSlotComments(prev => ({ ...prev, [slotId]: drawerPolyComment }));
                                openAssignConfirm(slotId, clientId);
                              }}
                              className="grid grid-cols-1 md:grid-cols-2 gap-3"
                            >
                              <label className="md:col-span-2 text-xs text-slate-400">Open Slot
                                <select
                                  value={drawerPolySlot}
                                  onChange={(e) => setDrawerPolySlot(e.target.value)}
                                  required
                                  className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-xs"
                                >
                                  <option value="">Choose a slot…</option>
                                  {openSlots.map(s => (
                                    <option key={s.slotid} value={s.slotid}>{slotSummary(s)} · {getExaminerDisplayName(s.polygrapher)}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="text-xs text-slate-400">Poly Type
                                <select
                                  value={drawerPolyType}
                                  onChange={(e) => setDrawerPolyType(e.target.value)}
                                  className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-xs"
                                >
                                  <option value="Instant">Instant Poly</option>
                                  <option value="Maintenance">Maintenance</option>
                                  <option value="Sexual History">Sexual History</option>
                                  <option value="Specific">Specific Issue</option>
                                  <option value="Monitoring">Monitoring</option>
                                </select>
                              </label>
                              <label className="text-xs text-slate-400">Comment <span className="text-slate-500">(optional)</span>
                                <input
                                  type="text"
                                  value={drawerPolyComment}
                                  onChange={(e) => setDrawerPolyComment(e.target.value)}
                                  placeholder="Added to the case note"
                                  className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white text-xs"
                                />
                              </label>
                              {/* The page's error banner is hidden behind the account drawer */}
                              {error && <p className="md:col-span-2 text-xs text-red-400">{error}</p>}
                              <div className="md:col-span-2 flex justify-end">
                                <button type="submit" disabled={loading || !drawerPolySlot} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-semibold">
                                  Schedule
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div className="bg-blue-500/5 border border-blue-500/30 p-4 rounded-xl text-sm flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Scheduled Polygraph</p>
                          <p className="text-white mt-0.5">{slotSummary(slot)}</p>
                          <p className="text-xs text-slate-400 mt-0.5">Examiner: {getExaminerDisplayName(slot.polygrapher)}{slot.type ? ` · ${slot.type}` : ''}</p>
                        </div>
                        {isAllowed('polygraph') && (
                          <button type="button" onClick={() => openPolySlot(slot.slotid)} className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">View Slot</button>
                        )}
                      </div>
                    );
                  })()}
                  {clientPolygraphs.map((poly, i) => {
                    // Gap to the previous card, by the polygraph date when one was recorded (the list is ordered the same way)
                    const polyDay = (p: any) => localYmd(p.polygraphdatetime || p.date);
                    const prev = clientPolygraphs[i - 1];
                    const gap = prev && polyDay(prev) && polyDay(poly) ? timeBetween(polyDay(poly), polyDay(prev)) : null;
                    // Above the newest polygraph: how long it has been since then
                    const since = i === 0 && polyDay(poly) ? timeBetween(polyDay(poly), localYmd(new Date())) : null;
                    const label = since
                      ? (since === 'Same day' ? 'Last polygraph was today' : `${since} since last polygraph`)
                      : gap && (gap === 'Same day' ? 'Same day' : `${gap} apart`);
                    return (
                  <Fragment key={poly.resultid}>
                  {label && (
                    <div className={`flex items-center gap-3 px-4 ${since ? '' : '-my-1'}`}>
                      <div className="flex-1 border-t border-dashed border-slate-800" />
                      <span className={`text-[11px] rounded-full px-2.5 py-0.5 whitespace-nowrap border ${since ? 'text-blue-300 bg-blue-500/10 border-blue-500/30 font-semibold' : 'text-slate-400 bg-slate-900 border-slate-800'}`}>{label}</span>
                      <div className="flex-1 border-t border-dashed border-slate-800" />
                    </div>
                  )}
                  <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex gap-5">
                    <div className="shrink-0 w-28 flex flex-col justify-center border-r border-slate-800 pr-5">
                      <p className="text-2xl font-bold text-white leading-tight">{formatLogMonthDay(poly.date)}</p>
                      <p className="text-sm text-slate-400 mt-0.5">{formatLogYear(poly.date)}</p>
                      {/* Date is when the result was recorded (no time is stored for it) */}
                      <p className="text-xs text-slate-500 mt-1">Recorded</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-3 font-semibold text-white">
                        <span>{poly.type} Polygraph</span>
                        <span className="text-xs text-emerald-400 text-right">{poly.results}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">Examiner: {getExaminerDisplayName(poly.polygrapher)}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Polygraph Date:{' '}
                        <span className="text-slate-200">
                          {poly.polygraphdatetime
                            ? (() => { const d = new Date(poly.polygraphdatetime); return `${d.toLocaleDateString()} @ ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; })()
                            : 'Not recorded'}
                        </span>
                      </p>
                    </div>
                  </div>
                  </Fragment>
                    );
                  })}
                </div>
              )}

              {clientTab === 'attachments' && (
                <div className="space-y-3">
                  <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">Save documents to this client's account. Up to 25 MB per file.</p>
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={e => handleAttachmentUpload(e.target.files)}
                    />
                    <button
                      type="button"
                      disabled={attachmentUploading}
                      onClick={() => attachmentInputRef.current?.click()}
                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 shrink-0"
                    >
                      <Upload size={14} /> {attachmentUploading ? 'Uploading...' : 'Add Attachment'}
                    </button>
                  </div>
                  {attachmentError && (
                    <div role="alert" className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded-lg text-sm flex justify-between items-center gap-3">
                      <span>{attachmentError}</span>
                      <button onClick={() => setAttachmentError('')} className="text-red-400 hover:text-red-200"><X size={14} /></button>
                    </div>
                  )}
                  {attachmentsStatus === 'loading' && <p className="text-sm text-slate-400">Loading attachments...</p>}
                  {attachmentsStatus === 'ready' && clientAttachments.length === 0 && (
                    <p className="text-sm text-slate-400">No attachments yet.</p>
                  )}
                  {clientAttachments.map(a => (
                    <div key={a.attachmentid} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex items-center gap-4">
                      <Paperclip size={18} className="text-slate-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        {renamingAttachmentId === a.attachmentid ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              aria-label="New attachment name"
                              value={attachmentRenameValue}
                              disabled={attachmentRenameSaving}
                              onChange={e => setAttachmentRenameValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleAttachmentRename(a);
                                if (e.key === 'Escape') setRenamingAttachmentId(null);
                              }}
                              className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-white text-sm"
                            />
                            <button type="button" disabled={attachmentRenameSaving} onClick={() => handleAttachmentRename(a)} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-2.5 py-1 rounded-lg text-xs font-semibold">{attachmentRenameSaving ? 'Saving...' : 'Save'}</button>
                            <button type="button" disabled={attachmentRenameSaving} onClick={() => setRenamingAttachmentId(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1 rounded-lg text-xs font-semibold">Cancel</button>
                          </div>
                        ) : (
                          <p className="font-semibold text-white truncate" title={a.filename}>{a.filename}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-0.5">
                          {formatFileSize(a.filesize)} · Added {new Date(a.uploadedon).toLocaleDateString()} by {a.uploadedby || 'Unknown'}
                        </p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {canViewAttachment(a) && (
                          <>
                            <button type="button" onClick={() => handleAttachmentOpen(a, 'view')} title="View" className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Eye size={13} /> View</button>
                            <button type="button" onClick={() => handleAttachmentOpen(a, 'print')} title="Print" className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Printer size={13} /> Print</button>
                          </>
                        )}
                        <button type="button" onClick={() => startAttachmentRename(a)} title="Rename" className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Pencil size={13} /> Rename</button>
                        <button type="button" onClick={() => handleAttachmentOpen(a, 'download')} title="Download" className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"><Download size={13} /> Download</button>
                        {role === 'Business Administrator' && (
                          <button type="button" onClick={() => handleAttachmentDelete(a)} title="Delete" aria-label={`Delete ${a.filename}`} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1.5 rounded-lg bg-red-500/5 border border-red-500/20"><Trash2 size={13} /></button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {clientTab === 'changelog' && role === 'Business Administrator' && (() => {
                const shown = clientChangeLog.filter(c => !changeLogFilter || c.changetype === changeLogFilter);
                const labelFor = (type: string) => CHANGE_LOG_TYPES.find(t => t.type === type)?.label || type;
                return (
                  <div className="space-y-3">
                    {/* One filter per change type; counts reflect the whole log */}
                    <div className="flex flex-wrap gap-2">
                      {[{ type: '', label: 'All' }, ...CHANGE_LOG_TYPES].map(({ type, label }) => {
                        const count = type ? clientChangeLog.filter(c => c.changetype === type).length : clientChangeLog.length;
                        const active = changeLogFilter === type;
                        return (
                          <button
                            key={type || 'all'}
                            type="button"
                            onClick={() => setChangeLogFilter(type)}
                            className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${active ? 'border-blue-500 bg-blue-500/15 text-blue-300' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'}`}
                          >
                            {label} <span className="text-slate-500">({count})</span>
                          </button>
                        );
                      })}
                    </div>

                    {changeLogStatus === 'loading' ? (
                      <p className="text-sm text-slate-500">Loading change log...</p>
                    ) : changeLogStatus === 'error' ? (
                      <button type="button" onClick={openChangeLog} className="text-sm text-blue-400 hover:underline">Could not load the change log. Retry</button>
                    ) : shown.length === 0 ? (
                      <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-xl p-6 text-center">
                        {changeLogFilter ? `No ${labelFor(changeLogFilter)} changes recorded.` : 'No changes recorded for this client yet.'}
                      </p>
                    ) : shown.map((c, i) => (
                      <div key={c.changeid ?? `expired-${i}`} className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-sm flex gap-5">
                        <div className="shrink-0 w-28 flex flex-col justify-center border-r border-slate-800 pr-5">
                          <p className="text-2xl font-bold text-white leading-tight">{formatLogMonthDay(c.changedon)}</p>
                          <p className="text-sm text-slate-400 mt-0.5">{formatLogYear(c.changedon)}</p>
                          <p className="text-xs text-slate-500 mt-1">{formatLogTime(c.changedon)}</p>
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <span className="text-xs text-blue-400 font-semibold">{labelFor(c.changetype)}</span>
                          {(c.oldvalue || c.newvalue) && (
                            <p className="text-slate-200">
                              {c.oldvalue && <><span className="text-slate-400 line-through">{c.oldvalue}</span><span className="text-slate-500"> → </span></>}
                              <span className="font-semibold text-white">{c.newvalue}</span>
                            </p>
                          )}
                          {c.details && <p className="text-xs text-slate-400">{c.details}</p>}
                          <p className="text-xs text-slate-500 text-right">— {c.changedby}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* FULL ATTENDANCE & SIGN-IN TAB */}
        {/* Stays mounted on other tabs so a group check-in in progress isn't lost */}
        {isAllowed('attendance') && (
          <div className={`${activeTab === 'attendance' ? 'grid' : 'hidden'} grid-cols-1 lg:grid-cols-3 gap-6`}>
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

              {/* Stays mounted while another mode is showing so a check-in in progress isn't lost */}
              <div className={!isAccountOnly && !(isCustomCharge && role === 'Business Administrator') ? '' : 'hidden'}>
                <GroupCheckInWorkflow
                  groups={activeGroups}
                  clients={clients}
                  createdBy={user.employeeemail}
                  onSuccess={setSuccessMsg}
                  onError={setError}
                  onSaved={loadDashboardData}
                  openGroups={openGroups}
                  onOpenGroupsChanged={loadOpenGroups}
                  resumeRequest={resumeRequest}
                  onResumeHandled={() => setResumeRequest(null)}
                />
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
              ) : !isAccountOnly ? null : (
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

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
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
                                <p className="text-[11px] text-slate-500 truncate">
                                  Closed{c.closedon ? ` ${new Date(c.closedon).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}{c.closedby ? ` by ${c.closedby}` : ''}
                                </p>
                                {c.openedby && c.openedby !== c.closedby && <p className="text-[11px] text-slate-500 truncate">Opened by {c.openedby}</p>}
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
                            <p className="text-[11px] text-slate-500 truncate">Saved {new Date(o.updatedon).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{o.createdby ? ` by ${o.createdby}` : ''}</p>
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
                          onClick={() => { setIsAccountOnly(false); setIsCustomCharge(false); setResumeRequest(o); }}
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
                  <ClientPicker
                    clients={clients}
                    value={selectedClient}
                    onChange={setSelectedClient}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm placeholder-slate-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Group</label>
                  <GroupPicker
                    groups={activeGroups}
                    value={selectedGroup}
                    onChange={setSelectedGroup}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm placeholder-slate-500"
                  />
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
                <button
                  type="button"
                  onClick={toggleGroupFilters}
                  aria-expanded={showGroupFilters}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showGroupFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
                >
                  <SlidersHorizontal size={13} /> Filters
                  {changedGroupFilterCount > 0 && (
                    <span className="bg-blue-600 text-white rounded-full px-1.5 text-[10px] leading-4">{changedGroupFilterCount}</span>
                  )}
                </button>
              </div>

              {showGroupFilters && (
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
                  <button type="button" onClick={() => setGroupFilters(DEFAULT_GROUP_FILTERS)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-semibold">Clear filters</button>
                )}
              </div>
              )}

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
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-sm">
                  {sortedDirectoryGroups.map(g => {
                    const open = selectedGroupDetail?.groupid === g.groupid;
                    return (
                    <Fragment key={g.groupid}>
                    {/* Clicking the open group again closes it */}
                    <tr onClick={() => (open ? setSelectedGroupDetail(null) : handleOpenGroup(g))} className={`transition cursor-pointer ${open ? 'bg-blue-500/10' : 'hover:bg-slate-800/50'}`}>
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
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} className="p-0 whitespace-normal bg-slate-950/40 border-l-2 border-blue-500">
                          {renderGroupDetailPanel()}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* The open group is shown under its row; when filters hide that row (e.g. just set inactive), it's shown here instead */}
            {selectedGroupDetail && !sortedDirectoryGroups.some(g => g.groupid === selectedGroupDetail.groupid) && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl">{renderGroupDetailPanel()}</div>
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
                  <ClientPicker
                    clients={clients}
                    value={testClient}
                    onChange={handleSelectTestClient}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm placeholder-slate-500"
                  />
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

        {/* Polygraph assignment dialogs. Outside the Polygraph tab so they also open over a client's account,
            which can schedule from its Polygraphs section. */}
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

        {waitBypassPrompt && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="wait-bypass-title">
            <div className="bg-slate-900 border border-amber-500/40 rounded-xl p-6 w-full max-w-md space-y-4 text-sm">
              <div>
                <h3 id="wait-bypass-title" className="font-semibold text-white">Bypass Polygraph Waiting Period?</h3>
                <p className="text-xs text-slate-400 mt-1">
                  <span className="text-emerald-400 font-semibold">{waitBypassPrompt.clientName}</span>'s last polygraph
                  ({waitBypassPrompt.lastPolyDate}) was No Deception Indicated. The next one normally cannot be before {waitBypassPrompt.earliestDate} (5 months and 2 weeks).
                </p>
              </div>
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                As a Business Administrator you can schedule this polygraph anyway. The override is recorded in the client's case notes and the system log.
              </p>
              <label className="flex items-start gap-2.5 cursor-pointer text-slate-200">
                <input
                  type="checkbox"
                  checked={waitBypassConfirmed}
                  onChange={e => setWaitBypassConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-amber-500"
                />
                <span>I confirm I want to schedule this polygraph before {waitBypassPrompt.earliestDate}, bypassing the waiting period.</span>
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setWaitBypassPrompt(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Cancel</button>
                <button
                  type="button"
                  disabled={!waitBypassConfirmed || loading}
                  onClick={async () => {
                    const { slotId } = waitBypassPrompt;
                    setWaitBypassPrompt(null);
                    await handleAssignSlotToClient(slotId, true);
                  }}
                  className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-xs font-semibold"
                >
                  Bypass &amp; Assign
                </button>
              </div>
            </div>
          </div>
        )}

        {polyPaymentPrompt && (
          <ClientPaymentDialog
            client={polyPaymentPrompt.client}
            balance={Number(polyPaymentPrompt.client.accountbalance) || 0}
            noteLabel="Poly fee payment"
            initialAmount={polyPaymentPrompt.amountDue}
            initialApplyToPolyFee={polySchedulingNeeds(polyPaymentPrompt.client).polyDue > 0}
            lockApplyToPolyFee
            notice={polyPaymentPrompt.notice}
            createdBy={user.employeeemail}
            onClose={() => setPolyPaymentPrompt(null)}
            onSuccess={setSuccessMsg}
            onError={setError}
            onProcessed={(newBalance, polyFeePaid, polyFeeVoucher) => {
              const updated = { ...polyPaymentPrompt.client, accountbalance: newBalance, polyfeepaid: polyFeePaid, polyfeevoucher: polyFeeVoucher };
              setClients(prev => prev.map(c => c.clientid === updated.clientid ? { ...c, ...updated } : c));
              // The same client may be open in the account drawer
              setSelectedClientDetail((c: any) => (c && c.clientid === updated.clientid ? { ...c, ...updated } : c));
              if (polySchedulingNeeds(updated).met) {
                setSuccessMsg(`${POLY_VOUCHER_MAX}/${POLY_VOUCHER_MAX} poly fee vouchers and the account is paid up. Click ${selectedClientDetail ? 'Schedule' : 'Confirm & Assign Slot'} to schedule.`);
              }
            }}
          />
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

            {polySubTab !== 'admin' && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-slate-400">Polygrapher
                  <select value={polyExaminerFilter} onChange={(e) => setPolyExaminerFilter(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200">
                    <option value="">All Polygraphers</option>
                    {polyExaminerChoices.map(p => <option key={p.email} value={p.email}>{p.name}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-400">Location
                  <select value={polyLocationFilter} onChange={(e) => setPolyLocationFilter(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200">
                    <option value="">All Locations</option>
                    {polyLocationChoices.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-400">From
                  <input type="date" value={polyDateFrom} max={polyDateTo || undefined} onChange={(e) => setPolyDateFrom(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200" />
                </label>
                <label className="text-xs text-slate-400">To
                  <input type="date" value={polyDateTo} min={polyDateFrom || undefined} onChange={(e) => setPolyDateTo(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200" />
                </label>
                <label className="text-xs text-slate-400">Sort
                  <select value={polyDateSort} onChange={(e) => setPolyDateSort(e.target.value as 'asc' | 'desc')} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded-lg px-3 text-xs text-slate-200">
                    <option value="asc">Date: Soonest First</option>
                    <option value="desc">Date: Latest First</option>
                  </select>
                </label>
                {polyFiltersActive && (
                  <button
                    type="button"
                    onClick={() => { setPolyExaminerFilter(''); setPolyLocationFilter(''); setPolyDateFrom(''); setPolyDateTo(''); }}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-2"
                  >
                    <X size={12} /> Clear Filters
                  </button>
                )}
              </div>
            )}

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
                      {activePolygraphers.map(e => (
                        <option key={e.employeeemail} value={e.employeeemail}>
                          {e.displayname} ({e.employeeemail})
                        </option>
                      ))}
                    </select>
                    {activePolygraphers.length === 0 && (
                      <p className="text-xs text-amber-400 mt-1">No active polygraphers. Add or reactivate one under Admin.</p>
                    )}
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

            {reopenTarget && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                <form onSubmit={confirmReopenSlot} className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md space-y-4 text-sm">
                  <div>
                    <h3 className="font-semibold text-white">Cancel Polygraph Reservation</h3>
                    <p className="text-xs text-slate-400 mt-1">
                      {reopenTarget.assignedClientName ?`${reopenTarget.assignedClientName} will be notified in their case notes.` : 'The slot will be reopened for new bookings.'}
                    </p>
                    {reopenPassed && (
                      <p className="text-xs text-amber-400 mt-1">The appointment time has passed, so the slot will be closed instead of reopened.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Cancellation Reason *</label>
                    <select required value={reopenReason} onChange={(e) => { setReopenReason(e.target.value); setReopenVoucherOverride(false); }} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm">
                      <option value="">Select a reason...</option>
                      {POLY_CANCEL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Notes <span className="normal-case text-slate-500">(optional)</span></label>
                    <textarea value={reopenNotes} onChange={(e) => setReopenNotes(e.target.value)} rows={3} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" placeholder="Add details for the case note..." />
                  </div>
                  {(() => {
                    const reasonRule = polyVoucherReturnRule(reopenReason, reopenTarget);
                    const voucherRule = reopenVoucherOverride ? null : reasonRule;
                    return (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label className={`flex items-center gap-2 text-slate-200 ${voucherRule === null ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                            <input type="checkbox" checked={voucherRule ?? reopenReturnVouchers} disabled={voucherRule !== null} onChange={(e) => setReopenReturnVouchers(e.target.checked)} className="accent-amber-500 disabled:opacity-60" />
                            Poly Vouchers Return
                          </label>
                          {role === 'Business Administrator' && reasonRule !== null && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!reopenVoucherOverride) setReopenReturnVouchers(reasonRule);
                                setReopenVoucherOverride(!reopenVoucherOverride);
                              }}
                              className="text-xs font-semibold px-2 py-1 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                            >
                              {reopenVoucherOverride ? 'Undo Override' : 'Override'}
                            </button>
                          )}
                        </div>
                        {reasonRule !== null && (
                          <p className="text-xs text-slate-500 mt-1 ml-6">
                            {reopenVoucherOverride
                              ? 'Business Administrator override: the choice will be recorded in the case note.'
                              : reopenReason === 'Client requested cancellation'
                                ? `Locked: cancelled ${reasonRule ? 'more' : 'less'} than ${POLY_CANCEL_NOTICE_HOURS} hours before the appointment.`
                                : `Locked by the cancellation reason.`}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setReopenTarget(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Keep Reservation</button>
                    <button type="submit" disabled={loading || !reopenReason} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold">{reopenPassed ? 'Cancel Reservation' : 'Cancel Reservation & Reopen'}</button>
                  </div>
                </form>
              </div>
            )}

            {polySubTab === 'schedule' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-blue-400">Available Polygraph Slots & Client Assignment</h3>
                {examinerSlots.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">{polyFiltersActive ? 'No slots match these filters.' : 'No available slots scheduled.'}</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {examinerSlots.map(slot => (
                      <div key={slot.slotid} id={`poly-slot-${slot.slotid}`} className={`bg-slate-950 border ${slot.status === 'Assigned' ? 'border-emerald-500/40 bg-emerald-950/10' : 'border-slate-800'} ${highlightedSlotId === slot.slotid ? 'ring-2 ring-blue-500' : ''} px-4 py-3 rounded-xl text-sm space-y-2 transition`}>
                        <div className="flex justify-between items-start gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-white">{slot.location}</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {new Date(slot.date).toLocaleDateString()} @ {formatDisplayTime(slot.time)}
                              <span className="text-slate-600"> · </span>{slot.address || 'Address not set'}
                              <span className="text-slate-600"> · </span>Examiner: {getExaminerDisplayName(slot.polygrapher)}
                            </p>
                          </div>
                          <span className={`shrink-0 text-xs px-2 py-0.5 rounded ${slot.status === 'Assigned' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : slot.status === 'Closed' ? 'bg-slate-800 text-slate-400 border border-slate-700' : 'bg-blue-500/10 text-blue-400'}`}>
                            {slot.status === 'Assigned' ? 'Assigned' : slot.status === 'Closed' ? 'Closed' : '1 Open Slot'}
                          </span>
                        </div>

                        {slot.status === 'Assigned' ? (
                          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-300 font-medium">Assigned Client: <strong className="text-emerald-400">{slot.assignedClientName}</strong></span>
                              <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded">{slot.type}</span>
                            </div>
                            <button
                              onClick={() => handleReopenSlot(slot.slotid)}
                              className="bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 px-3 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition">
                              <RotateCcw size={13} /> Cancel Reservation & Reopen
                            </button>
                          </div>
                        ) : slot.status === 'Closed' ? (
                          <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-400 italic">Reservation cancelled after the appointment time. This slot was not reopened.</p>
                            {role === 'Business Administrator' && (
                              <button
                                onClick={() => handleDeleteSlot(slot.slotid)}
                                title="Delete closed slot"
                                className="bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 px-3 py-2 rounded text-xs font-semibold flex items-center justify-center gap-1 transition">
                                <Trash2 size={13} /> Delete
                              </button>
                            )}
                          </div>
                        ) : role === 'Business Administrator' ? (
                          <div className="pt-2 border-t border-slate-800 space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                              <div>
                                <label className="block text-xs text-slate-400 uppercase mb-1">Assign Client</label>
                                <ClientPicker
                                  // One scheduled polygraph per client: clients already booked into a slot aren't offered
                                  clients={clients.filter(c => !assignedSlotFor(c.clientid))}
                                  value={slotAssignments[slot.slotid] || ''}
                                  onChange={(id) => setSlotAssignments({ ...slotAssignments, [slot.slotid]: id })}
                                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-xs placeholder-slate-500"
                                />
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
                              <div className="md:col-span-2">
                                <label className="block text-xs text-slate-400 uppercase mb-1">Comment <span className="normal-case text-slate-500">(optional)</span></label>
                                <input
                                  type="text"
                                  value={slotComments[slot.slotid] || ''}
                                  onChange={(e) => setSlotComments({ ...slotComments, [slot.slotid]: e.target.value })}
                                  placeholder="Added to the client's case note when assigned..."
                                  className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-xs" />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => openAssignConfirm(slot.slotid)}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded text-xs font-semibold">
                                Confirm & Assign Slot
                              </button>
                              <button 
                                onClick={() => handleDeleteSlot(slot.slotid)}
                                title="Delete open slot"
                                className="bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 px-3 py-1.5 rounded text-xs font-semibold flex items-center justify-center gap-1 transition">
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
                  <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
                      <thead>
                        <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                          <th className="p-3">Client</th>
                          <th className="p-3">Type</th>
                          <th className="p-3">Location</th>
                          <th className="p-3">Scheduled</th>
                          <th className="p-3">Examiner</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-sm">
                        {assignedSlots.map(slot => (
                          <tr
                            key={slot.slotid}
                            onClick={() => { setSelectedSlotForResults(slot); setResIncentiveContinued(false); setResIncentiveOverride(false); }}
                            className={`transition cursor-pointer ${selectedSlotForResults?.slotid === slot.slotid ? 'bg-blue-500/10' : 'hover:bg-slate-800/50'}`}>
                            <td className="p-3 font-medium text-white">{slot.assignedClientName}</td>
                            <td className="p-3"><span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded text-xs">{slot.type || 'Polygraph'}</span></td>
                            <td className="p-3 text-slate-400">{slot.location}</td>
                            <td className="p-3 text-slate-300">{new Date(slot.date).toLocaleDateString()} @ {formatDisplayTime(slot.time)}</td>
                            <td className="p-3 text-slate-300">{getExaminerDisplayName(slot.polygrapher)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
                      <select value={resResultType} onChange={(e) => { setResResultType(e.target.value); setResIncentiveContinued(false); setResIncentiveOverride(false); }} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
                        <option value="No Deception Indicated">No Deception Indicated (NDI)</option>
                        <option value="Deception Indicated">Deception Indicated (DI)</option>
                        <option value="Inconclusive">Inconclusive (INC)</option>
                        <option value="No Opinion">No Opinion (NO)</option>
                        <option value="No Significant Response">No Significant Response (NSR)</option>
                      </select>
                    </div>

                    {POLY_INCENTIVE_OVERRIDE_RESULTS.includes(resResultType) && (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label className={`flex items-center gap-2 text-sm text-slate-200 ${resIncentiveOverride ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                            <input type="checkbox" checked={resIncentiveOverride && resIncentiveContinued} disabled={!resIncentiveOverride} onChange={(e) => setResIncentiveContinued(e.target.checked)} className="accent-blue-500 disabled:opacity-60" />
                            Incentive Program Continuation
                          </label>
                          {role === 'Business Administrator' && (
                            <button
                              type="button"
                              onClick={() => {
                                if (resIncentiveOverride) setResIncentiveContinued(false);
                                setResIncentiveOverride(!resIncentiveOverride);
                              }}
                              className="text-xs font-semibold px-2 py-1 rounded border border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                            >
                              {resIncentiveOverride ? 'Undo Override' : 'Override'}
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-1 ml-6">
                          {resIncentiveOverride
                            ? 'Business Administrator override: checked keeps the client earning poly fee vouchers as if the result were NDI.'
                            : `Locked unchecked for ${resResultType} results.`}
                        </p>
                      </div>
                    )}

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
            <div role="tablist" className="flex flex-wrap border-b border-slate-800">
              {reportTabsFor(role).map(t => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={currentReport === t.id}
                  onClick={() => setReportTab(t.id)}
                  className={`px-4 py-2.5 border-b-2 -mb-px text-sm font-medium whitespace-nowrap transition ${currentReport === t.id ? 'border-blue-500 text-blue-400 bg-blue-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {reportsError && <p className="text-xs text-red-400">{reportsError}</p>}

            {currentReport === 'groupIncome' && <GroupIncomeReport userEmail={user.employeeemail} canRecordDeposits={user.role === 'Business Administrator'} />}

            {currentReport === 'cashDeposits' && <GroupCashDepositReport userEmail={user.employeeemail} isAdmin={user.role === 'Business Administrator'} />}

            {currentReport === 'counselorClients' && <CounselorClientReport clients={clients} groups={groups} statuses={PROGRAM_STATUSES} onOpenClient={openClientLogs} />}

            {currentReport === 'agent' && !reportsError && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
                <h3 className="font-semibold text-white mb-4">Weekly Supervising Agent Summary</h3>
                <table className="w-full text-left border-collapse text-xs">
                  <thead><tr className="bg-slate-800/50 text-slate-400 uppercase"><th className="p-3">Client</th><th className="p-3">Agent</th><th className="p-3">Attended Sessions</th><th className="p-3">Last Poly</th><th className="p-3">Balance</th></tr></thead>
                  <tbody className="divide-y divide-slate-800 text-sm">
                    {agentReportData?.map(r => (
                      <tr key={r.clientid}><td className="p-3 font-medium text-white">{r.lastname}, {r.firstname}</td><td className="p-3 text-slate-300">{r.supervisingagent}</td><td className="p-3">{r.totalattended}</td><td className="p-3 text-slate-400">{r.lastpolydate ? new Date(r.lastpolydate).toLocaleDateString() : 'None'}</td><td className="p-3 font-semibold text-slate-200">{formatBalance(r.accountbalance)}</td></tr>
                    ))}
                    {(!agentReportData || agentReportData.length === 0) && (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-500 text-sm">{agentReportData ? 'No clients to report.' : 'Loading…'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {currentReport === 'deposit' && !depositReportData && !reportsError && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl text-center text-slate-500 text-sm">Loading…</div>
            )}

            {currentReport === 'deposit' && depositReportData && (
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
              <div className="flex justify-between items-center gap-3 border-b border-slate-800 pb-3">
                <h2 className="text-lg font-bold text-white">User Management</h2>
                {role === 'Business Administrator' && !showEmployeeForm && (
                  <button type="button" onClick={() => { resetEmployeeForm(); setShowEmployeeForm(true); }} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                    <PlusCircle size={14} /> New User
                  </button>
                )}
              </div>
              {/* Only Business Administrators can create or edit accounts */}
              {role !== 'Business Administrator' && (
                <p className="text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded p-3">
                  Only Business Administrators can create or edit accounts.
                </p>
              )}
              {role === 'Business Administrator' && showEmployeeForm && (
              <form onSubmit={handleSaveEmployee} className="space-y-3 bg-slate-950/50 border border-slate-800 rounded-lg p-4">
                <p className="text-sm font-semibold text-white">{editingEmail ? 'Edit Account' : 'New User'}</p>
                {editingEmail && <p className="text-xs text-blue-400">Editing {editingEmail}. Email can't be changed.</p>}
                <input type="email" value={empEmail} onChange={(e) => setEmpEmail(e.target.value)} disabled={editingEmail !== null} placeholder="Employee Email" className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm disabled:opacity-50" required />
                <input type="text" value={empName} onChange={(e) => setEmpName(e.target.value)} placeholder="Full Display Name" className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required />
                <input type="password" value={empPassword} onChange={(e) => setEmpPassword(e.target.value)} autoComplete="new-password" placeholder={editingEmail ? 'New password (leave blank to keep current)' : 'Password'} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required={editingEmail === null} />
                <select value={empRole} onChange={(e) => setEmpRole(e.target.value)} disabled={editingEmail === user.employeeemail} className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm disabled:opacity-50">
                  <option value="Office Admin">Office Admin</option>
                  <option value="Business Administrator">Business Administrator</option>
                  <option value="Counselor">Counselor</option>
                  <option value="Polygrapher">Polygrapher</option>
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
                  <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded text-xs">{editingEmail ? 'Save Changes' : 'Create User'}</button>
                  <button type="button" onClick={resetEmployeeForm} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold px-4 py-2 rounded text-xs">Cancel</button>
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
                <div className="flex gap-2">
                  <input
                    type="search"
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                    placeholder="Search by name or email..."
                    className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-xs placeholder-slate-500"
                  />
                  <select
                    value={empRoleFilter}
                    onChange={(e) => setEmpRoleFilter(e.target.value)}
                    aria-label="Filter by user type"
                    className={`shrink-0 bg-slate-950 border rounded px-2.5 text-xs ${empRoleFilter ? 'border-blue-500 text-white' : 'border-slate-700 text-slate-300'}`}
                  >
                    <option value="">All User Types</option>
                    {sortedUnique(employees.map(e => e.role)).map(r => (
                      <option key={r} value={r}>{r} ({employees.filter(e => e.role === r && (accountFilter === 'all' || (accountFilter === 'active' ? e.active !== false : e.active === false))).length})</option>
                    ))}
                  </select>
                </div>
                {employees.filter(e => (accountFilter === 'all' || (accountFilter === 'active' ? e.active !== false : e.active === false)) && (!empRoleFilter || e.role === empRoleFilter) && (empSearch.trim() === '' || `${e.displayname} ${e.employeeemail} ${e.role}`.toLowerCase().includes(empSearch.toLowerCase()))).map(e => (
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
              <div className="flex justify-between items-center gap-3 border-b border-slate-800 pb-3">
                <h2 className="text-lg font-bold text-white">System Audit & Activity Logs</h2>
                <button type="button" onClick={() => setShowSystemLogs(!showSystemLogs)} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded font-semibold text-xs shrink-0"><Activity size={14} /> {showSystemLogs ? 'Hide Logs' : 'Show Logs'}</button>
              </div>
              {showSystemLogs && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {systemLogs.map(l => (
                  <div key={l.logid} className="bg-slate-950 border border-slate-800 p-3 rounded text-xs space-y-1">
                    <div className="flex justify-between text-slate-400"><span>{l.useremail}</span><span>{new Date(l.timestamp).toLocaleString()}</span></div>
                    <p className="text-white font-medium">{l.action}</p>
                    <p className="text-slate-400">{l.details}</p>
                  </div>
                ))}
              </div>
              )}
            </div>

            <SessionPriceList userEmail={user.employeeemail} canEdit={role === 'Business Administrator'} onSuccess={setSuccessMsg} />
          </div>
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
  );
}