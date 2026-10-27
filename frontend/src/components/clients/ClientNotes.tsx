import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Pencil, PlusCircle, SlidersHorizontal, Trash2 } from 'lucide-react';
import { addClientNote, deleteClientNote, getClientNotes, reviewClientNote, updateClientNote } from '../../api';
import RecordFilterBar from './RecordFilterBar';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';
import { caseNoteLabel } from '../../utils/notes';
import { EMPTY_NOTE_FILTERS, sortedUnique } from '../../utils/filters';
import { formatLogMonthDay, formatLogTime, formatLogYear, localYmd } from '../../utils/dates';

/* eslint-disable @typescript-eslint/no-explicit-any -- note rows are untyped throughout App */
interface Props {
  clientId: number;
  user: { employeeemail: string; role: string };
  // Loaded by App with the rest of the account; other account actions (status changes, payments) add notes too
  notes: any[];
  setNotes: Dispatch<SetStateAction<any[]>>;
  // A note went to, or came out of, the approval list; refreshes the count on the Client Directory
  onApprovalChanged?: () => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// The note types a new note can be filed under (the others are written by the system); the server checks too
const NEW_NOTE_CATEGORIES = [
  { value: 'Admin', label: 'Admin Note' },
  { value: 'Therapist', label: 'Therapist Note' },
];
// Starting choice: office roles write admin notes, counselors and therapists write therapist notes
const defaultNoteCategory = (role: string) => (role === 'Business Administrator' || role === 'Office Admin' ? 'Admin' : 'Therapist');

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// The Case Notes tab of a client's account: filters, the new-note form, and in-place edit and delete
export default function ClientNotes({ clientId, user, notes, setNotes, onApprovalChanged }: Props) {
  const isBusinessAdmin = user.role === 'Business Administrator';
  const employeeLabel = useEmployeeLabel();
  // Shown above the list after a Counselor's note is sent for approval
  const [pendingNotice, setPendingNotice] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [filters, setFilters] = useState(EMPTY_NOTE_FILTERS);
  // The new-note form and the filter row stay closed until their buttons open them
  const [showForm, setShowForm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState(() => defaultNoteCategory(user.role));
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  // Inline edit of one case note; noteError is shown under the note it belongs to
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<{ noteId: number; message: string } | null>(null);

  // Matches the server rule: the note's author or a Business Administrator
  const canChangeNote = (note: { User?: string }) =>
    user.role === 'Business Administrator' || String(note.User || '').trim().toLowerCase() === user.employeeemail.trim().toLowerCase();

  const search = filters.search.trim().toLowerCase();
  const shownNotes = notes.filter(n => {
    const day = localYmd(n.date);
    if (filters.category && n.category !== filters.category) return false;
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    if (search && ![n.comments, n.User, employeeLabel(n.User), caseNoteLabel(n)].some(v => String(v ?? '').toLowerCase().includes(search))) return false;
    return true;
  }).sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    return filters.sort === 'oldest' ? diff : -diff;
  });
  // Filters set but hidden are counted on the button so they aren't forgotten
  const activeFilterCount = [filters.search.trim(), filters.category, filters.from, filters.to].filter(Boolean).length;

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      const saved = await addClientNote(clientId, { user: user.employeeemail, comments: newNoteText, category: newNoteCategory });
      setPendingNotice(saved.approvalstatus === 'Pending');
      if (saved.approvalstatus === 'Pending') onApprovalChanged?.();
      setNewNoteText('');
      setShowForm(false);
      setNotes(await getClientNotes(clientId));
    } catch (err) {
      setAddError(errorText(err, 'Failed to save the note.'));
    } finally {
      setAdding(false);
    }
  };

  const handleSaveNoteEdit = async (noteId: number) => {
    if (!editNoteText.trim()) {
      setNoteError({ noteId, message: 'The note cannot be empty.' });
      return;
    }
    setNoteSaving(true);
    setNoteError(null);
    try {
      const saved = await updateClientNote(noteId, { user: user.employeeemail, comments: editNoteText });
      setNotes(list => list.map(n => (n.noteid === noteId ? saved : n)));
      setEditingNoteId(null);
    } catch (err) {
      setNoteError({ noteId, message: errorText(err, 'Failed to save the note.') });
    } finally {
      setNoteSaving(false);
    }
  };

  // Business Administrators approve or deny a pending note here or from the Client Directory's approval list.
  // A denied note leaves the account.
  const handleReview = async (noteId: number, decision: 'approve' | 'deny') => {
    if (decision === 'deny' && !window.confirm('Deny this case note? It will no longer show on the account.')) return;
    setReviewingId(noteId);
    setNoteError(null);
    try {
      const saved = await reviewClientNote(noteId, { decision, user: user.employeeemail });
      setNotes(list => (decision === 'deny' ? list.filter(n => n.noteid !== noteId) : list.map(n => (n.noteid === noteId ? saved : n))));
      onApprovalChanged?.();
    } catch (err) {
      setNoteError({ noteId, message: errorText(err, 'Failed to review the note.') });
    } finally {
      setReviewingId(null);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!window.confirm('Delete this case note? This cannot be undone.')) return;
    setNoteError(null);
    try {
      await deleteClientNote(noteId, user.employeeemail);
      const removed = notes.find(n => n.noteid === noteId);
      setNotes(list => list.filter(n => n.noteid !== noteId));
      if (editingNoteId === noteId) setEditingNoteId(null);
      if (removed?.approvalstatus === 'Pending') onApprovalChanged?.();
    } catch (err) {
      setNoteError({ noteId, message: errorText(err, 'Failed to delete the note.') });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowForm(show => !show)}
          aria-expanded={showForm}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border ${showForm ? 'bg-blue-500/10 border-blue-500 text-blue-300' : 'bg-blue-600 hover:bg-blue-500 border-transparent text-white'}`}
        >
          <PlusCircle size={14} /> New Note
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(show => !show)}
          aria-expanded={showFilters}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
        >
          <SlidersHorizontal size={13} /> Filters
          {activeFilterCount > 0 && (
            <span className="bg-blue-600 text-white rounded-full px-1.5 text-[10px] leading-4">{activeFilterCount}</span>
          )}
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {shownNotes.length === notes.length ? `${notes.length} notes` : `Showing ${shownNotes.length} of ${notes.length}`}
        </span>
      </div>
      {showForm && (
        <form onSubmit={handleAddNote} className="bg-slate-950 border border-slate-800 p-4 rounded-xl space-y-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Note Type
            <select value={newNoteCategory} onChange={(e) => setNewNoteCategory(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs">
              {NEW_NOTE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <textarea value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)} placeholder="Type case note..." rows={3} autoFocus className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-white text-sm" required />
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowForm(false); setNewNoteText(''); setNewNoteCategory(defaultNoteCategory(user.role)); setAddError(''); }} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold">Cancel</button>
            <button type="submit" disabled={adding} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1"><PlusCircle size={14} /> Save Note</button>
          </div>
        </form>
      )}
      {showFilters && <RecordFilterBar
        search={filters.search}
        onSearch={v => setFilters(f => ({ ...f, search: v }))}
        searchPlaceholder="Note text or author..."
        selects={[
          { label: 'Category', value: filters.category, onChange: v => setFilters(f => ({ ...f, category: v })), allLabel: 'All Categories', options: sortedUnique(notes.map(n => n.category)) },
        ]}
        from={filters.from}
        to={filters.to}
        onFrom={v => setFilters(f => ({ ...f, from: v }))}
        onTo={v => setFilters(f => ({ ...f, to: v }))}
        sort={filters.sort}
        onSort={v => setFilters(f => ({ ...f, sort: v }))}
        sortOptions={[
          { value: 'newest', label: 'Newest First' },
          { value: 'oldest', label: 'Oldest First' },
        ]}
        shown={shownNotes.length}
        total={notes.length}
        onClear={() => setFilters(f => ({ ...EMPTY_NOTE_FILTERS, sort: f.sort }))}
      />}
      {pendingNotice && (
        <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex justify-between gap-3">
          <span>This client hasn't attended this month, so your note was sent to a Business Administrator for approval. It shows on the account in the meantime.</span>
          <button type="button" onClick={() => setPendingNotice(false)} className="shrink-0 text-amber-400 hover:text-white">Dismiss</button>
        </p>
      )}
      {shownNotes.length === 0 && notes.length > 0 && (
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
              <span className="flex items-center gap-2">
                <span className="text-xs text-blue-400 font-semibold">{caseNoteLabel(n)}</span>
                {n.approvalstatus === 'Pending' && (
                  <span className="text-[10px] uppercase font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-400 px-1.5 py-0.5 rounded">Awaiting approval</span>
                )}
                {n.approvalstatus === 'Pending' && isBusinessAdmin && editingNoteId !== n.noteid && (
                  <span className="flex gap-1.5">
                    <button type="button" disabled={reviewingId === n.noteid} onClick={() => handleReview(n.noteid, 'approve')} className="text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-2 py-0.5 rounded">Approve</button>
                    <button type="button" disabled={reviewingId === n.noteid} onClick={() => handleReview(n.noteid, 'deny')} className="text-[11px] font-semibold bg-slate-800 hover:bg-red-600 border border-slate-700 disabled:opacity-50 text-slate-200 px-2 py-0.5 rounded">Deny</button>
                  </span>
                )}
              </span>
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
              — {employeeLabel(n.User)}
              {n.editedon && <span className="italic"> · edited {new Date(n.editedon).toLocaleString()}{n.editedby && n.editedby !== n.User ? ` by ${employeeLabel(n.editedby)}` : ''}</span>}
              {n.approvalstatus === 'Approved' && n.reviewedon && <span className="italic"> · approved {new Date(n.reviewedon).toLocaleString()}{n.reviewedby ? ` by ${employeeLabel(n.reviewedby)}` : ''}</span>}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
