import { useState } from 'react';
import { Users } from 'lucide-react';
import { EditConflictError, updateClient } from '../../api';
import { errorMessage } from '../../utils/errors';
import { groupAssignmentPayload, groupChoicesFor } from '../../utils/groupAssignment';
import ScrollLock from '../ScrollLock';

export interface AssignGroupClient {
  clientid: number;
  name: string;
  groupid?: number | null;
  programtype?: string | null;
  phase?: string | null;
  treatmentfee?: number | string | null;
}

export interface AssignGroupOption {
  groupid: number;
  groupname: string;
  programtype?: string | null;
  schedule?: string | null;
  counselor?: string | null;
  active?: boolean | null;
}

interface Props {
  // What the assessment was (shown in the question)
  assessmentName: string;
  client: AssignGroupClient;
  groups: AssignGroupOption[];
  user: { employeeemail: string };
  // message: what was saved, or null when skipped
  onDone: (message: string | null) => void;
}

// Asked after a BIP Intake, BIP Reinstate or DV Assessment is completed: put the client in a group now, or skip.
// Saves the same way as the Group field on the client's Information tab (joining from no group sets the treatment fee).
export default function AssignGroupPrompt({ assessmentName, client, groups, user, onDone }: Props) {
  const choices = groupChoicesFor(groups, client);
  const current = groups.find(g => g.groupid === client.groupid);
  const [groupId, setGroupId] = useState<string>(client.groupid ? String(client.groupid) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const picked = choices.find(g => String(g.groupid) === groupId);
  const unchanged = !!picked && picked.groupid === client.groupid;

  const assign = async () => {
    if (!picked) { setError('Choose a group, or Skip.'); return; }
    setSaving(true);
    setError('');
    try {
      await updateClient(client.clientid, { ...groupAssignmentPayload(client, picked.groupid), updatedBy: user.employeeemail });
      onDone(`${client.name} assigned to ${picked.groupname}.`);
    } catch (err) {
      setError(err instanceof EditConflictError
        ? `Not saved: ${client.name}'s group was changed on another screen. Check the client's Information tab.`
        : errorMessage(err, 'Failed to assign the group.'));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="assign-group-title">
      <ScrollLock />
      <div className="bg-slate-900 border border-blue-500/40 rounded-xl p-6 w-full max-w-md max-h-full overflow-y-auto space-y-4 text-sm">
        <div>
          <h3 id="assign-group-title" className="font-semibold text-white flex items-center gap-2"><Users size={18} className="text-blue-400" /> Assign to a Group?</h3>
          <p className="text-xs text-slate-400 mt-1">
            The {assessmentName} for <span className="text-emerald-400 font-semibold">{client.name}</span> is completed.
            {current ? <> They are in <span className="text-white font-semibold">{current.groupname}</span>.</> : ' They are not in a group yet.'}
            {' '}Choose a group now, or Skip and set it later on the client's Information tab.
          </p>
        </div>

        <div>
          <label htmlFor="assign-group" className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Group <span className="normal-case font-normal text-slate-500">(optional)</span></label>
          <select id="assign-group" value={groupId} onChange={e => { setGroupId(e.target.value); setError(''); }} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
            <option value="">-- Choose a group --</option>
            {choices.map(g => (
              <option key={g.groupid} value={g.groupid}>
                {g.groupname}{g.schedule ? ` · ${g.schedule}` : ''}{g.counselor ? ` · ${g.counselor}` : ''}{g.active === false ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
          {choices.length === 0 && <p className="text-xs text-amber-300 mt-1.5">No active groups take {client.programtype || 'this client\'s'} clients.</p>}
        </div>

        {error && <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500 rounded-lg p-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={() => onDone(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-4 py-2 rounded-lg text-sm">Skip</button>
          <button type="button" disabled={saving || !picked || unchanged} onClick={assign} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg text-sm">
            {saving ? 'Assigning...' : 'Assign to Group'}
          </button>
        </div>
      </div>
    </div>
  );
}
