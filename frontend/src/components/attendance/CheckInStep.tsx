import { Save, Search, Trash2 } from 'lucide-react';
import type { ClientRecord, GroupRecord, GroupCheckInState } from '../../hooks/useGroupCheckIn';
import { formatBalance } from '../../utils/balance';
import { SO_PHASES, SO_TREATMENT_FEES } from '../../utils/soPhases';

interface Props {
  group: GroupRecord;
  wf: GroupCheckInState;
  onOpenSearch: () => void;
}

const buttonBase = 'px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';
const primaryButton = `${buttonBase} bg-blue-600 hover:bg-blue-500 text-white`;
const secondaryButton = `${buttonBase} bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700`;

function RosterCard({ client, checked, attended, selected, onToggle }: {
  client: ClientRecord;
  checked: boolean;
  // Already attended this group today, so cannot be checked in again
  attended: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const tone = checked
    ? 'border-emerald-500/30 bg-emerald-500/5 opacity-70 cursor-default'
    : attended
      ? 'border-slate-800 bg-slate-950 opacity-50 cursor-not-allowed'
    : selected
      ? 'border-blue-500 bg-blue-500/10 cursor-pointer'
      : 'border-slate-700 bg-slate-950 hover:border-slate-500 cursor-pointer';

  return (
    <label className={`flex items-start gap-3 p-3 rounded-lg border transition ${tone}`}>
      <input
        type="checkbox"
        checked={checked || (selected && !attended)}
        disabled={checked || attended}
        onChange={onToggle}
        className="mt-1 accent-blue-500"
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-white truncate">{client.lastname}, {client.firstname}</p>
        <p className="text-xs text-slate-400">DOC # {client.docnumber || '—'} · Bal {formatBalance(client.accountbalance)}</p>
        {checked && <span className="inline-block mt-1 text-[10px] font-semibold uppercase text-emerald-400">Checked in</span>}
        {!checked && attended && <span className="inline-block mt-1 text-[10px] font-semibold uppercase text-amber-400">Already attended today</span>}
      </div>
    </label>
  );
}

function RosterSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Loading clients" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse h-16 rounded-lg bg-slate-800/60" />
      ))}
    </div>
  );
}

export default function CheckInStep({ group, wf, onOpenSearch }: Props) {
  // SO groups show the phase fee schedule for State and Federal SO clients
  const showPhaseFees = ['SO', 'FED SO'].includes((group.programtype || '').trim().toUpperCase());
  const selectableSelected = wf.selectableRoster.filter(c => wf.selectedIds.has(c.clientid)).length;
  const rosterReady = wf.rosterStatus === 'ready';
  const canToggleAll = rosterReady && wf.selectableRoster.length > 0;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5 shadow-xl">
      <header className="flex flex-wrap justify-between gap-2 items-baseline">
        <h3 className="font-semibold text-white">{group.groupname}</h3>
        <p className="text-xs text-slate-400">
          {wf.roster.length} assigned · {wf.session.length} on this sheet
        </p>
      </header>

      {/* Toolbar: bulk selection + check-in actions */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <button type="button" onClick={wf.toggleSelectAll} disabled={!canToggleAll} className={secondaryButton}>
          {wf.allSelected ? 'Deselect All' : 'Select All'}
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOpenSearch} className={`${secondaryButton} flex items-center gap-2`}>
            <Search size={14} /> Check In Client From Another Group
          </button>
          <button type="button" onClick={wf.checkInSelected} disabled={selectableSelected === 0} className={primaryButton}>
            Check In Selected{selectableSelected > 0 ? ` (${selectableSelected})` : ''}
          </button>
        </div>
      </div>

      {/* Each client is charged the treatment fee on their own account; this is the reference schedule for SO groups */}
      {showPhaseFees && (
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300">
          <p className="text-slate-500 uppercase text-[10px] font-semibold tracking-wide mb-1">State / Federal SO phase fees</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {SO_PHASES.map(phase => (
              <li key={phase} className="flex justify-between gap-4 text-slate-300">
                <span>{phase}</span>
                <span className="font-semibold text-white">${SO_TREATMENT_FEES[phase].toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Assigned roster */}
      <div className="space-y-3">
        <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide">Assigned clients</p>

        {wf.rosterStatus === 'loading' || wf.rosterStatus === 'idle' ? (
          <RosterSkeleton />
        ) : wf.rosterStatus === 'error' ? (
          <div className="bg-red-500/10 border border-red-500/40 text-red-400 p-4 rounded-lg text-sm flex justify-between items-center gap-3">
            <span>{wf.rosterError}</span>
            <button type="button" onClick={wf.reloadRoster} className={secondaryButton}>Retry</button>
          </div>
        ) : wf.roster.length === 0 ? (
          <div className="bg-slate-950 border border-dashed border-slate-700 rounded-lg p-6 text-center text-sm text-slate-400">
            No clients are currently assigned to {group.groupname}. Use “Check In Client From Another Group” to add someone to this session.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {wf.roster.map(c => (
              <RosterCard
                key={c.clientid}
                client={c}
                checked={wf.checkedInIds.has(c.clientid)}
                attended={wf.attendedIds.has(c.clientid)}
                selected={wf.selectedIds.has(c.clientid)}
                onToggle={() => wf.toggleSelect(c.clientid)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Attendance sheet: everyone staged for this session */}
      <div className="space-y-2">
        <p className="text-xs text-slate-400 uppercase font-semibold tracking-wide">Attendance sheet ({wf.session.length})</p>
        {wf.session.length === 0 ? (
          <p className="text-sm text-slate-500">No one has been checked in yet this session.</p>
        ) : (
          <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
            {wf.session.map(e => (
              <li key={e.client.clientid} className="flex justify-between items-center gap-3 px-3 py-2 bg-slate-950 text-sm">
                <span className="text-white truncate">{e.client.lastname}, {e.client.firstname}</span>
                <button
                  type="button"
                  onClick={() => wf.removeEntry(e.client.clientid)}
                  className="text-slate-400 hover:text-red-400 p-1 rounded"
                  aria-label={`Remove ${e.client.firstname} ${e.client.lastname} from sheet`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end pt-2 border-t border-slate-800">
        <button type="button" onClick={wf.finishCheckIn} disabled={wf.session.length === 0 || wf.submitting} className={`${primaryButton} flex items-center gap-2`}>
          <Save size={14} /> {wf.submitting ? 'Saving...' : 'Finish Check-In'}
        </button>
      </div>
    </section>
  );
}
