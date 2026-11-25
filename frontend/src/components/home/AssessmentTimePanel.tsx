import { useEffect, useState } from 'react';
import { CalendarClock, UserPlus, XCircle } from 'lucide-react';
import ClientPicker from '../ClientPicker';
import PopupDialog from './PopupDialog';
import {
  assignAssessmentSlot, cancelAssessmentAppointment, getAssessmentAppointments, moveAssessmentAppointment,
  type AssessmentAppointment, type MyAssessment,
} from '../../api';
import { formatDisplayTime } from '../../utils/dates';
import { assessmentPickList } from '../../utils/counselor';
import { askConfirm } from '../../utils/confirm';

export interface PanelClient {
  clientid: number;
  firstname: string;
  lastname: string;
  programstatus?: string | null;
  // The counselor the client is waiting to be assessed by
  assessor?: string | null;
  docnumber?: string | null;
  doctype?: string | null;
}

// An assessment time from My Day or the Assessments calendar
export type PanelAppt = Pick<MyAssessment, 'appointmentid' | 'apptdate' | 'appttime' | 'location' | 'assessor' | 'notes' | 'firstname' | 'lastname'>
  & { status: 'Open' | 'Scheduled' | 'Cancelled' };

interface Props {
  appt: PanelAppt;
  clients: PanelClient[];
  today: string;
  onClose: () => void;
  // After a change: the message to show, and the calendar reloads
  onChanged: (message: string) => void;
}

// How far ahead the counselor's open times are offered for a reschedule
const RESCHEDULE_DAYS_AHEAD = 180;
const addDays = (ymd: string, days: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const longDate = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// One assessment time, as a pop-up. An open time: assign a client to it. A scheduled one: reschedule it by moving the
// client into one of the same counselor's open times (the old time opens up again), or cancel it. The server checks a
// counselor only changes their own times.
export default function AssessmentTimePanel({ appt, clients, today, onClose, onChanged }: Props) {
  const isOpen = appt.status === 'Open';
  const [clientId, setClientId] = useState('');
  const [mode, setMode] = useState<'reschedule' | 'cancel'>('reschedule');
  // The counselor's upcoming open times (null while loading) and the one picked to move to
  const [openTimes, setOpenTimes] = useState<AssessmentAppointment[] | null>(null);
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const client = `${appt.lastname ?? ''}, ${appt.firstname ?? ''}`;
  const when = `${longDate(appt.apptdate)} at ${formatDisplayTime(appt.appttime)}`;
  // Clients waiting to be assessed by this counselor come first
  const pickerClients = assessmentPickList(clients, appt.assessor);

  useEffect(() => {
    if (isOpen) return;
    let cancelled = false;
    getAssessmentAppointments(today, addDays(today, RESCHEDULE_DAYS_AHEAD))
      .then(rows => {
        if (cancelled) return;
        // Today's open times that have already passed aren't offered
        const now = new Date();
        const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        setOpenTimes(rows.filter(r => r.status === 'Open' && r.appointmentid !== appt.appointmentid && sameName(r.assessor, appt.assessor)
          && !(r.apptdate === today && r.appttime <= nowTime)));
      })
      .catch(err => { if (!cancelled) { setOpenTimes([]); setError(errorText(err, 'Failed to load the open times.')); } });
    return () => { cancelled = true; };
  }, [isOpen, today, appt.appointmentid, appt.assessor]);

  const run = async (work: () => Promise<unknown>, message: string) => {
    setSaving(true);
    setError('');
    try {
      await work();
      onChanged(message);
    } catch (err) {
      setError(errorText(err, 'Something went wrong.'));
    } finally {
      setSaving(false);
    }
  };

  const assign = () => {
    if (!clientId) return setError('Choose a client.');
    const picked = clients.find(c => String(c.clientid) === clientId);
    run(() => assignAssessmentSlot(appt.appointmentid, { clientId: Number(clientId), notes: '' }),
      `${picked ? `${picked.lastname}, ${picked.firstname}` : 'Client'} assigned to the assessment on ${when}.`);
  };
  const reschedule = () => {
    const target = openTimes?.find(t => t.appointmentid === moveTo);
    if (!target) return setError('Choose one of the open times.');
    run(() => moveAssessmentAppointment(appt.appointmentid, target.appointmentid),
      `${client}'s assessment moved to ${longDate(target.apptdate)} at ${formatDisplayTime(target.appttime)}. Their old time is open again.`);
  };
  const cancel = async () => {
    if (!(await askConfirm({ title: `Cancel ${client}'s assessment on ${when}?`, confirmLabel: 'Cancel Assessment', cancelLabel: 'Keep', danger: true }))) return;
    run(() => cancelAssessmentAppointment(appt.appointmentid), `${client}'s assessment on ${when} was cancelled.`);
  };

  const tabButton = (value: 'reschedule' | 'cancel', label: string, Icon: typeof XCircle) => (
    <button key={value} type="button" onClick={() => { setMode(value); setError(''); }} aria-pressed={mode === value}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold ${mode === value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <PopupDialog
      title={isOpen ? 'Assign a Client' : `Assessment: ${client}`}
      subtitle={`${when} · ${appt.location || 'No location set'} · ${appt.assessor}`}
      busy={saving}
      onClose={onClose}>
      {isOpen ? (
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs text-slate-400 uppercase mb-1">Assign Client</label>
            <ClientPicker clients={pickerClients} value={clientId} onChange={(id) => { setClientId(id); setError(''); }} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm placeholder-slate-500" />
          </div>
          <button type="button" onClick={assign} disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold flex items-center justify-center gap-1.5">
            <UserPlus size={13} /> {saving ? 'Assigning...' : 'Assign Client'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div role="group" aria-label="Change" className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 w-fit">
            {tabButton('reschedule', 'Reschedule', CalendarClock)}
            {tabButton('cancel', 'Cancel', XCircle)}
          </div>
          {mode === 'reschedule' ? (
            <>
              <p className="text-xs text-slate-400">Move {client} to one of {appt.assessor}'s open times. Their current time opens up again.</p>
              {openTimes === null ? (
                <p className="text-sm text-slate-500">Loading open times…</p>
              ) : openTimes.length === 0 ? (
                <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                  {appt.assessor} has no open times in the next {RESCHEDULE_DAYS_AHEAD / 30} months. Open some on the Assessments tab's Calendar first.
                </p>
              ) : (
                <fieldset className="max-h-64 overflow-y-auto border border-slate-800 rounded-lg divide-y divide-slate-800">
                  <legend className="sr-only">Open times</legend>
                  {openTimes.map(t => (
                    <label key={t.appointmentid} className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer ${moveTo === t.appointmentid ? 'bg-blue-500/10' : 'hover:bg-slate-800/60'}`}>
                      <input type="radio" name="move-to" value={t.appointmentid} checked={moveTo === t.appointmentid} onChange={() => { setMoveTo(t.appointmentid); setError(''); }} className="accent-blue-500" />
                      <span className="text-white">{shortDate(t.apptdate)}</span>
                      <span className="text-slate-300">{formatDisplayTime(t.appttime)}</span>
                      <span className="text-slate-400 truncate">{t.location || 'No location set'}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-1.5 rounded text-xs font-semibold">Close</button>
                <button type="button" onClick={reschedule} disabled={saving || !openTimes?.length} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold">{saving ? 'Moving...' : 'Move to This Time'}</button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">Cancelling keeps it on record; it comes off the calendar.</p>
              <button type="button" onClick={cancel} disabled={saving} className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold">{saving ? 'Cancelling...' : 'Cancel Assessment'}</button>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    </PopupDialog>
  );
}
