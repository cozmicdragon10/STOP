import { useEffect, useState } from 'react';
import { ClipboardCheck, X } from 'lucide-react';
import { getPendingNotes, reviewClientNote } from '../../api';
import type { PendingNote } from '../../api';
import { caseNoteLabel } from '../../utils/notes';
import { toLocalDay } from '../../utils/dates';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';

interface Props {
  userEmail: string;
  // Changes whenever a note goes to or comes out of the approval list elsewhere (the Case Notes tab), to refetch
  refreshKey: number;
  onOpenClient: (clientId: number) => void;
  // A note here was approved or denied
  onChanged: () => void;
  onSuccess: (message: string) => void;
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// Business Administrators only: a button with the count of case notes awaiting approval, opening the list grouped by
// client. Each note's text can be edited before approving; Deny takes it off the account.
export default function PendingNotesButton({ userEmail, refreshKey, onOpenClient, onChanged, onSuccess }: Props) {
  const employeeLabel = useEmployeeLabel();
  const [notes, setNotes] = useState<PendingNote[]>([]);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  // Edited text per note, kept until it's approved
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ noteId: number; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPendingNotes()
      .then(data => { if (!cancelled) { setNotes(data); setLoadError(''); } })
      .catch(err => { if (!cancelled) setLoadError(errorText(err, 'Failed to load the notes awaiting approval.')); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const byClient: { clientId: number; name: string; note: PendingNote; notes: PendingNote[] }[] = [];
  for (const n of notes) {
    const last = byClient[byClient.length - 1];
    if (last?.clientId === n.client) last.notes.push(n);
    else byClient.push({ clientId: Number(n.client), name: `${n.lastname}, ${n.firstname}`, note: n, notes: [n] });
  }

  const review = async (note: PendingNote, decision: 'approve' | 'deny') => {
    if (decision === 'deny' && !window.confirm(`Deny this note on ${note.lastname}, ${note.firstname}'s account? It will no longer show on the account.`)) return;
    setBusy(note.noteid);
    setRowError(null);
    try {
      const draft = drafts[note.noteid];
      await reviewClientNote(note.noteid, { decision, user: userEmail, ...(decision === 'approve' && draft !== undefined ? { comments: draft } : {}) });
      setNotes(list => list.filter(n => n.noteid !== note.noteid));
      setDrafts(d => { const next = { ...d }; delete next[note.noteid]; return next; });
      onSuccess(`Case note for ${note.lastname}, ${note.firstname} ${decision === 'approve' ? 'approved' : 'denied'}.`);
      onChanged();
    } catch (err) {
      setRowError({ noteId: note.noteid, message: errorText(err, 'Failed to review the note.') });
    } finally {
      setBusy(null);
    }
  };

  const openAccount = (clientId: number) => {
    setOpen(false);
    onOpenClient(clientId);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={loadError || 'Case notes awaiting your approval'}
        className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${notes.length > 0 ? 'bg-amber-500/10 border-amber-500/50 text-amber-300 hover:bg-amber-500/20' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
      >
        <ClipboardCheck size={14} /> Notes to Approve
        <span className={`rounded-full px-1.5 text-[10px] leading-4 ${notes.length > 0 ? 'bg-amber-500 text-slate-950' : 'bg-slate-700 text-slate-300'}`}>{loadError ? '!' : notes.length}</span>
      </button>

      {open && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-3xl my-8" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-4 p-5 border-b border-slate-800">
              <div>
                <h3 className="font-semibold text-white">Case Notes Awaiting Approval</h3>
                <p className="text-xs text-slate-400 mt-0.5">Notes counselors wrote for clients who hadn't attended that month. Edit a note before approving it if needed; a denied note is taken off the account.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 hover:text-white p-1 rounded bg-slate-800"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-5">
              {loadError && <p className="text-xs text-red-400">{loadError}</p>}
              {!loadError && byClient.length === 0 && <p className="text-sm text-slate-500 text-center py-6">No case notes are waiting for approval.</p>}
              {byClient.map(group => (
                <div key={group.clientId} className="space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <button type="button" onClick={() => openAccount(group.clientId)} className="font-semibold text-white hover:text-blue-400" title="Open client account">{group.name}</button>
                    <span className="text-xs text-slate-500">
                      {[group.note.docnumber && `DOC ${group.note.docnumber}`, group.note.programtype,
                        `Last attended ${group.note.lastattended ? toLocalDay(group.note.lastattended).toLocaleDateString() : 'never'}`].filter(Boolean).join(' · ')}
                    </span>
                    <span className="ml-auto text-xs text-amber-400">{group.notes.length} note{group.notes.length === 1 ? '' : 's'}</span>
                  </div>
                  {group.notes.map(n => {
                    const text = drafts[n.noteid] ?? n.comments ?? '';
                    return (
                      <div key={n.noteid} className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                        <div className="flex flex-wrap justify-between gap-2 text-xs">
                          <span className="text-blue-400 font-semibold">{caseNoteLabel(n)}</span>
                          <span className="text-slate-500">{n.date ? new Date(n.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''} · {employeeLabel(n.User)}</span>
                        </div>
                        <textarea
                          value={text}
                          onChange={e => setDrafts(d => ({ ...d, [n.noteid]: e.target.value }))}
                          rows={Math.min(8, Math.max(2, text.split('\n').length + 1))}
                          aria-label="Note text"
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
                        />
                        {rowError?.noteId === n.noteid && <p className="text-xs text-red-400">{rowError.message}</p>}
                        <div className="flex justify-end items-center gap-2">
                          {drafts[n.noteid] !== undefined && drafts[n.noteid] !== n.comments && <span className="mr-auto text-[11px] text-slate-500 italic">Edited; your changes are saved when you approve.</span>}
                          <button type="button" disabled={busy === n.noteid} onClick={() => review(n, 'deny')} className="bg-slate-800 hover:bg-red-600 border border-slate-700 disabled:opacity-50 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">Deny</button>
                          <button type="button" disabled={busy === n.noteid || !text.trim()} onClick={() => review(n, 'approve')} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">{busy === n.noteid ? 'Saving…' : 'Approve'}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
