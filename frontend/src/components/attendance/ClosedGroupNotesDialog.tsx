import { useState } from 'react';
import { X } from 'lucide-react';
import { updateClosedGroupNotes } from '../../api';
import type { ClosedGroupSession } from '../../api';
import ScrollLock from '../ScrollLock';

interface Props {
  session: ClosedGroupSession;
  onClose: () => void;
  // Called after a save so the Closed Groups list (and an open client account) can reload
  onSaved: (message: string) => void;
}

// Update Attendance Notes on a closed group: one box per client for the Therapist note made from their attendance
// comment. Saving adds, changes, or removes those case notes (backend routes/openGroups.js); a note keeps its heading
// ("Attendance" or the BIP week, the group, and the date).
export default function ClosedGroupNotesDialog({ session, onClose, onSaved }: Props) {
  const [texts, setTexts] = useState<Record<number, string>>(
    () => Object.fromEntries(session.entries.map(e => [e.attendanceId, e.note ?? '']))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const changes = session.entries
    .filter(e => texts[e.attendanceId].trim() !== (e.note ?? '').trim())
    .map(e => ({ attendanceId: e.attendanceId, text: texts[e.attendanceId].trim(), original: e.note }));

  const save = async () => {
    if (changes.length === 0) return;
    setSaving(true);
    setError('');
    try {
      const r = await updateClosedGroupNotes({
        group: session.groupid, date: session.sessiondate, sessionNumber: session.sessionnumber ?? 1, notes: changes,
      });
      const parts = [
        r.added ? `${r.added} added` : '',
        r.updated ? `${r.updated} updated` : '',
        r.removed ? `${r.removed} removed` : '',
      ].filter(Boolean);
      onSaved(`Attendance notes for ${session.groupname}: ${parts.join(', ') || 'no changes'}.`);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to update the attendance notes.');
      setSaving(false);
    }
  };

  const dateLabel = new Date(`${session.sessiondate}T00:00:00`).toLocaleDateString();

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="closed-group-notes-title">
      <ScrollLock />
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <header className="flex justify-between items-start gap-3 p-4 border-b border-slate-800">
          <div>
            <h3 id="closed-group-notes-title" className="font-semibold text-white">Update Attendance Notes</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {session.groupname} · {dateLabel}{(session.sessionnumber ?? 1) > 1 ? ` · Session ${session.sessionnumber}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="text-slate-400 hover:text-white p-1 rounded" aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="p-4 space-y-4 overflow-y-auto">
          <p className="text-xs text-slate-400">
            Each note is saved to the client's case notes as a Therapist note, labeled as an attendance (BIP clients:
            their BIP week) with the group and date. Clear a box to remove that client's note.
          </p>
          {session.entries.map(e => (
            <label key={e.attendanceId} className="block">
              <span className="text-sm font-medium text-white">{e.name}</span>
              {e.programType === 'BIP' && <span className="ml-2 text-[0.625rem] font-semibold uppercase text-sky-400">BIP</span>}
              <textarea
                rows={2}
                value={texts[e.attendanceId]}
                onChange={ev => setTexts(prev => ({ ...prev, [e.attendanceId]: ev.target.value }))}
                placeholder="Participation, late arrival, concerns..."
                disabled={saving}
                className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none resize-y"
              />
            </label>
          ))}
          {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{error}</p>}
        </div>

        <footer className="flex justify-end gap-3 p-4 border-t border-slate-800">
          <button type="button" onClick={onClose} disabled={saving}
            className="bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-40">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving || changes.length === 0}
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Saving...' : `Save Notes${changes.length ? ` (${changes.length})` : ''}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
