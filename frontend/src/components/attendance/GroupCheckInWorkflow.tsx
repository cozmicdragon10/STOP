import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { todayLocal, useGroupCheckIn } from '../../hooks/useGroupCheckIn';
import type { ClientRecord, GroupRecord } from '../../hooks/useGroupCheckIn';
import type { OpenGroupSession } from '../../api';
import CheckInStep from './CheckInStep';
import ReviewStep from './ReviewStep';
import ClientSearchModal from './ClientSearchModal';
import CheckInOptionsDialog from './CheckInOptionsDialog';

interface Props {
  groups: GroupRecord[];
  clients: ClientRecord[];
  createdBy: string;
  // Office Admins and Business Administrators can name a covering counselor when checking a group in
  canPickCover: boolean;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onSaved: () => void;
  // Saved check-ins that have not been closed yet
  openGroups: OpenGroupSession[];
  onOpenGroupsChanged: () => void;
  // Open group picked from the Open Groups panel; cleared with onResumeHandled once loaded
  resumeRequest: OpenGroupSession | null;
  onResumeHandled: () => void;
}

const STEPS = ['Select Group', 'Check In Clients', 'Review & Save'];

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 text-xs font-semibold" aria-label="Attendance progress">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex items-center gap-2 min-w-0">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${
                done ? 'bg-emerald-600 border-emerald-500 text-white'
                  : active ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-slate-900 border-slate-700 text-slate-500'
              }`}
            >
              {done ? <Check size={12} /> : step}
            </span>
            <span className={`truncate ${active ? 'text-white' : done ? 'text-emerald-400' : 'text-slate-500'}`}>{label}</span>
            {i < STEPS.length - 1 && <span className="w-6 h-px bg-slate-700 shrink-0" />}
          </li>
        );
      })}
    </ol>
  );
}

function filterSearchableClients(clients: ClientRecord[], groupType: string | null | undefined, currentGroupName: string | null | undefined): ClientRecord[] {
  // Groups store 'SO' / 'FED SO'; clients store 'State SO' / 'Federal SO' / 'Voluntary SO'
  const normalizedGroupType = (groupType || '').trim().toUpperCase();
  const isSOGroup = ['SO', 'FED SO'].includes(normalizedGroupType);
  const isBIPGroup = normalizedGroupType === 'BIP';

  return clients.filter(c => {
    // Only show active clients
    if (c.programstatus !== 'Active') return false;

    // Don't show clients already in the current group
    if (c.groupname === currentGroupName) return false;

    // If it's an SO group, only show State SO/Federal SO/Voluntary SO clients
    if (isSOGroup) {
      const clientType = (c.programtype || '').trim();
      return ['State SO', 'Federal SO', 'Voluntary SO'].includes(clientType);
    }

    // If it's a BIP group, only show BIP clients
    if (isBIPGroup) {
      const clientType = (c.programtype || '').trim();
      return clientType === 'BIP';
    }

    // For other group types, show all active clients
    return true;
  });
}

export default function GroupCheckInWorkflow({ groups, clients, createdBy, canPickCover, onSuccess, onError, onSaved, openGroups, onOpenGroupsChanged, resumeRequest, onResumeHandled }: Props) {
  const wf = useGroupCheckIn(createdBy, { onSuccess, onError, onSaved, onOpenGroupsChanged });
  const [searchOpen, setSearchOpen] = useState(false);

  const group = groups.find(g => g.groupid === wf.groupId) ?? null;
  const currentStep = wf.groupId === null ? 1 : wf.view === 'review' ? 3 : 2;
  const searchableClients = group ? filterSearchableClients(clients, group.programtype, group.groupname) : [];

  // Saved entries keep the client details from when they were checked in; swap in current balances where we have them
  const resume = (open: OpenGroupSession) => {
    wf.resumeOpenGroup({
      ...open,
      entries: open.entries.map(e => {
        const client = clients.find(c => c.clientid === e.client.clientid) ?? e.client;
        return { ...e, client, balance: Number(client.accountbalance || 0), cardPaid: e.cardPaid ?? 0 };
      }),
    });
  };

  useEffect(() => {
    if (!resumeRequest) return;
    resume(resumeRequest);
    onResumeHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeRequest]);

  // Picking a group that already has an open check-in today picks up that sheet (its latest session) instead of starting over
  const pickGroup = (id: number | null) => {
    const open = id === null ? undefined : openGroups
      .filter(o => o.groupid === id && o.sessiondate === todayLocal())
      .sort((a, b) => (b.sessionnumber ?? 1) - (a.sessionnumber ?? 1))[0];
    if (open) resume(open);
    else wf.selectGroup(id);
  };

  return (
    <div className="space-y-6">
      <StepIndicator current={currentStep} />

      {/* Step 1: group selection */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-3">
        <label htmlFor="attendance-group" className="text-xs text-slate-400 uppercase font-semibold tracking-wide">
          1. Group{wf.view === 'review' && <span className="ml-2 normal-case text-slate-500">(locked during review)</span>}
        </label>
        <select
          id="attendance-group"
          value={wf.groupId ?? ''}
          onChange={e => {
            const id = e.target.value ? Number(e.target.value) : null;
            pickGroup(id);
          }}
          disabled={wf.submitting || wf.view === 'review'}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
        >
          <option value="">-- Choose Group --</option>
          {groups.map(g => (
            <option key={g.groupid} value={g.groupid}>{g.groupname}</option>
          ))}
        </select>
        {wf.sessionDate && wf.sessionDate !== todayLocal() && (
          <p className="text-xs text-amber-400">
            Open check-in from {new Date(`${wf.sessionDate}T00:00:00`).toLocaleDateString()}. Attendance will be saved for that date.
          </p>
        )}
        {group && !wf.sessionChoice && wf.sessionNumber > 1 && (
          <p className="text-xs text-blue-400">Session {wf.sessionNumber} of {group.groupname} today.</p>
        )}
      </section>

      {/* The group was already opened and closed today: a new session, or more clients for the closed one */}
      {group && wf.sessionChoice && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="session-choice-title" className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 id="session-choice-title" className="text-lg font-bold text-white">{group.groupname} was already held today</h3>
            <p className="text-sm text-slate-300">
              {wf.sessionChoice.latestClosed.sessionNumber > 1 ? `Session ${wf.sessionChoice.latestClosed.sessionNumber}` : 'A session'} of this group was
              closed today with {wf.sessionChoice.latestClosed.clients.length} client(s). Is this a new group session, or are you adding clients to the one that was closed?
            </p>
            <div className="space-y-2">
              <button type="button" onClick={() => wf.chooseSession('new')} className="w-full text-left bg-blue-600 hover:bg-blue-500 text-white rounded-lg p-3">
                <p className="font-semibold text-sm">New Group Session</p>
                <p className="text-xs text-blue-100 mt-0.5">Starts session {wf.sessionChoice.nextNumber}. Clients from the earlier session can be checked in again.</p>
              </button>
              <button type="button" onClick={() => wf.chooseSession('existing')} className="w-full text-left bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 rounded-lg p-3">
                <p className="font-semibold text-sm">Add to Closed Session</p>
                <p className="text-xs text-slate-400 mt-0.5">Adds clients to the session already closed. Clients who attended it can't be checked in again.</p>
              </button>
              <button type="button" onClick={() => pickGroup(null)} className="w-full text-center text-xs text-slate-400 hover:text-slate-200 py-2">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Steps 2 and 3 stay hidden until a group is chosen */}
      {group && wf.view === 'checkin' && (
        <CheckInStep group={group} wf={wf} onOpenSearch={() => setSearchOpen(true)} />
      )}
      {group && wf.view === 'review' && (
        <ReviewStep group={group} wf={wf} createdBy={createdBy} canPickCover={canPickCover} onSuccess={onSuccess} onError={onError} onSaved={onSaved} />
      )}

      {searchOpen && (
        <ClientSearchModal
          clients={searchableClients}
          checkedInIds={wf.checkedInIds}
          attendedIds={wf.attendedIds}
          onAdd={wf.addExternalClients}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {wf.pendingCheckIn && (
        <CheckInOptionsDialog
          clients={wf.pendingCheckIn.clients}
          createdBy={createdBy}
          onConfirm={wf.confirmCheckIn}
          onCancel={wf.cancelCheckIn}
          onSuccess={onSuccess}
          onError={onError}
          onProcessed={onSaved}
        />
      )}
    </div>
  );
}
