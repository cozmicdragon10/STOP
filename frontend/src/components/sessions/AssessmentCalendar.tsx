import { useEffect, useState } from 'react';
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, ClipboardPlus, RotateCcw, UserPlus, XCircle } from 'lucide-react';
import ClientPicker from '../ClientPicker';
import AssessmentTimePanel from '../home/AssessmentTimePanel';
import PopupDialog from '../home/PopupDialog';
import { formatDisplayTime, getLocalDateString } from '../../utils/dates';
import { assessmentPickList } from '../../utils/counselor';
import {
  assignAssessmentSlot, cancelAssessmentAppointment, cancelOpenAssessmentTimes, getAssessmentAppointments,
  openAssessmentSlot, unassignAssessmentSlot, updateAssessmentAppointment,
  type AssessmentAppointment, type AssessmentCreateResult, type AssessmentRepeat,
} from '../../api';

interface CalendarClient {
  clientid: number;
  firstname: string;
  lastname: string;
  programstatus?: string | null;
  assessor?: string | null;
  docnumber?: string | null;
  doctype?: string | null;
}

interface Props {
  clients: CalendarClient[];
  // Active counselors who can be the assessor
  counselors: string[];
  user: { employeeemail: string; displayname?: string; role?: string };
  // Start an assessment now, without a scheduled time (the session form)
  onNewAssessment: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FILTER_KEY = 'stop.assessmentCalendar.assessor';

// 'YYYY-MM' moved by a number of months
const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const longDay = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

// open: a counselor's availability (no client); edit: change an open time. A client gets a time only by being assigned
// to an open one (or begins right away with New Assessment).
type FormMode = 'open' | 'edit';
interface FormState { clientId: string; assessor: string; date: string; time: string; location: string; notes: string; repeat: AssessmentRepeat; until: string }
// The last location used, so a new time starts there (remembered per browser)
const LOCATION_KEY = 'stop.assessmentCalendar.location';
const lastLocation = () => { try { return localStorage.getItem(LOCATION_KEY) || ''; } catch { return ''; } };
const rememberLocation = (place: string) => { try { localStorage.setItem(LOCATION_KEY, place); } catch { /* just not remembered */ } };
const REPEAT_CHOICES: [AssessmentRepeat, string][] = [
  ['none', 'Does not repeat'],
  ['weekdays', 'Every weekday (Mon to Fri)'],
  ['weekly', 'Every week on this day'],
  ['biweekly', 'Every 2 weeks on this day'],
];
// "Opened 4 times." plus the dates left out because the counselor already had that time
const createdText = (verb: string, result: AssessmentCreateResult) => {
  const made = `${verb} ${result.created} time${result.created === 1 ? '' : 's'}.`;
  if (!result.skipped.length) return made;
  const skipped = result.skipped.map(d => new Date(`${d}T00:00:00`).toLocaleDateString()).join(', ');
  return `${made} Skipped ${result.skipped.length} already taken: ${skipped}.`;
};

// The Assessments calendar, like the polygraph schedule: counselors open times they're available, and a client is
// assigned to an open time (or scheduled at a new time in one step). Counselors open and change only their own times;
// Office and Business Administrators manage everyone's. Cancelled times stay on record and are left off the calendar.
export default function AssessmentCalendar({ clients, counselors, user, onNewAssessment, onSuccess, onError }: Props) {
  const today = getLocalDateString();
  const isCounselor = user.role === 'Counselor';
  const me = user.displayname || '';
  const [month, setMonth] = useState(today.slice(0, 7));
  const [pickedDay, setPickedDay] = useState<string>(today);
  const [appointments, setAppointments] = useState<AssessmentAppointment[]>([]);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  // Whose times are shown: one counselor's, or everyone's (''); remembered per browser
  const [assessorFilter, setAssessorFilterState] = useState(() => {
    try { return localStorage.getItem(FILTER_KEY) || ''; } catch { return ''; }
  });
  const setAssessorFilter = (value: string) => {
    setAssessorFilterState(value);
    try { localStorage.setItem(FILTER_KEY, value); } catch { /* just not remembered */ }
  };
  const [mode, setMode] = useState<FormMode | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>({ clientId: '', assessor: '', date: today, time: '', location: '', notes: '', repeat: 'none', until: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // The client picked on each open time's card, by appointment id
  const [assignPick, setAssignPick] = useState<Record<number, string>>({});
  // A client's assessment being rescheduled: it moves only into one of the counselor's open times (a pop-up)
  const [moving, setMoving] = useState<AssessmentAppointment | null>(null);

  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const leadingBlanks = new Date(year, monthNumber - 1, 1).getDay();
  const firstDay = monthDays[0];
  const lastDay = monthDays[monthDays.length - 1];

  // This month's times; reloaded after each change (reloadKey)
  useEffect(() => {
    let cancelled = false;
    getAssessmentAppointments(firstDay, lastDay)
      .then(rows => { if (!cancelled) { setAppointments(rows); setLoadError(''); } })
      .catch(err => { if (!cancelled) setLoadError(err.message || 'Failed to load assessments.'); });
    return () => { cancelled = true; };
  }, [firstDay, lastDay, reloadKey]);

  const shown = appointments.filter(a => a.status !== 'Cancelled' && (!assessorFilter || a.assessor === assessorFilter));
  const byDay = new Map<string, AssessmentAppointment[]>();
  for (const a of shown) byDay.set(a.apptdate, [...(byDay.get(a.apptdate) ?? []), a]);
  const dayList = byDay.get(pickedDay) ?? [];
  const monthOpen = shown.filter(a => a.status === 'Open').length;
  const monthScheduled = shown.filter(a => a.status === 'Scheduled').length;

  const canChange = (a: { assessor: string }) => !isCounselor || a.assessor === me;
  // Counselors work on their own times; everyone else picks the counselor
  const assessorChoices = isCounselor ? counselors.filter(name => name === me) : counselors;
  const set = (patch: Partial<FormState>) => { setForm(f => ({ ...f, ...patch })); setFormError(''); };
  const reload = () => setReloadKey(k => k + 1);

  const startForm = (next: FormMode, day: string) => {
    setMode(next);
    setEditingId(null);
    const assessor = isCounselor ? me : assessorFilter;
    setForm({ clientId: '', assessor: counselors.includes(assessor) ? assessor : '', date: day >= today ? day : today, time: '', location: lastLocation(), notes: '', repeat: 'none', until: '' });
    setFormError('');
  };
  const startEdit = (a: AssessmentAppointment) => {
    setMode('edit');
    setEditingId(a.appointmentid);
    setForm({ clientId: a.clientid ? String(a.clientid) : '', assessor: a.assessor, date: a.apptdate, time: a.appttime, location: a.location || '', notes: a.notes || '', repeat: 'none', until: '' });
    setFormError('');
  };
  const closeForm = () => { setMode(null); setEditingId(null); setFormError(''); };

  const save = async () => {
    if (saving || !mode) return;
    if (!form.assessor) return setFormError('Choose the counselor.');
    if (!form.date) return setFormError('Enter the date.');
    if (!form.time) return setFormError('Enter the time.');
    if (!form.location.trim()) return setFormError('Enter the location.');
    const repeats = mode !== 'edit' && form.repeat !== 'none';
    if (repeats && !form.until) return setFormError('Enter the date the repeats end.');
    if (repeats && form.until < form.date) return setFormError('The repeat end date is before the first date.');
    setSaving(true);
    try {
      const details = { assessor: form.assessor, date: form.date, time: form.time, location: form.location.trim(), notes: form.notes };
      const repeat = { repeat: repeats ? form.repeat : 'none' as AssessmentRepeat, until: repeats ? form.until : '' };
      if (mode === 'open') {
        const result = await openAssessmentSlot({ ...details, ...repeat });
        onSuccess(repeats ? createdText('Opened', result) : `Opened ${formatDisplayTime(form.time)} on ${longDay(form.date)} for assessments.`);
      } else if (editingId !== null) {
        await updateAssessmentAppointment(editingId, details);
        onSuccess('Assessment time changed.');
      }
      rememberLocation(form.location.trim());
      closeForm();
      setPickedDay(form.date);
      if (form.date.slice(0, 7) !== month) setMonth(form.date.slice(0, 7));
      reload();
    } catch (err) {
      setFormError(errorText(err, 'Failed to save.'));
    } finally {
      setSaving(false);
    }
  };

  // Each card action reports through onSuccess/onError and reloads the month
  const act = async (work: () => Promise<unknown>, message: string) => {
    try {
      await work();
      onSuccess(message);
      reload();
      return true;
    } catch (err) {
      onError(errorText(err, 'Something went wrong.'));
      return false;
    }
  };
  const assign = (a: AssessmentAppointment) => {
    const clientId = assignPick[a.appointmentid];
    if (!clientId) return onError('Choose a client for this time first.');
    act(() => assignAssessmentSlot(a.appointmentid, { clientId: Number(clientId), notes: '' }), 'Client assigned to the assessment time.')
      .then(done => { if (done) setAssignPick(p => { const next = { ...p }; delete next[a.appointmentid]; return next; }); });
  };
  // Taking a client off a time asks for the reason (a pop-up); it's saved as an Assessment note on their account
  const [unassigning, setUnassigning] = useState<{ appt: AssessmentAppointment; reason: string; error: string; saving: boolean } | null>(null);
  const unassign = (a: AssessmentAppointment) => setUnassigning({ appt: a, reason: '', error: '', saving: false });
  const confirmUnassign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unassigning || unassigning.saving) return;
    const reason = unassigning.reason.trim();
    if (!reason) return setUnassigning({ ...unassigning, error: 'Enter the reason.' });
    setUnassigning({ ...unassigning, saving: true, error: '' });
    try {
      await unassignAssessmentSlot(unassigning.appt.appointmentid, reason);
      onSuccess(`${unassigning.appt.firstname} ${unassigning.appt.lastname} was taken off the time, and the reason was added to their case notes. The time is open again.`);
      setUnassigning(null);
      reload();
    } catch (err) {
      setUnassigning(u => u && { ...u, saving: false, error: errorText(err, 'Could not take the client off this time.') });
    }
  };
  const cancel = (a: AssessmentAppointment) => {
    const what = a.status === 'Open' ? `the open time with ${a.assessor}` : `the assessment for ${a.firstname} ${a.lastname}`;
    if (!window.confirm(`Cancel ${what} on ${longDay(a.apptdate)} at ${formatDisplayTime(a.appttime)}?`)) return;
    act(() => cancelAssessmentAppointment(a.appointmentid), a.status === 'Open' ? 'Open time removed.' : 'Assessment cancelled.');
  };

  // Whose open times the bulk cancel clears: a counselor's own, else the counselor picked in the filter
  // Cancelling all of a counselor's open times: Business Administrators only (DEV signs in as one; the server checks too),
  // with two warnings. Step 1 shows how many open times would go; step 2 asks for CANCEL ALL to be typed.
  const canCancelAll = user.role === 'Business Administrator';
  const bulkTarget = canCancelAll ? assessorFilter : '';
  const [bulk, setBulk] = useState<{ who: string; step: 1 | 2; times: AssessmentAppointment[] | null; typed: string; error: string; saving: boolean } | null>(null);
  const startCancelAll = () => {
    if (!bulkTarget) return;
    const who = bulkTarget;
    setBulk({ who, step: 1, times: null, typed: '', error: '', saving: false });
    // Every open time from today on (up to 2 years out), so the warning gives the real count
    const [y, m, d] = today.split('-').map(Number);
    const until = getLocalDateString(new Date(y + 2, m - 1, d));
    getAssessmentAppointments(today, until)
      .then(rows => setBulk(b => b && b.who === who ? { ...b, times: rows.filter(r => r.status === 'Open' && r.assessor === who) } : b))
      .catch(err => setBulk(b => b && { ...b, times: [], error: errorText(err, 'Could not load the open times.') }));
  };
  const confirmCancelAll = async () => {
    if (!bulk || bulk.saving || bulk.typed.trim().toUpperCase() !== 'CANCEL ALL') return;
    setBulk({ ...bulk, saving: true, error: '' });
    try {
      const { cancelled } = await cancelOpenAssessmentTimes(bulk.who);
      onSuccess(cancelled ? `Cancelled ${cancelled} open time${cancelled === 1 ? '' : 's'} for ${bulk.who}.` : `${bulk.who} has no open times from today on.`);
      setBulk(null);
      reload();
    } catch (err) {
      setBulk(b => b && { ...b, saving: false, error: errorText(err, 'Failed to cancel the open times.') });
    }
  };

  const editing = editingId !== null ? appointments.find(a => a.appointmentid === editingId) : undefined;
  // Locations already used this month, offered as suggestions in the Location box
  const knownLocations = Array.from(new Set(appointments.map(a => (a.location || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const smallButton = 'px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition';

  const renderCard = (a: AssessmentAppointment) => {
    const isOpen = a.status === 'Open';
    const mine = canChange(a);
    return (
      <div key={a.appointmentid} className={`bg-slate-950 border ${isOpen ? 'border-slate-800' : 'border-emerald-500/40 bg-emerald-950/10'} px-4 py-3 rounded-xl text-sm space-y-2`}>
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-white">{isOpen ? 'Open for assessment' : `${a.lastname}, ${a.firstname}`}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {formatDisplayTime(a.appttime)}<span className="text-slate-600"> · </span>{a.location || 'No location set'}<span className="text-slate-600"> · </span>Assessor: {a.assessor}
              {!isOpen && a.programtype && <><span className="text-slate-600"> · </span>{a.programtype}</>}
            </p>
            {a.notes && <p className="text-xs text-slate-500 mt-1">{a.notes}</p>}
          </div>
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded ${isOpen ? 'bg-blue-500/10 text-blue-400' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'}`}>
            {isOpen ? 'Open' : 'Scheduled'}
          </span>
        </div>
        {mine ? (
          <div className="pt-2 border-t border-slate-800 flex flex-col md:flex-row md:items-end gap-2">
            {isOpen && (
              <div className="flex-1 flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 uppercase mb-1">Assign Client</label>
                  <ClientPicker
                    clients={assessmentPickList(clients, a.assessor)}
                    value={assignPick[a.appointmentid] || ''}
                    onChange={(id) => setAssignPick(p => ({ ...p, [a.appointmentid]: id }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-xs placeholder-slate-500" />
                </div>
                <button type="button" onClick={() => assign(a)} className={`${smallButton} bg-blue-600 hover:bg-blue-500 text-white border-blue-600 justify-center`}>
                  <UserPlus size={13} /> Assign
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-2 md:ml-auto">
              <button type="button" onClick={() => (isOpen ? startEdit(a) : setMoving(a))} className={`${smallButton} bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-600/40`}>
                <CalendarClock size={13} /> Reschedule
              </button>
              {!isOpen && (
                <button type="button" onClick={() => unassign(a)} className={`${smallButton} bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-600/40`}>
                  <RotateCcw size={13} /> Unassign
                </button>
              )}
              <button type="button" onClick={() => cancel(a)} className={`${smallButton} bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border-rose-800/60`}>
                <XCircle size={13} /> {isOpen ? 'Remove' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : (
          <p className="pt-2 border-t border-slate-800 text-xs text-slate-500 italic">Only {a.assessor} or an admin can change this time.</p>
        )}
      </div>
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl space-y-4">
      {moving && (
        <AssessmentTimePanel
          key={moving.appointmentid}
          appt={moving}
          clients={clients}
          today={today}
          onClose={() => setMoving(null)}
          onChanged={(message) => { onSuccess(message); setMoving(null); reload(); }}
        />
      )}
      {bulk && (
        <PopupDialog
          title={bulk.step === 1 ? `Cancel all open times for ${bulk.who}?` : 'Are you sure?'}
          subtitle={bulk.step === 1 ? 'Step 1 of 2' : 'Step 2 of 2: this cannot be undone'}
          busy={bulk.saving}
          onClose={() => setBulk(null)}>
          <div className="space-y-3">
            {bulk.times === null ? (
              <p className="text-sm text-slate-400">Counting {bulk.who}'s open times...</p>
            ) : bulk.step === 1 ? (
              <>
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-sm text-rose-200 space-y-1">
                  <p className="font-semibold">
                    {bulk.times.length === 0
                      ? `${bulk.who} has no open times from today on.`
                      : `This cancels ${bulk.times.length} open time${bulk.times.length === 1 ? '' : 's'} for ${bulk.who}, from today on.`}
                  </p>
                  <p className="text-xs text-rose-300/80">Clients can no longer be assigned to them. Times that already have a client are not changed.</p>
                </div>
                {bulk.times.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-lg divide-y divide-slate-800">
                    {bulk.times.map(t => (
                      <li key={t.appointmentid} className="px-3 py-1.5 flex justify-between gap-3">
                        <span>{longDay(t.apptdate)} at {formatDisplayTime(t.appttime)}</span>
                        <span className="text-slate-500 truncate">{t.location || 'No location set'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-slate-300">
                  {bulk.times.length} open time{bulk.times.length === 1 ? '' : 's'} for <span className="font-semibold text-white">{bulk.who}</span> will be cancelled.
                  To confirm, type <span className="font-mono font-semibold text-rose-300">CANCEL ALL</span> below.
                </p>
                <input
                  type="text"
                  autoFocus
                  value={bulk.typed}
                  onChange={e => setBulk({ ...bulk, typed: e.target.value, error: '' })}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmCancelAll(); } }}
                  placeholder="CANCEL ALL"
                  aria-label="Type CANCEL ALL to confirm"
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm font-mono placeholder-slate-600" />
              </>
            )}
            {bulk.error && <p className="text-xs text-red-400">{bulk.error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setBulk(null)} disabled={bulk.saving} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-1.5 rounded text-xs font-semibold">Keep the times</button>
              {bulk.step === 1 ? (
                <button type="button" onClick={() => setBulk({ ...bulk, step: 2 })} disabled={!bulk.times?.length}
                  className="bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold">Continue</button>
              ) : (
                <button type="button" onClick={confirmCancelAll} disabled={bulk.saving || bulk.typed.trim().toUpperCase() !== 'CANCEL ALL'}
                  className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold">
                  {bulk.saving ? 'Cancelling...' : `Cancel ${bulk.times?.length ?? 0} Open Time${bulk.times?.length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          </div>
        </PopupDialog>
      )}
      {unassigning && (
        <PopupDialog
          title={`Unassign ${unassigning.appt.firstname} ${unassigning.appt.lastname}`}
          subtitle={`${longDay(unassigning.appt.apptdate)} at ${formatDisplayTime(unassigning.appt.appttime)} · ${unassigning.appt.location || 'No location set'} · ${unassigning.appt.assessor}`}
          busy={unassigning.saving}
          onClose={() => setUnassigning(null)}>
          <form onSubmit={confirmUnassign} className="space-y-3">
            <div>
              <label htmlFor="unassign-reason" className="block text-xs text-slate-400 uppercase mb-1">Reason</label>
              <textarea
                id="unassign-reason"
                rows={3}
                maxLength={1000}
                autoFocus
                value={unassigning.reason}
                onChange={e => setUnassigning({ ...unassigning, reason: e.target.value, error: '' })}
                placeholder="Why is the client being taken off this time?"
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm placeholder-slate-500" />
            </div>
            <p className="text-xs text-slate-400">The time goes back to open, and the reason is added to the client's case notes as an Assessment note.</p>
            {unassigning.error && <p className="text-xs text-red-400">{unassigning.error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setUnassigning(null)} disabled={unassigning.saving} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-1.5 rounded text-xs font-semibold">Close</button>
              <button type="submit" disabled={unassigning.saving || !unassigning.reason.trim()} className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold">
                {unassigning.saving ? 'Saving...' : 'Unassign'}
              </button>
            </div>
          </form>
        </PopupDialog>
      )}
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Assessment Calendar</h2>
          <p className="text-xs text-slate-400 mt-0.5">Counselors open times they are available; a client assigned to a time is listed under Scheduled, ready to begin when they pay.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => startForm('open', pickedDay || today)} className={`${smallButton} bg-blue-600 hover:bg-blue-500 text-white border-blue-600`}>
            <CalendarPlus size={14} /> Open Availability
          </button>
          <button type="button" onClick={onNewAssessment} title="Start an assessment now, without a scheduled time" className={`${smallButton} bg-emerald-700 hover:bg-emerald-600 text-white border-emerald-700`}>
            <ClipboardPlus size={14} /> New Assessment
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label htmlFor="assessment-calendar-assessor" className="text-xs text-slate-400">Counselor</label>
        <select id="assessment-calendar-assessor" value={assessorFilter} onChange={e => setAssessorFilter(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm sm:w-64">
          <option value="">All counselors</option>
          {counselors.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        {canCancelAll && (bulkTarget ? (
          <button type="button" onClick={startCancelAll} className={`${smallButton} bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border-rose-800/60 sm:ml-auto justify-center`}>
            <XCircle size={13} /> Cancel all open times for {bulkTarget}
          </button>
        ) : (
          <span className="text-xs text-slate-500 sm:ml-auto">Pick a counselor to cancel all of their open times.</span>
        ))}
      </div>

      {loadError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{loadError}</p>}

      {mode && (
        <PopupDialog
          title={mode === 'open' ? 'Open Availability' : editing?.status === 'Open' ? 'Change Open Time' : 'Reschedule Assessment'}
          subtitle={mode === 'open' ? 'Opens a time with no client. A client can be assigned to it from the calendar.' : undefined}
          busy={saving}
          // Locked: a stray click outside would lose the counselor, time, and location entered
          closeOnOutsideClick={false}
          onClose={closeForm}>
          <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {mode !== 'open' && (
              <div>
                <label className="block text-xs text-slate-400 uppercase mb-1">Client</label>
                <p className="bg-slate-950 border border-slate-800 rounded p-2 text-sm text-white">{editing?.clientid ? `${editing.lastname}, ${editing.firstname}` : 'Open (no client yet)'}</p>
              </div>
            )}
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-1">Counselor</label>
              <select value={form.assessor} onChange={e => set({ assessor: e.target.value })} disabled={isCounselor} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm disabled:opacity-80">
                <option value="">Select a counselor...</option>
                {(assessorChoices.includes(form.assessor) || !form.assessor ? assessorChoices : [form.assessor, ...assessorChoices]).map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-1">Date</label>
              <input type="date" min={today} value={form.date} onChange={e => set({ date: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 uppercase mb-1">Time</label>
              <input type="time" value={form.time} onChange={e => set({ time: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="assessment-location" className="block text-xs text-slate-400 uppercase mb-1">Location</label>
              <input id="assessment-location" type="text" list="assessment-locations" maxLength={150} value={form.location} onChange={e => set({ location: e.target.value })} placeholder="Office or town, e.g. Oklahoma City Office" className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm placeholder-slate-500" />
              <datalist id="assessment-locations">
                {knownLocations.map(place => <option key={place} value={place} />)}
              </datalist>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 uppercase mb-1">Notes <span className="normal-case text-slate-500">(optional)</span></label>
              <input type="text" value={form.notes} onChange={e => set({ notes: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" />
            </div>
            {mode !== 'edit' && (
              <>
                <div>
                  <label className="block text-xs text-slate-400 uppercase mb-1">Repeat</label>
                  <select value={form.repeat} onChange={e => set({ repeat: e.target.value as AssessmentRepeat })} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm">
                    {REPEAT_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                {form.repeat !== 'none' && (
                  <div>
                    <label className="block text-xs text-slate-400 uppercase mb-1">Repeat Until</label>
                    <input type="date" min={form.date || today} value={form.until} onChange={e => set({ until: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" />
                  </div>
                )}
              </>
            )}
          </div>
          {mode !== 'edit' && form.repeat !== 'none' && (
            <p className="text-xs text-slate-500">Each repeat is its own time on the calendar. Dates when this counselor already has a time at this hour are skipped. Up to 100 times at once.</p>
          )}
          {isCounselor && !counselors.includes(me) && <p className="text-xs text-amber-400">Your account isn't an active counselor, so you can't open assessment times.</p>}
          {formError && <p className="text-xs text-red-400">{formError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeForm} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-1.5 rounded text-xs font-semibold">Close</button>
            <button type="button" onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold">
              {saving ? 'Saving...' : mode === 'open' ? 'Open Time' : 'Save Changes'}
            </button>
          </div>
          </div>
        </PopupDialog>
      )}

      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <button type="button" onClick={() => { setMonth(shiftMonth(month, -1)); setPickedDay(''); }} aria-label="Previous month" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <ChevronLeft size={16} />
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold text-white">{new Date(year, monthNumber - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
            <p className="text-xs text-slate-500">
              {monthOpen + monthScheduled === 0 ? 'Nothing open or scheduled this month' : `${monthOpen} open · ${monthScheduled} scheduled`}
              {month !== today.slice(0, 7) && (
                <> · <button type="button" onClick={() => { setMonth(today.slice(0, 7)); setPickedDay(today); }} className="text-blue-400 hover:text-blue-300 font-medium">Today</button></>
              )}
            </p>
          </div>
          <button type="button" onClick={() => { setMonth(shiftMonth(month, 1)); setPickedDay(''); }} aria-label="Next month" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase text-slate-500 mb-1">
          {WEEKDAYS.map(w => <div key={w}>{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }, (_, i) => <div key={`blank-${i}`} />)}
          {monthDays.map(day => {
            const entries = byDay.get(day) ?? [];
            const open = entries.filter(a => a.status === 'Open').length;
            const booked = entries.length - open;
            const picked = day === pickedDay;
            return (
              <button
                key={day}
                type="button"
                onClick={() => setPickedDay(day)}
                aria-pressed={picked}
                aria-label={`${longDay(day)}: ${entries.length ? `${open} open, ${booked} scheduled` : 'nothing scheduled'}`}
                className={`min-h-[3.25rem] sm:min-h-[4.5rem] rounded-lg border p-1 sm:p-1.5 text-left flex flex-col gap-0.5 transition ${picked ? 'border-blue-500 bg-blue-950/40' : entries.length ? 'border-slate-700 bg-slate-900 hover:border-slate-500' : 'border-slate-800/60 hover:border-slate-700'} ${day < today ? 'opacity-60' : ''}`}>
                <span className={`text-xs font-semibold ${day === today ? 'text-blue-400' : entries.length ? 'text-white' : 'text-slate-600'}`}>{Number(day.slice(8))}</span>
                {open > 0 && <span className="text-[10px] sm:text-[11px] leading-tight rounded px-1 bg-blue-500/15 text-blue-300 truncate">{open}<span className="hidden sm:inline"> open</span></span>}
                {booked > 0 && <span className="text-[10px] sm:text-[11px] leading-tight rounded px-1 bg-emerald-500/15 text-emerald-300 truncate">{booked}<span className="hidden sm:inline"> scheduled</span></span>}
              </button>
            );
          })}
        </div>
      </div>

      {pickedDay && (
        <section aria-label={longDay(pickedDay)} className="space-y-3">
          <div className="flex items-baseline justify-between gap-2 border-b border-slate-800 pb-1.5">
            <h4 className="text-sm font-semibold text-white">{longDay(pickedDay)}</h4>
            {pickedDay >= today && (
              <button type="button" onClick={() => startForm('open', pickedDay)} className="text-xs text-blue-400 hover:text-blue-300 font-medium">+ Open a time this day</button>
            )}
          </div>
          {dayList.length === 0 ? (
            <p className="text-xs text-slate-500 italic">Nothing open or scheduled on this day{assessorFilter ? ` for ${assessorFilter}` : ''}.</p>
          ) : dayList.map(renderCard)}
        </section>
      )}
    </div>
  );
}
