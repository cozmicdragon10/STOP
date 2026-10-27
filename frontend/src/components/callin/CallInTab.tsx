import { useState } from 'react';
import { submitClientCallIn, submitGroupCallIn } from '../../api';
import ClientPicker from '../ClientPicker';
import GroupPicker from '../GroupPicker';
import { CALL_IN_REASONS } from '../../utils/notes';

interface CallInClient {
  clientid: number;
  firstname: string;
  lastname: string;
  docnumber?: string | null;
  groupid?: number | null;
  programstatus?: string | null;
}

interface CallInGroup {
  groupid: number;
  groupname: string;
  schedule?: string | null;
  location?: string | null;
}

interface Props {
  clients: CallInClient[];
  // Active groups only
  groups: CallInGroup[];
  user: { employeeemail: string };
  // Called after a call-in is saved; shows the message and refreshes the dashboard
  onLogged: (message: string) => void;
}

// Records a call-in for one client, or for every active client in a group
export default function CallInTab({ clients, groups, user, onLogged }: Props) {
  const [mode, setMode] = useState<'client' | 'group'>('client');
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  // Optional, group call-ins only: the day the call-in is for when the group meets on another day
  const [groupCallInDate, setGroupCallInDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Typed text that was never picked from the list leaves no client or group selected
    if (mode === 'client' ? !selectedClient : !selectedGroup) return;
    setSaving(true);
    setError('');
    try {
      let message: string;
      if (mode === 'client') {
        const res = await submitClientCallIn({ client: Number(selectedClient), date: new Date(), comment, createdBy: user.employeeemail, reason: reason || null });
        if (!res?.success) throw new Error(res?.error || 'Could not log the call-in.');
        message = 'Client call-in logged successfully!';
      } else {
        const res = await submitGroupCallIn({ group: Number(selectedGroup), date: new Date(), comment, createdBy: user.employeeemail, reason: reason || null, callInDate: groupCallInDate || null });
        if (!res?.success) throw new Error(res?.error || 'Could not log the group call-in.');
        const forText = res.forDate ? ` for ${new Date(`${res.forDate}T00:00:00`).toLocaleDateString()}` : '';
        message = `Group call-in logged${forText} for ${res.count} active clients!`;
      }
      setComment('');
      setReason('');
      setGroupCallInDate('');
      onLogged(message);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not log the call-in. Check the server is running and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl max-w-2xl mx-auto overflow-hidden">
      <div className="p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Call-In Log</h2>
          <p className="text-xs text-slate-400 mt-1">Record a call-in for one client or for every active client in a group. Entries are saved to the client's notes and event log.</p>
        </div>
        <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0">
          <button type="button" onClick={() => setMode('client')} className={`px-3 py-1.5 rounded text-xs font-semibold transition ${mode === 'client' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Client</button>
          <button type="button" onClick={() => setMode('group')} className={`px-3 py-1.5 rounded text-xs font-semibold transition ${mode === 'group' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Group</button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        {mode === 'client' ? (
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Client</label>
            <ClientPicker
              clients={clients}
              value={selectedClient}
              onChange={setSelectedClient}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm placeholder-slate-500"
            />
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Group</label>
            <GroupPicker
              groups={groups}
              value={selectedGroup}
              onChange={setSelectedGroup}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm placeholder-slate-500"
            />
            {selectedGroup && (
              <p className="text-xs text-slate-500 mt-1.5">
                Will be logged for {clients.filter(c => c.groupid === Number(selectedGroup) && c.programstatus === 'Active').length} active client(s) in this group.
              </p>
            )}
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Call-In Is For <span className="normal-case font-normal text-slate-500">(optional)</span></label>
              <input type="date" value={groupCallInDate} onChange={(e) => setGroupCallInDate(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" />
              <p className="text-xs text-slate-500 mt-1.5">Leave blank for today. Set a date if the group meets on another day. It is still logged today and the date is noted on the entry.</p>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Reason <span className="normal-case font-normal text-slate-500">(optional)</span></label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm">
            <option value="">No reason selected</option>
            {CALL_IN_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Details</label>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-sm" placeholder="What did the client report?" required />
        </div>

        {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex justify-end pt-4 border-t border-slate-800">
          <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-lg text-sm">Submit Call-In</button>
        </div>
      </form>
    </div>
  );
}
