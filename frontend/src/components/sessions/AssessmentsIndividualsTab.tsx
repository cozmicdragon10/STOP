import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Hourglass, MessageSquare, PlayCircle, Trash2 } from 'lucide-react';
import AssessmentCalendar from './AssessmentCalendar';
import AssessmentBeginForm from './AssessmentBeginForm';
import AssessmentWorkspace from './AssessmentWorkspace';
import type { AssignGroupOption } from './AssignGroupPrompt';
import { useEmployeeLabel } from '../../hooks/useEmployeeLabel';
import {
  deleteOpenIndividualSession, getAssessmentsInProgress, getClosedIndividualSessions, getOpenIndividualSessions, getSessionTypes,
} from '../../api';
import type { AssessmentInProgress, ClosedIndividualSession, OpenIndividualSession, SessionType } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { ASSESSMENT_ADMIN_ROLES, LONG_OPEN_DAYS, daysOpenText } from '../../utils/assessmentWork';

interface TabClient {
  clientid: number;
  firstname: string;
  lastname: string;
  docnumber?: string | null;
  doctype?: string | null;
  programtype?: string | null;
  accountbalance?: number | string | null;
  programstatus?: string | null;
  // The counselor the client is waiting to be assessed by
  assessor?: string | null;
  // Max Debt Override in effect (how much they may owe after an assessment begins)
  maxowed?: number | string | null;
  // For the Assign to a Group question after a BIP intake assessment is completed
  groupid?: number | null;
  phase?: string | null;
  treatmentfee?: number | string | null;
}

interface Employee {
  employeeemail: string;
  displayname: string;
  role: string;
  active?: boolean | null;
}

interface Props {
  // True while the tab is showing; the lists and price list reload each time it is shown
  active: boolean;
  clients: TabClient[];
  // Offered after a BIP Intake, BIP Reinstate or DV Assessment is completed
  groups: AssignGroupOption[];
  employees: Employee[];
  user: { employeeemail: string; displayname?: string; role?: string };
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  // Called after an assessment is begun so balances and Last Attended refresh
  onSaved?: () => void;
}

// What the main area shows: the calendar, the Begin steps (for a scheduled assessment, or a new one), or one assessment
type View =
  | { kind: 'calendar' }
  | { kind: 'begin'; open: OpenIndividualSession | null; clientId?: string; counselor?: string }
  | { kind: 'work'; attendanceId: number };
type PanelTab = 'scheduled' | 'progress' | 'completed';

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const formatDay = (ymd: string) => (ymd === todayLocal() ? 'Today' : new Date(`${ymd}T00:00:00`).toLocaleDateString());

