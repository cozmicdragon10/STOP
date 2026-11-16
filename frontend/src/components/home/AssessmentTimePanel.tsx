import { useState } from 'react';
import { CalendarClock, UserPlus, X, XCircle } from 'lucide-react';
import ClientPicker from '../ClientPicker';
import { assignAssessmentSlot, cancelAssessmentAppointment, updateAssessmentAppointment, type MyAssessment } from '../../api';
import { formatDisplayTime } from '../../utils/dates';

export interface PanelClient {
  clientid: number;
  firstname: string;
  lastname: string;
  programstatus?: string | null;
  docnumber?: string | null;
  doctype?: string | null;
}

interface Props {
  appt: MyAssessment;
  clients: PanelClient[];
  today: string;
  onClose: () => void;
  // After a change: the message to show, and the calendar reloads
  onChanged: (message: string) => void;
}

const longDate = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// One assessment time picked on My Day or the Calendars tab. An open time: assign a client to it. A scheduled one:
// reschedule it (date, time, location) or cancel it. The server checks a counselor only changes their own times.
export default function AssessmentTimePanel({ appt, clients, today, onClose, onChanged }: Props) {
  const isOpen = appt.status === 'Open';
  const [clientId, setClientId] = useState('');
  const [mode, setMode] = useState<'reschedule' | 'cancel'>('reschedule');
  const [date, setDate] = useState(appt.apptdate >= today ? appt.apptdate : today);
  const [time, setTime] = useState(appt.appttime);
  const [location, setLocation] = useState(appt.location || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const client = `${appt.lastname ?? ''}, ${appt.firstname ?? ''}`;
  const when = `${longDate(appt.apptdate)} at ${formatDisplayTime(appt.appttime)}`;
  const pickerClients = clients
    .filter(c => (c.programstatus || '') === 'Active')
    .map(c => ({ clientid: c.clientid, firstname: c.firstname, lastname: c.lastname, docnumber: c.docnumber, doctype: c.doctype }));

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
    if (!date || !time) return setError('Enter the new date and time.');
    if (!location.trim()) return setError('Enter the location.');
    run(() => updateAssessmentAppointment(appt.appointmentid, { assessor: appt.assessor, date, time, location: location.trim(), notes: appt.notes || '' }),
      `${client}'s assessment moved to ${longDate(date)} at ${formatDisplayTime(time)}.`);
  };
  const cancel = () => {
    if (!window.confirm(`Cancel ${client}'s assessment on ${when}?`)) return;
    run(() => cancelAssessmentAppointment(appt.appointmentid), `${client}'s assessment on ${when} was cancelled.`);
  };

  const tabButton = (value: 'reschedule' | 'cancel', label: string, Icon: typeof X) => (
    <button key={value} type="button" onClick={() => { setMode(value); setError(''); }} aria-pressed={mode === value}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold ${mode === value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <section aria-label={isOpen ? 'Assign a client' : 'Cancel or reschedule the assessment'} className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white">{isOpen ? 'Open assessment time' : `Assessment: ${client}`}</h4>
          <p className="text-xs text-slate-400">{when} · {appt.location || 'No location set'} · {appt.assessor}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"><X size={16} /></button>
      </div>

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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="appt-new-date" className="block text-xs text-slate-400 uppercase mb-1">New Date</label>
                  <input id="appt-new-date" type="date" min={today} value={date} onChange={e => { setDate(e.target.value); setError(''); }} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" />
                </div>
                <div>
                  <label htmlFor="appt-new-time" className="block text-xs text-slate-400 uppercase mb-1">New Time</label>
                  <input id="appt-new-time" type="time" value={time} onChange={e => { setTime(e.target.value); setError(''); }} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" />
                </div>
                <div>
                  <label htmlFor="appt-location" className="block text-xs text-slate-400 uppercase mb-1">Location</label>
                  <input id="appt-location" type="text" maxLength={150} value={location} onChange={e => { setLocation(e.target.value); setError(''); }} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-1.5 rounded text-xs font-semibold">Close</button>
                <button type="button" onClick={reschedule} disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold">{saving ? 'Saving...' : 'Reschedule'}</button>
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
    </section>
  );
}
