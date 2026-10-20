import { useState } from 'react';
import { Check } from 'lucide-react';
import { useGroupCheckIn } from '../../hooks/useGroupCheckIn';
import type { ClientRecord, GroupRecord } from '../../hooks/useGroupCheckIn';
import CheckInStep from './CheckInStep';
import ReviewStep from './ReviewStep';
import ClientSearchModal from './ClientSearchModal';
import CheckInOptionsDialog from './CheckInOptionsDialog';

interface Props {
  groups: GroupRecord[];
  clients: ClientRecord[];
  createdBy: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  onSaved: () => void;
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

export default function GroupCheckInWorkflow({ groups, clients, createdBy, onSuccess, onError, onSaved }: Props) {
  const wf = useGroupCheckIn(createdBy, { onSuccess, onError, onSaved });
  const [searchOpen, setSearchOpen] = useState(false);

  const group = groups.find(g => g.groupid === wf.groupId) ?? null;
  const currentStep = wf.groupId === null ? 1 : wf.view === 'review' ? 3 : 2;

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
            wf.selectGroup(id);
          }}
          disabled={wf.submitting || wf.view === 'review'}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm"
        >
          <option value="">-- Choose Group --</option>
          {groups.map(g => (
            <option key={g.groupid} value={g.groupid}>{g.groupname}</option>
          ))}
        </select>
      </section>

      {/* Steps 2 and 3 stay hidden until a group is chosen */}
      {group && wf.view === 'checkin' && (
        <CheckInStep group={group} wf={wf} onOpenSearch={() => setSearchOpen(true)} />
      )}
      {group && wf.view === 'review' && (
        <ReviewStep group={group} wf={wf} createdBy={createdBy} onSuccess={onSuccess} onError={onError} onSaved={onSaved} />
      )}

      {searchOpen && (
        <ClientSearchModal
          clients={clients}
          checkedInIds={wf.checkedInIds}
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
