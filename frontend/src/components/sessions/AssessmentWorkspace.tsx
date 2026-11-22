import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, MessageSquarePlus, Printer } from 'lucide-react';
import { addAssessmentNote, completeAssessment, getAssessment } from '../../api';
import type { AssessmentDetail } from '../../api';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';
import { LONG_OPEN_DAYS, NOTE_MAX, PAPERWORK_KINDS, daysOpenText, paperworkLabel, worksOnAssessment } from '../../utils/assessmentWork';
import { printAttendanceReceipt } from '../../utils/receipt';
import { idText } from '../../utils/clients';
import AssignGroupPrompt from './AssignGroupPrompt';
import type { AssignGroupOption } from './AssignGroupPrompt';

interface Props {
  attendanceId: number;
  user: { employeeemail: string; displayname?: string; role?: string };
  clients: {
    clientid: number; docnumber?: string | null; doctype?: string | null;
    groupid?: number | null; programtype?: string | null; phase?: string | null; treatmentfee?: number | string | null;
  }[];
  // Offered after a BIP Intake, BIP Reinstate or DV Assessment is completed
  groups: AssignGroupOption[];
  onBack: () => void;
  // A note was added or the assessment completed: the lists refresh
  onChanged: () => void;
  // The client was assigned to a group: client records refresh
  onClientChanged?: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const errorMessage = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const longDay = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const stamp = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// One assessment being worked on: what was paid, its notes (newest first), adding a note, and completing it. The
// counselor adds notes as often as needed while it stays open (more sessions, waiting on results or other providers).
export default function AssessmentWorkspace({ attendanceId, user, clients, groups, onBack, onChanged, onClientChanged, onSuccess, onError }: Props) {
  const employeeLabel = useEmployeeLabel();
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [paperwork, setPaperwork] = useState(false);
  const [lastNote, setLastNote] = useState('');
  const [completeError, setCompleteError] = useState('');
  const [savingComplete, setSavingComplete] = useState(false);
  // After a BIP Intake, BIP Reinstate or DV Assessment is completed: offer to put the client in a group
  const [askGroup, setAskGroup] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await getAssessment(attendanceId));
      setLoadError('');
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load the assessment.'));
    }
  }, [attendanceId]);
  useEffect(() => {
    // load only sets state after its request finishes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const inProgress = detail?.assessmentstatus === 'In Progress';
  const canWork = !!detail && worksOnAssessment(user, detail);
  const needsPaperwork = !!detail && PAPERWORK_KINDS.includes(detail.kind);

  const addNote = async () => {
    const text = note.trim();
    if (!text) { setNoteError('Type the note first.'); return; }
    setSavingNote(true);
    setNoteError('');
    try {
      await addAssessmentNote(attendanceId, text, user.employeeemail);
      setNote('');
      onSuccess('Note added to the assessment and the client\'s case notes.');
      await load();
      onChanged();
    } catch (err) {
      setNoteError(errorMessage(err, 'Failed to add the note.'));
    } finally {
      setSavingNote(false);
    }
  };

  const complete = async () => {
    if (!detail) return;
    if (needsPaperwork && !paperwork) { setCompleteError(`Check off: ${paperworkLabel(detail.kind)}.`); return; }
    setSavingComplete(true);
    setCompleteError('');
    try {
      await completeAssessment(attendanceId, { paperworkCompleted: paperwork, comments: lastNote.trim(), user: user.employeeemail });
      onSuccess(`${detail.sessiontypename} completed for ${detail.lastname}, ${detail.firstname}.`);
      setCompleting(false);
      if (needsPaperwork && clients.some(c => c.clientid === detail.clientid)) setAskGroup(true);
      await load();
      onChanged();
    } catch (err) {
      setCompleteError(errorMessage(err, 'Failed to complete the assessment.'));
    } finally {
      setSavingComplete(false);
    }
  };

  const printReceipt = () => {
    if (!detail) return;
    printAttendanceReceipt({
      clientName: `${detail.lastname}, ${detail.firstname}`, docNumber: idText(clients.find(c => c.clientid === detail.clientid)),
      sessionKind: 'Assessment', sessionDate: detail.beganon, provider: detail.provider,
      // On a DHS voucher or invoice the fee goes on the client's account; the payment taken was toward the past due balance
      sessionName: detail.fundedby ? `${detail.sessiontypename} (billed to ${detail.fundedby})` : detail.sessiontypename,
      fee: Number(detail.fee || 0),
      payments: [{ label: detail.fundedby ? 'Past due balance paid' : 'Paid when begun', amount: Number(detail.paid || 0), method: detail.paymentmethod || 'Cash' }],
      clientId: detail.clientid,
    }, onError);
  };

  const input = 'w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm';
  const groupClient = askGroup && detail ? clients.find(c => c.clientid === detail.clientid) : undefined;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl space-y-5">
      <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-3 border-b border-slate-800 pb-4">
        <div className="min-w-0">
          {detail ? (
            <>
              <h2 className="text-lg font-bold text-white flex flex-wrap items-center gap-2">
                {detail.lastname}, {detail.firstname}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${inProgress ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'}`}>
                  {inProgress ? 'In Progress' : 'Completed'}
                </span>
              </h2>
              <p className="text-sm text-slate-300">{detail.sessiontypename}{detail.provider ? ` · ${detail.provider}` : ''}</p>
            </>
          ) : (
            <h2 className="text-lg font-bold text-white">Assessment</h2>
          )}
        </div>
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-950 border border-slate-800 text-slate-300 hover:text-white shrink-0 self-start">
          <CalendarDays size={14} /> Back to Calendar
        </button>
      </div>

      {loadError && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{loadError}</p>}
      {!detail && !loadError && <p className="text-sm text-slate-500">Loading…</p>}

      {detail && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[
              ['Begun', longDay(detail.beganon)],
              [inProgress ? 'Open' : 'Status', inProgress ? daysOpenText(Number(detail.daysopen)).replace(/^Open /, '') : 'Completed'],
              ['Price', money(Number(detail.fundedby ? detail.fundedprice || 0 : detail.fee || 0))],
              detail.fundedby
                ? ['Billed to', detail.fundedby]
                : ['Paid', `${money(Number(detail.paid || 0))}${detail.paymentmethod ? ` ${detail.paymentmethod}` : ''}`],
            ].map(([k, v]) => (
              <div key={k} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <p className="text-[0.6875rem] uppercase tracking-wide text-slate-500">{k}</p>
                <p className={`font-semibold ${k === 'Open' && Number(detail.daysopen) > LONG_OPEN_DAYS ? 'text-amber-300' : 'text-white'}`}>{v}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Begun by {employeeLabel(detail.begunby || '') || 'Unknown'}</span>
            <button type="button" onClick={printReceipt} className="ml-auto bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5"><Printer size={13} /> Print Receipt</button>
          </div>

          {inProgress && canWork && (
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
              <label htmlFor="assessment-note" className="block text-xs font-semibold text-slate-400 uppercase tracking-wide">Add a Note</label>
              <textarea
                id="assessment-note"
                value={note}
                maxLength={NOTE_MAX}
                onChange={e => { setNote(e.target.value); setNoteError(''); }}
                rows={4}
                className={input}
                placeholder="What was done, results received, who you're waiting on…" />
              {noteError && <p role="alert" className="text-xs text-red-400">{noteError}</p>}
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.6875rem] text-slate-500">Also saved to the client's case notes (Assessment).</p>
                <button type="button" onClick={addNote} disabled={savingNote || !note.trim()} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm flex items-center gap-1.5">
                  <MessageSquarePlus size={15} /> {savingNote ? 'Saving...' : 'Add Note'}
                </button>
              </div>
            </div>
          )}

          <section aria-label="Assessment notes" className="space-y-2">
            <h3 className="text-xs font-bold uppercase text-blue-400 tracking-wider">Notes{detail.notes.length ? ` (${detail.notes.length})` : ''}</h3>
            {detail.notes.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-lg p-4 text-center">No notes yet.</p>
            ) : (
              <ol className="space-y-2">
                {detail.notes.map(n => (
                  <li key={n.noteid} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                    <p className="text-[0.6875rem] text-slate-500">
                      {stamp(n.date)} · {employeeLabel(n.User || '') || 'Unknown'}
                      {n.editedon ? ` · edited ${stamp(n.editedon)}` : ''}
                    </p>
                    <p className="text-sm text-slate-200 whitespace-pre-wrap break-words mt-1">{n.comments}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {inProgress && canWork && (
            <div className="border-t border-slate-800 pt-4">
              {!completing ? (
                <div className="flex justify-end">
                  <button type="button" onClick={() => { setCompleting(true); setCompleteError(''); }} className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm flex items-center gap-1.5">
                    <CheckCircle2 size={16} /> Complete Assessment…
                  </button>
                </div>
              ) : (
                <div className="bg-emerald-950/20 border border-emerald-700/40 rounded-lg p-4 space-y-3 text-sm">
                  <p className="font-semibold text-white">Complete the {detail.sessiontypename}</p>
                  <p className="text-xs text-slate-400">
                    It moves to Completed and no more notes can be added here.
                    {needsPaperwork ? ' Completing it clears the client for BIP group check-in.' : ''}
                  </p>
                  {needsPaperwork && (
                    <label className="flex items-start gap-2.5 text-slate-200 cursor-pointer">
                      <input type="checkbox" checked={paperwork} onChange={e => { setPaperwork(e.target.checked); setCompleteError(''); }} className="mt-0.5 accent-emerald-500" />
                      <span>{paperworkLabel(detail.kind)}</span>
                    </label>
                  )}
                  <div>
                    <label htmlFor="assessment-last-note" className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Final Note <span className="normal-case font-normal text-slate-500">(optional)</span></label>
                    <textarea id="assessment-last-note" value={lastNote} maxLength={NOTE_MAX} onChange={e => setLastNote(e.target.value)} rows={2} className={input} placeholder="Outcome or recommendation…" />
                  </div>
                  {completeError && <p role="alert" className="text-xs text-red-400">{completeError}</p>}
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setCompleting(false)} disabled={savingComplete} className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-4 py-2 rounded-lg text-sm">Not Yet</button>
                    <button type="button" onClick={complete} disabled={savingComplete || (needsPaperwork && !paperwork)} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm">
                      {savingComplete ? 'Completing...' : 'Complete Assessment'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {inProgress && !canWork && <p className="text-xs text-slate-500 italic">Only {detail.provider || 'its counselor'} or an administrator can add notes or complete this assessment.</p>}
        </>
      )}

      {detail && groupClient && (
        <AssignGroupPrompt
          assessmentName={detail.sessiontypename}
          client={{ ...groupClient, name: `${detail.lastname}, ${detail.firstname}` }}
          groups={groups}
          user={user}
          onDone={(message) => {
            setAskGroup(false);
            if (message) { onSuccess(message); onClientChanged?.(); }
          }}
        />
      )}
    </div>
  );
}