// Assessments: scheduled on the calendar, begun once the payment is taken (the attendance is recorded that day), then
// worked on by the counselor (notes, as often as needed, for days or weeks) until it is completed.
export default function AssessmentsIndividualsTab({ active, clients, groups, employees, user, onSuccess, onError, onSaved }: Props) {
  const employeeLabel = useEmployeeLabel();
  const isAdmin = ASSESSMENT_ADMIN_ROLES.includes(user.role || '');
  const [view, setView] = useState<View>({ kind: 'calendar' });
  const [panelTab, setPanelTab] = useState<PanelTab>('progress');
  const [sessionTypes, setSessionTypes] = useState<SessionType[]>([]);
  const [scheduled, setScheduled] = useState<OpenIndividualSession[]>([]);
  const [inProgress, setInProgress] = useState<AssessmentInProgress[]>([]);
  const [completed, setCompleted] = useState<ClosedIndividualSession[]>([]);
  const [listError, setListError] = useState('');
  // Waiting for Assessment list: one assessor's clients, or everyone's (''); remembered per browser
  const [waitingFor, setWaitingFor] = useState(() => {
    try { return localStorage.getItem('waitingForAssessor') || ''; } catch { return ''; }
  });
  useEffect(() => {
    try { localStorage.setItem('waitingForAssessor', waitingFor); } catch { /* storage unavailable */ }
  }, [waitingFor]);

  const loadLists = useCallback(async () => {
    try {
      const [open, working, closed] = await Promise.all([
        getOpenIndividualSessions(user.employeeemail), getAssessmentsInProgress(), getClosedIndividualSessions(user.employeeemail),
      ]);
      setScheduled(open.filter(o => o.category === 'Assessment'));
      setInProgress(working);
      setCompleted(closed.filter(c => c.category === 'Assessment'));
      setListError('');
    } catch (err) {
      setListError(errorMessage(err, 'Failed to load assessments.'));
    }
  }, [user.employeeemail]);

  useEffect(() => {
    if (!active) return;
    getSessionTypes().then(setSessionTypes).catch(err => setListError(err.message || 'Failed to load the price list.'));
    // loadLists only sets state after its requests finish
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLists();
  }, [active, loadLists]);

  // Only active counselors can be an assessment's counselor
  const counselors = Array.from(new Set(employees
    .filter(e => e.active !== false && e.role === 'Counselor' && e.displayname)
    .map(e => e.displayname))).sort((a, b) => a.localeCompare(b));

  const discard = async (o: OpenIndividualSession) => {
    if (!window.confirm(`Remove the scheduled assessment for ${o.lastname}, ${o.firstname}? Nothing was charged.`)) return;
    try {
      await deleteOpenIndividualSession(o.opensessionid, user.employeeemail);
      if (view.kind === 'begin' && view.open?.opensessionid === o.opensessionid) setView({ kind: 'calendar' });
      onSuccess(`Scheduled assessment for ${o.lastname}, ${o.firstname} removed.`);
      loadLists();
    } catch (err) {
      onError(errorMessage(err, 'Failed to remove the assessment.'));
    }
  };

  // Active clients waiting for an assessment, with how many each assessor has
  const waiting = clients.filter(c => c.assessor && c.programstatus === 'Active')
    .sort((a, b) => `${a.lastname}, ${a.firstname}`.localeCompare(`${b.lastname}, ${b.firstname}`));
  const assessors = Object.entries(waiting.reduce<Record<string, number>>((n, c) => ({ ...n, [c.assessor!]: (n[c.assessor!] || 0) + 1 }), {}))
    .sort(([a], [b]) => a.localeCompare(b));
  const shownWaiting = waitingFor ? waiting.filter(c => c.assessor === waitingFor) : waiting;

  const selectedWork = view.kind === 'work' ? view.attendanceId : null;
  const selectedOpen = view.kind === 'begin' ? view.open?.opensessionid ?? null : null;
  const longOpen = inProgress.filter(a => Number(a.daysopen) > LONG_OPEN_DAYS).length;
  const tabLabel = (t: PanelTab) => t === 'scheduled' ? `Scheduled${scheduled.length ? ` (${scheduled.length})` : ''}`
    : t === 'progress' ? `In Progress${inProgress.length ? ` (${inProgress.length})` : ''}` : 'Completed';
  const empty = (text: string) => <p className="text-sm text-slate-500 bg-slate-950 border border-dashed border-slate-700 rounded-lg p-4 text-center">{text}</p>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2 lg:row-span-2">
        {view.kind === 'calendar' && (
          <AssessmentCalendar
            clients={clients}
            counselors={counselors}
            user={user}
            onNewAssessment={() => setView({ kind: 'begin', open: null })}
            // Assigning or changing a time adds, moves or removes a scheduled assessment
            onSuccess={(message) => { onSuccess(message); loadLists(); }}
            onError={onError}
          />
        )}
        {view.kind === 'begin' && (
          <AssessmentBeginForm
            key={view.open ? `open-${view.open.opensessionid}` : `new-${view.clientId || ''}`}
            clients={clients}
            sessionTypes={sessionTypes}
            counselors={counselors}
            user={user}
            open={view.open}
            startClientId={view.clientId}
            startCounselor={view.counselor}
            onBegun={(attendanceId, message) => {
              onSuccess(message);
              setView({ kind: 'work', attendanceId });
              setPanelTab('progress');
              loadLists();
              onSaved?.();
            }}
            onSaved={(message) => { onSuccess(message); setView({ kind: 'calendar' }); loadLists(); }}
            onCancel={() => setView({ kind: 'calendar' })}
          />
        )}
        {view.kind === 'work' && (
          <AssessmentWorkspace
            key={view.attendanceId}
            attendanceId={view.attendanceId}
            user={user}
            clients={clients}
            groups={groups}
            onBack={() => setView({ kind: 'calendar' })}
            onChanged={loadLists}
            onClientChanged={onSaved}
            onSuccess={onSuccess}
            onError={onError}
          />
        )}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl">
        <h3 className="font-semibold text-white flex items-center gap-2 mb-3"><ClipboardList size={18} className="text-blue-400" /> Assessments</h3>
        <div className="grid grid-cols-3 bg-slate-950 border border-slate-800 rounded-lg p-0.5 mb-3">
          {(['scheduled', 'progress', 'completed'] as const).map(t => (
            <button key={t} type="button" onClick={() => setPanelTab(t)} className={`px-2 py-1 rounded text-xs font-semibold transition ${panelTab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              {tabLabel(t)}
            </button>
          ))}
        </div>

        {listError ? (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{listError}</p>
        ) : panelTab === 'scheduled' ? (
          <>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">Booked from the calendar, not begun yet. Begin one when the client is here and pays.</p>
            {scheduled.length === 0 ? empty('No scheduled assessments.') : (
              <ul className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                {scheduled.map(o => (
                  <li key={o.opensessionid} className={`bg-slate-950 border rounded-lg p-3 ${selectedOpen === o.opensessionid ? 'border-blue-500/60' : 'border-slate-800'}`}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{o.lastname}, {o.firstname}</p>
                        <p className="text-xs text-slate-300 truncate">{o.sessiontypename ?? <span className="text-amber-300">Type not chosen yet</span>}</p>
                        <p className={`text-xs ${o.sessiondate < todayLocal() ? 'text-amber-400' : 'text-slate-400'}`}>{formatDay(o.sessiondate)}{o.provider ? ` · ${o.provider}` : ''}</p>
                      </div>
                      <button type="button" onClick={() => discard(o)} className="text-slate-500 hover:text-red-400 p-1 rounded shrink-0" aria-label={`Remove the scheduled assessment for ${o.lastname}, ${o.firstname}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <button type="button" onClick={() => setView({ kind: 'begin', open: o })} className="mt-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-1.5 rounded-lg flex items-center justify-center gap-1.5">
                      <PlayCircle size={13} /> Begin
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : panelTab === 'progress' ? (
          <>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              Paid and begun, not completed yet{isAdmin ? '' : ' (yours)'}. Open one to add notes or complete it.
              {longOpen > 0 && <span className="text-amber-300"> {longOpen} open more than {LONG_OPEN_DAYS} days.</span>}
            </p>
            {inProgress.length === 0 ? empty('No assessments in progress.') : (
              <ul className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                {inProgress.map(a => {
                  const long = Number(a.daysopen) > LONG_OPEN_DAYS;
                  return (
                    <li key={a.attendanceid}>
                      <button type="button" onClick={() => setView({ kind: 'work', attendanceId: a.attendanceid })} className={`w-full text-left bg-slate-950 border rounded-lg p-3 hover:border-slate-600 transition ${selectedWork === a.attendanceid ? 'border-blue-500/60' : long ? 'border-amber-500/40' : 'border-slate-800'}`}>
                        <div className="flex justify-between items-start gap-2">
                          <p className="text-sm font-semibold text-white truncate">{a.lastname}, {a.firstname}</p>
                          <span className={`shrink-0 text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded ${long ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-800 text-slate-300'}`}>{daysOpenText(Number(a.daysopen))}</span>
                        </div>
                        <p className="text-xs text-slate-300 truncate">{a.sessiontypename}{a.provider ? ` · ${a.provider}` : ''}</p>
                        {a.fundedby && <p className="text-[0.6875rem] text-sky-300">Billed to {a.fundedby}</p>}
                        <p className="text-[0.6875rem] text-slate-500 flex items-center gap-1 mt-0.5">
                          <MessageSquare size={11} />
                          {a.notecount ? `${a.notecount} note${a.notecount === 1 ? '' : 's'} · last ${new Date(a.lastnoteon!).toLocaleDateString()}` : 'No notes yet'}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">{user.role === 'Business Administrator' ? 'Recently completed assessments.' : 'Recently completed assessments you began, completed, or were the counselor on.'}</p>
            {completed.length === 0 ? empty('No completed assessments.') : (
              <ul className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
                {completed.map(c => (
                  <li key={c.attendanceid}>
                    <button type="button" onClick={() => setView({ kind: 'work', attendanceId: c.attendanceid })} className={`w-full text-left bg-slate-950 border rounded-lg p-3 hover:border-slate-600 transition ${selectedWork === c.attendanceid ? 'border-blue-500/60' : 'border-slate-800'}`}>
                      <p className="text-sm font-semibold text-white truncate">{c.lastname}, {c.firstname}</p>
                      <p className="text-xs text-slate-300 truncate">{c.sessiontypename || 'Assessment'}{c.provider ? ` · ${c.provider}` : ''}{c.fundedby ? ` · ${c.fundedby}` : ''}</p>
                      <p className="text-[0.6875rem] text-slate-500">
                        Begun {formatDay(c.sessiondate)}
                        {c.closedon ? ` · completed ${new Date(c.closedon).toLocaleDateString()}` : ''}
                        {c.closedby ? ` by ${employeeLabel(c.closedby)}` : ''}
                        {c.notecount ? ` · ${c.notecount} note${c.notecount === 1 ? '' : 's'}` : ''}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Clients waiting to be assessed, by the counselor they are waiting for (set on the client's Information tab;
          beginning an assessment for the client takes them off) */}
      <div className="lg:col-start-3 bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl">
        <h3 className="font-semibold text-white flex items-center gap-2 mb-3"><Hourglass size={18} className="text-blue-400" /> Waiting for Assessment{shownWaiting.length ? ` (${shownWaiting.length})` : ''}</h3>
        <label htmlFor="waiting-assessor" className="sr-only">Assessor</label>
        <select id="waiting-assessor" value={waitingFor} onChange={e => setWaitingFor(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm mb-3">
          <option value="">All assessors ({waiting.length})</option>
          {assessors.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
        </select>
        {shownWaiting.length === 0 ? empty('No clients are waiting for an assessment.') : (
          <ul className="space-y-2 max-h-[32rem] overflow-y-auto pr-1">
            {shownWaiting.map(c => (
              <li key={c.clientid} className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex justify-between items-center gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{c.lastname}, {c.firstname}</p>
                  <p className="text-xs text-slate-400 truncate">{c.programtype || 'No program'}{waitingFor ? '' : ` · ${c.assessor}`}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setView({ kind: 'begin', open: null, clientId: String(c.clientid), counselor: c.assessor || undefined })}
                  title="Begin an assessment for this client now"
                  className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
                >Start</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
