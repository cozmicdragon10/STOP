import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { createClient } from '../../api';
import type { SupervisingAgent } from '../../api';
import AgentPicker from '../agents/AgentPicker';
import {
  PROGRAM_STATUSES, EDITABLE_PROGRAM_STATUSES, SO_PROGRAM_TYPES, STATE_FEE_PROGRAM_TYPES, isWholeNumber, formatPhase,
  DEFAULT_CLIENT_FILTERS, SO_ATTENDANCE_LIMIT_MONTHS, isAttendanceOverdue, GROUP_TYPES_BY_PROGRAM,
} from '../../utils/clients';
import { SO_PHASES, SO_TREATMENT_FEES } from '../../utils/soPhases';
import { formatBalance, toDisplayBalance } from '../../utils/balance';

/* eslint-disable @typescript-eslint/no-explicit-any -- client and group rows are untyped throughout App */
interface Props {
  clients: any[];
  // Active groups only; offered on the New Client form
  activeGroups: any[];
  directoryAgents: SupervisingAgent[];
  userEmail: string;
  onOpenClient: (client: any) => void;
  // A client was added; programtype and groupid are what the form saved (App asks about a BIP intake)
  onCreated: (created: { clientId: number; name: string; programtype: string; groupid: string }) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// New client form state. Program status and program type start at the most common values.
// Start date defaults to today's local date, computed each time the form is reset.
const getEmptyNewClient = () => ({
  firstname: '', middlename: '', lastname: '', docnumber: '', supervisingagent: '',
  programstartdate: new Date().toLocaleDateString('en-CA'),
  // Program type starts blank and must be chosen; phase and treatment fee are filled in from it
  programstatus: 'Active', phase: '', programtype: '', groupid: '',
  address: '', city: '', county: '', state: '', zip: '',
  mainphone: '', altphone: '', emergencycontact: '', emergencycontactphone: '', comments: '',
  treatmentfee: 0, vouchers: ''
});
type NewClient = ReturnType<typeof getEmptyNewClient>;
type FilterKey = 'agent' | 'programtype' | 'phase' | 'currentgroup' | 'status';

// The Client Roster tab: searchable, filterable client list and the New Client form. Clicking a row opens the
// client's account (App's drawer).
export default function ClientRoster({ clients, activeGroups, directoryAgents, userEmail, onOpenClient, onCreated, onSuccess, onError }: Props) {
  const [clientSearch, setClientSearch] = useState('');
  const [clientFilters, setClientFilters] = useState(DEFAULT_CLIENT_FILTERS);
  // Filter row is hidden until toggled; the choice is remembered in this browser. Filters still apply while hidden.
  const [showClientFilters, setShowClientFilters] = useState(() => {
    try { return localStorage.getItem('showClientFilters') === 'true'; } catch { return false; }
  });
  const toggleClientFilters = () => setShowClientFilters(show => {
    try { localStorage.setItem('showClientFilters', String(!show)); } catch { /* storage unavailable */ }
    return !show;
  });
  // Filters changed from the defaults, shown on the Filters button so hidden filters aren't forgotten
  const changedClientFilterCount = (Object.keys(DEFAULT_CLIENT_FILTERS) as (keyof typeof DEFAULT_CLIENT_FILTERS)[])
    .filter(key => clientFilters[key] !== DEFAULT_CLIENT_FILTERS[key]).length;

  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClient, setNewClient] = useState(getEmptyNewClient);
  const [saving, setSaving] = useState(false);
  const newClientField = (label: string, key: keyof NewClient, type = 'text', required = false, listId?: string) => (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}{required ? ' *' : ''}</label>
      <input type={type} required={required} list={listId} value={newClient[key]} onChange={(e) => setNewClient({ ...newClient, [key]: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" />
    </div>
  );

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await createClient({ ...newClient, groupid: newClient.groupid || null, createdBy: userEmail });
      onSuccess(res.message || 'Client added successfully!');
      onCreated({
        clientId: res.clientId,
        name: `${newClient.lastname.trim()}, ${newClient.firstname.trim()}`,
        programtype: newClient.programtype,
        groupid: newClient.groupid,
      });
      setNewClient(getEmptyNewClient());
      setShowNewClientForm(false);
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : 'Error adding client.');
    } finally {
      setSaving(false);
    }
  };

  // Client directory search: matches name, DOC #, agent, group, program, phase, and status
  const clientSearchTerm = clientSearch.trim().toLowerCase();
  const clientFilterActive = Object.values(clientFilters).some(Boolean);
  const distinctClientValues = (key: FilterKey): string[] => {
    if (key === 'status') return PROGRAM_STATUSES;
    if (key === 'phase') {
      // SO phases in phase order, then BIP weeks by number, then anything else
      const rank = (p: string) => SO_PHASES.includes(p) ? SO_PHASES.indexOf(p) : isWholeNumber(p) ? 100 + Number(p) : Infinity;
      return Array.from(new Set(clients.map(c => String(c.phase ?? '').trim()).filter(Boolean)))
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    }
    const field = key === 'agent' ? 'supervisingagent' : key === 'currentgroup' ? 'groupname' : 'programtype';
    return Array.from(new Set(clients.map(c => c[field]).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  };
  const filteredClients = clients
    .filter(c => {
      if (clientSearchTerm && ![
        c.firstname, c.lastname, `${c.firstname} ${c.lastname}`, `${c.lastname}, ${c.firstname}`,
        c.docnumber, c.supervisingagent, c.groupname, c.programtype, c.phase, c.programstatus
      ].some(v => String(v ?? '').toLowerCase().includes(clientSearchTerm))) return false;

      if (clientFilters.agent && c.supervisingagent !== clientFilters.agent) return false;
      if (clientFilters.programtype && c.programtype !== clientFilters.programtype) return false;
      if (clientFilters.phase && String(c.phase ?? '').trim() !== clientFilters.phase) return false;
      if (clientFilters.currentgroup && c.groupname !== clientFilters.currentgroup) return false;
      if (clientFilters.status && c.programstatus !== clientFilters.status) return false;
      if (clientFilters.feeoverride === 'active' && (c.activefeeoverride === null || c.activefeeoverride === undefined)) return false;
      if (clientFilters.feeoverride === 'none' && c.activefeeoverride !== null && c.activefeeoverride !== undefined) return false;

      return true;
    });

  const filterSelect = (key: FilterKey, allLabel: string, label: (v: string) => string = v => v) => (
    <select
      value={clientFilters[key]}
      onChange={(e) => setClientFilters({ ...clientFilters, [key]: e.target.value })}
      className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
    >
      <option value="">{allLabel}</option>
      {distinctClientValues(key).map(v => <option key={v} value={v}>{label(v)}</option>)}
    </select>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      <div className="p-5 border-b border-slate-800 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="font-semibold text-white">Active Client Directory</h2>
            <p className="text-xs text-slate-400 mt-0.5">Click any client row to view detailed attendance, ledger, notes, and polygraph logs.</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setShowNewClientForm(s => !s)} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap">+ New Client</button>
            <input
              type="search"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Search name, DOC #, agent, group..."
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs w-64 max-w-full"
            />
            <button
              type="button"
              onClick={toggleClientFilters}
              aria-expanded={showClientFilters}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showClientFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
            >
              <SlidersHorizontal size={13} /> Filters
              {changedClientFilterCount > 0 && (
                <span className="bg-blue-600 text-white rounded-full px-1.5 text-[10px] leading-4">{changedClientFilterCount}</span>
              )}
            </button>
            <span className="text-xs bg-slate-800 px-3 py-1 rounded-full text-slate-300 whitespace-nowrap">
              {filteredClients.length === clients.length ? `${clients.length} Registered Clients` : `${filteredClients.length} of ${clients.length} Clients`}
            </span>
          </div>
        </div>

        {showClientFilters && (
        <div className="flex gap-3 flex-wrap">
          {filterSelect('agent', 'Agent: All')}
          {filterSelect('programtype', 'Program Type: All')}
          {/* BIP clients store a week number as their phase */}
          {filterSelect('phase', 'Phase: All', phase => (isWholeNumber(phase) ? `Week ${phase} (BIP)` : phase))}
          {filterSelect('currentgroup', 'Current Group: All')}
          {filterSelect('status', 'Status: All')}

          <select
            value={clientFilters.feeoverride}
            onChange={(e) => setClientFilters({ ...clientFilters, feeoverride: e.target.value })}
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
          >
            <option value="">Fee Override: All</option>
            <option value="active">Reduced fee active</option>
            <option value="none">No override</option>
          </select>

          {clientFilterActive && (
            <button
              type="button"
              onClick={() => setClientFilters(DEFAULT_CLIENT_FILTERS)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
            >
              Reset Filters
            </button>
          )}
        </div>
        )}
      </div>

      {showNewClientForm && (
        <form onSubmit={handleCreateClient} className="p-5 border-b border-slate-800 bg-slate-950/50 space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Section 1 – Personal Info */}
            <div className="md:col-span-3">
              <h4 className="text-xs font-semibold text-blue-400 uppercase mb-3 tracking-wider">Personal Information</h4>
            </div>
            {newClientField('First Name', 'firstname', 'text', true)}
            {newClientField('Middle Name', 'middlename')}
            {newClientField('Last Name', 'lastname', 'text', true)}
            {newClientField('DOC #', 'docnumber')}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Supervising Agent</label>
              <AgentPicker value={newClient.supervisingagent} onChange={v => setNewClient({ ...newClient, supervisingagent: v })} agents={directoryAgents} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" />
            </div>
            {newClientField('Program Start Date', 'programstartdate', 'date', true)}

            <div>
              <label className="block text-xs text-slate-400 mb-1">Program Status *</label>
              <select required value={newClient.programstatus} onChange={(e) => setNewClient({ ...newClient, programstatus: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm">
                {EDITABLE_PROGRAM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Section 2 – Program & Account Info */}
            <div className="md:col-span-3">
              <h4 className="text-xs font-semibold text-blue-400 uppercase mb-3 tracking-wider">Program &amp; Account Info</h4>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Program Type *</label>
              <select required value={newClient.programtype} onChange={(e) => {
                const programType = e.target.value;
                setNewClient({
                  ...newClient,
                  programtype: programType,
                  phase: SO_PROGRAM_TYPES.includes(programType) ? 'Phase 1 - Weekly' : programType === 'BIP' ? '0' : '',
                  treatmentfee: programType === 'BIP' ? 35 : (STATE_FEE_PROGRAM_TYPES.includes(programType) ? SO_TREATMENT_FEES['Phase 1 - Weekly'] : 0)
                });
              }} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm">
                <option value="">Select a program type...</option>
                <option value="State SO">State SO</option>
                <option value="Federal SO">Federal SO</option>
                <option value="BIP">BIP</option>
                <option value="Voluntary SO">Voluntary SO</option>
                <option value="Poly Only">Poly Only</option>
              </select>
            </div>

            {SO_PROGRAM_TYPES.includes(newClient.programtype) && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Phase</label>
                <select value={newClient.phase} disabled className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm opacity-60 cursor-not-allowed">
                  {SO_PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}

            {newClient.programtype === 'BIP' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Week</label>
                {/* New BIP clients always start at week 0; attendance counts it up */}
                <input type="number" value={newClient.phase} disabled className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm opacity-60 cursor-not-allowed" />
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-400 mb-1">Group</label>
              <select value={newClient.groupid} onChange={(e) => setNewClient({ ...newClient, groupid: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm">
                <option value="">-- None --</option>
                {activeGroups.filter(g => (!GROUP_TYPES_BY_PROGRAM[newClient.programtype || '']
                  || GROUP_TYPES_BY_PROGRAM[newClient.programtype || ''].includes((g.programtype || '').trim().toUpperCase()))
                ).map(g => <option key={g.groupid} value={g.groupid}>{g.groupname}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Treatment Fee</label>
              <input type="number" step="0.01" value={newClient.treatmentfee} onChange={(e) => setNewClient({ ...newClient, treatmentfee: Number(e.target.value) })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" />
            </div>

            {newClientField('Vouchers', 'vouchers', 'number')}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Section 3 – Contact Info */}
            <div className="md:col-span-3">
              <h4 className="text-xs font-semibold text-blue-400 uppercase mb-3 tracking-wider">Contact Information</h4>
            </div>
            {newClientField('Address', 'address')}
            {newClientField('City', 'city')}
            {newClientField('County', 'county')}
            {newClientField('State', 'state')}
            {newClientField('ZIP', 'zip')}
            {newClientField('Main Phone', 'mainphone', 'tel')}
            {newClientField('Alt Phone', 'altphone', 'tel')}
            {newClientField('Emergency Contact', 'emergencycontact')}
            {newClientField('Emergency Phone', 'emergencycontactphone', 'tel')}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Comments</label>
            <textarea value={newClient.comments} onChange={(e) => setNewClient({ ...newClient, comments: e.target.value })} rows={2} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button type="button" onClick={() => { setShowNewClientForm(false); setNewClient(getEmptyNewClient()); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Cancel</button>
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold">Add Client</button>
          </div>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <th className="p-3">Full Name</th>
              <th className="p-3">DOC #</th>
              <th className="p-3">Agent</th>
              <th className="p-3">Program Type</th>
              <th className="p-3">Phase</th>
              <th className="p-3">Current Group</th>
              <th className="p-3">Last Attended</th>
              <th className="p-3">Last Poly</th>
              <th className="p-3">Status</th>
              <th className="p-3">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-sm">
            {filteredClients.map((c) => (
              <tr key={c.clientid} onClick={() => onOpenClient(c)} className="hover:bg-slate-800/50 cursor-pointer transition">
                <td className="p-3 font-medium text-white whitespace-nowrap">{c.lastname}, {c.firstname}</td>
                <td className="p-3 text-slate-400 font-mono text-xs">{c.docnumber}</td>
                <td className="p-3 text-slate-300 text-xs">{c.supervisingagent}</td>
                <td className="p-3"><span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded text-xs font-semibold">{c.programtype || 'State SO'}</span></td>
                <td className="p-3 text-xs"><span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">{formatPhase(c.programtype, c.phase) || 'N/A'}</span></td>
                <td className="p-3 text-slate-300 text-xs">{c.groupname || 'Unassigned'}</td>
                <td
                  className={`p-3 text-xs ${isAttendanceOverdue(c) ? 'text-red-400 font-semibold' : 'text-slate-400'}`}
                  title={isAttendanceOverdue(c) ? `Overdue: more than ${SO_ATTENDANCE_LIMIT_MONTHS[c.phase]} month${SO_ATTENDANCE_LIMIT_MONTHS[c.phase] === 1 ? '' : 's'} since last attended for ${c.phase}` : undefined}
                >
                  {c.lastattended ? new Date(c.lastattended).toLocaleDateString() : 'Never'}
                </td>
                <td className="p-3 text-slate-400 text-xs">{c.programtype === 'BIP' ? '—' : c.lastpoly ? new Date(c.lastpoly).toLocaleDateString() : 'None'}</td>
                <td className="p-3"><span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${c.programstatus === 'Active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`} title={c.programstatus}>{c.programstatus === 'Discharged Supervision' ? 'Discharged' : c.programstatus}</span></td>
                <td className={`p-3 font-semibold ${toDisplayBalance(c.accountbalance) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(c.accountbalance)}</td>
              </tr>
            ))}
            {filteredClients.length === 0 && (
              <tr>
                <td colSpan={10} className="p-6 text-center text-slate-500 text-sm">No clients match your filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
