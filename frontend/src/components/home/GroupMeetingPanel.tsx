import { useState } from 'react';
import { CalendarClock, CalendarX, RotateCcw } from 'lucide-react';
import PopupDialog from './PopupDialog';
import { changeGroupMeeting, undoGroupScheduleChange, type GroupScheduleChange } from '../../api';
import { formatDisplayTime } from '../../utils/dates';

// One upcoming meeting of a group the counselor leads, picked on the My Day calendar
export interface Meeting {
  groupid: number | string;
  groupname: string;
  // The meeting's regular date (YYYY-MM-DD) and its schedule time ('5:00 PM')
  date: string;
  time: string;
  // Active clients in the group, for the "N clients get a note" line (null when unknown)
  clients: number | null;
  change?: GroupScheduleChange;
}

interface Props {
  meeting: Meeting;
  today: string;
  onClose: () => void;
  // After a change or undo: the message to show, and the calendar reloads
  onChanged: (message: string) => void;
}

const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};
// '5:00 PM' -> '17:00', for the time box
const to24h = (time: string) => {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time);
  if (!match) return '';
  return `${String((Number(match[1]) % 12) + (match[3] === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[2]}`;
};
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// Cancel or reschedule one meeting (every active client in the group gets a Group Cancel or Group Reschedule case note),
// or undo a change made earlier, which removes those notes. The server checks the counselor leads the group.
export default function GroupMeetingPanel({ meeting, today, onClose, onChanged }: Props) {
  const [action, setAction] = useState<'Cancelled' | 'Rescheduled'>('Cancelled');
  const [newDate, setNewDate] = useState(meeting.date);
  const [newTime, setNewTime] = useState(to24h(meeting.time));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { change } = meeting;
  const clientsText = meeting.clients == null ? 'Each active client in the group' : `${meeting.clients} active client${meeting.clients === 1 ? '' : 's'}`;

  const save = async () => {
    if (saving) return;
    if (action === 'Rescheduled' && (!newDate || !newTime)) return setError('Enter the new date and time.');
    const what = action === 'Cancelled'
      ? `Cancel ${meeting.groupname} on ${longDate(meeting.date)}?`
      : `Move ${meeting.groupname} from ${longDate(meeting.date)} to ${longDate(newDate)} at ${formatDisplayTime(newTime)}?`;
    if (!window.confirm(`${what}\n\n${clientsText} will get a ${action === 'Cancelled' ? 'Group Cancel' : 'Group Reschedule'} case note.`)) return;
    setSaving(true);
    try {
      const result = await changeGroupMeeting(meeting.groupid, {
        originalDate: meeting.date, action, reason,
        ...(action === 'Rescheduled' ? { newDate, newTime } : {}),
      });
      onChanged(`${meeting.groupname} ${action === 'Cancelled' ? 'cancelled' : 'rescheduled'}. Case note added to ${result.notes} client${result.notes === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(errorText(err, 'Failed to change the meeting.'));
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!change || saving) return;
    if (!window.confirm(`Undo the ${change.action === 'Cancelled' ? 'cancel' : 'reschedule'} of ${meeting.groupname} on ${longDate(meeting.date)}? The ${change.notes} case note${change.notes === 1 ? '' : 's'} it added will be removed.`)) return;
    setSaving(true);
    try {
      const result = await undoGroupScheduleChange(change.changeid);
      onChanged(`Undone. ${meeting.groupname} meets on ${longDate(meeting.date)} again; ${result.notesRemoved} case note${result.notesRemoved === 1 ? '' : 's'} removed.`);
    } catch (err) {
      setError(errorText(err, 'Failed to undo the change.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PopupDialog
      title={meeting.groupname}
      subtitle={`${longDate(meeting.date)}${meeting.time ? ` at ${meeting.time}` : ''}`}
      busy={saving}
      onClose={onClose}>

      {change ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-200">
            {change.action === 'Cancelled'
              ? 'This meeting is cancelled.'
              : `This meeting was moved to ${longDate(change.newdate || '')} at ${formatDisplayTime(change.newtime || '')}.`}
            {change.reason && <span className="text-slate-400"> Reason: {change.reason}</span>}
          </p>
          <p className="text-xs text-slate-400">{change.notes} client case note{change.notes === 1 ? '' : 's'} added.</p>
          {meeting.date >= today ? (
            <button type="button" onClick={undo} disabled={saving} className="bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
              <RotateCcw size={13} /> Undo {change.action === 'Cancelled' ? 'Cancel' : 'Reschedule'}
            </button>
          ) : (
            <p className="text-xs text-slate-500 italic">The meeting date has passed, so this can't be undone.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div role="group" aria-label="Change" className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 w-fit">
            {(['Cancelled', 'Rescheduled'] as const).map(a => (
              <button key={a} type="button" onClick={() => { setAction(a); setError(''); }} aria-pressed={action === a}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold ${action === a ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {a === 'Cancelled' ? <><CalendarX size={13} /> Cancel</> : <><CalendarClock size={13} /> Reschedule</>}
              </button>
            ))}
          </div>
          {action === 'Rescheduled' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="meeting-new-date" className="block text-xs text-slate-400 uppercase mb-1">New Date</label>
                <input id="meeting-new-date" type="date" min={today} value={newDate} onChange={e => { setNewDate(e.target.value); setError(''); }} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label htmlFor="meeting-new-time" className="block text-xs text-slate-400 uppercase mb-1">New Time</label>
                <input id="meeting-new-time" type="time" value={newTime} onChange={e => { setNewTime(e.target.value); setError(''); }} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" />
              </div>
            </div>
          )}
          <div>
            <label htmlFor="meeting-reason" className="block text-xs text-slate-400 uppercase mb-1">Reason <span className="normal-case text-slate-500">(optional, goes in the note)</span></label>
            <input id="meeting-reason" type="text" maxLength={300} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Weather, counselor out sick" className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm placeholder-slate-500" />
          </div>
          <p className="text-xs text-slate-400">{clientsText} will get a {action === 'Cancelled' ? 'Group Cancel' : 'Group Reschedule'} case note on their account.</p>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-1.5 rounded text-xs font-semibold">Close</button>
            <button type="button" onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-1.5 rounded text-xs font-semibold">
              {saving ? 'Saving...' : action === 'Cancelled' ? 'Cancel Meeting' : 'Reschedule Meeting'}
            </button>
          </div>
        </div>
      )}
      {change && error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    </PopupDialog>
  );
}
