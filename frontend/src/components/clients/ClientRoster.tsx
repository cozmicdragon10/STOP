import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, EyeOff, SlidersHorizontal } from 'lucide-react';
import { createClient } from '../../api';
import type { SupervisingAgent } from '../../api';
import AgentPicker from '../agents/AgentPicker';
import { useClientsByStatus } from '../../hooks/useClientsByStatus';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../Pagination';
import MultiSelect from '../MultiSelect';
import ColumnPicker from '../ColumnPicker';
import { useColumnLayout } from '../../hooks/useColumnLayout';
import {
  PROGRAM_STATUSES, EDITABLE_PROGRAM_STATUSES, PRETRIAL_PROGRAM_TYPES, SO_PROGRAM_TYPES, STATE_FEE_PROGRAM_TYPES, isWholeNumber, formatPhase,
  DEFAULT_CLIENT_FILTERS, SO_ATTENDANCE_LIMIT_MONTHS, isAttendanceOverdue, GROUP_TYPES_BY_PROGRAM,
} from '../../utils/clients';
import type { ClientFilters } from '../../utils/clients';
import { SO_PHASES, SO_TREATMENT_FEES } from '../../utils/soPhases';
import { formatBalance, toDisplayBalance } from '../../utils/balance';
import { takesPolygraphs } from '../../utils/polygraph';

/* eslint-disable @typescript-eslint/no-explicit-any -- client and group rows are untyped throughout App */
interface Props {
  // Current clients (not discharged); discharged clients are loaded when the status filter asks for them
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
  // Extra buttons in the header, e.g. the Business Administrator's Notes to Approve
  headerActions?: ReactNode;
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
  treatmentfee: 0, vouchers: '', pretrial: false
});
type NewClient = ReturnType<typeof getEmptyNewClient>;
type FilterKey = 'agent' | 'programtype' | 'phase' | 'currentgroup' | 'status';
// Shown, and offered in the Current Group filter, for clients with no group
const UNASSIGNED_GROUP = 'Unassigned';

// SO phases in phase order, then BIP weeks by number, then anything else
const phaseRank = (p: string) => SO_PHASES.includes(p) ? SO_PHASES.indexOf(p) : isWholeNumber(p) ? 100 + Number(p) : Infinity;
const textOrNull = (v: unknown) => String(v ?? '').trim().toLowerCase() || null;
const timeOrNull = (v: unknown) => {
  const t = v ? new Date(String(v)).getTime() : NaN;
  return isNaN(t) ? null : t;
};
// The client fields the roster sorts on
type RosterRow = Partial<Record<'firstname' | 'lastname' | 'docnumber' | 'supervisingagent' | 'programtype' | 'phase' | 'groupname'
  | 'lastattended' | 'lastpoly' | 'programstatus' | 'accountbalance', string | number | null>> & { pretrial?: boolean | null };
// Pretrial applies only to Federal SO and Fed Drug Test clients; null for everyone else
const pretrialValue = (c: RosterRow) => (PRETRIAL_PROGRAM_TYPES.includes(String(c.programtype ?? '')) ? !!c.pretrial : null);
const byName = (a: RosterRow, b: RosterRow) => `${a.lastname}, ${a.firstname}`.localeCompare(`${b.lastname}, ${b.firstname}`);
// What each sortable column sorts on, matching what the column shows. null is an empty cell.
const SORT_VALUES = {
  name: (c: RosterRow) => textOrNull(`${c.lastname}, ${c.firstname}`),
  doc: (c: RosterRow) => textOrNull(c.docnumber),
  agent: (c: RosterRow) => textOrNull(c.supervisingagent),
  programtype: (c: RosterRow) => textOrNull(c.programtype || 'State SO'),
  // Pretrial clients first, then the rest of their programs; other programs are empty
  pretrial: (c: RosterRow) => { const p = pretrialValue(c); return p === null ? null : p ? 0 : 1; },
  // Phase order (see phaseRank), with phases outside it after, alphabetically
  phase: (c: RosterRow) => {
    const p = String(c.phase ?? '').trim();
    const rank = phaseRank(p);
    return p ? `${String(isFinite(rank) ? rank : 999999).padStart(6, '0')} ${p.toLowerCase()}` : null;
  },
  group: (c: RosterRow) => textOrNull(c.groupname),
  lastattended: (c: RosterRow) => timeOrNull(c.lastattended),
  lastpoly: (c: RosterRow) => (!takesPolygraphs(c.programtype) ? null : timeOrNull(c.lastpoly)),
  status: (c: RosterRow) => textOrNull(c.programstatus),
  balance: (c: RosterRow) => toDisplayBalance(c.accountbalance),
} satisfies Record<string, (c: RosterRow) => string | number | null>;
type SortKey = keyof typeof SORT_VALUES;

// Roster columns in their default order. Each column sorts on its own SORT_VALUES entry; the Columns button lets each
// user hide and reorder them (Full Name always shows; the ROSTER_DEFAULT_HIDDEN ones start hidden).
const ROSTER_COLUMN_LABELS: Record<SortKey, string> = {
  name: 'Full Name', doc: 'DOC #', agent: 'Agent', programtype: 'Program Type', pretrial: 'Pretrial', phase: 'Phase', group: 'Current Group',
  lastattended: 'Last Attended', lastpoly: 'Last Poly', status: 'Status', balance: 'Balance',
};
const ROSTER_COLUMN_KEYS = Object.keys(ROSTER_COLUMN_LABELS) as SortKey[];
const ROSTER_DEFAULT_HIDDEN: SortKey[] = ['pretrial'];
/* eslint-disable @typescript-eslint/no-explicit-any -- client rows are untyped throughout App */
const ROSTER_CELLS: Record<SortKey, (c: any) => ReactNode> = {
  name: c => <td className="p-3 font-medium text-white whitespace-nowrap">{c.lastname}, {c.firstname}</td>,
  doc: c => <td className="p-3 text-slate-400 font-mono text-xs">{c.docnumber}</td>,
  agent: c => <td className="p-3 text-slate-300 text-xs">{c.supervisingagent}</td>,
  programtype: c => <td className="p-3"><span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded text-xs font-semibold">{c.programtype || 'State SO'}</span></td>,
  pretrial: c => {
    const p = pretrialValue(c);
    return <td className="p-3 text-xs">{p === null ? <span className="text-slate-600">—</span> : p
      ? <span className="bg-amber-500/10 border border-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-semibold">Pretrial</span>
      : <span className="text-slate-400">No</span>}</td>;
  },
  phase: c => <td className="p-3 text-xs"><span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">{formatPhase(c.programtype, c.phase) || 'N/A'}</span></td>,
  group: c => <td className="p-3 text-slate-300 text-xs">{c.groupname || UNASSIGNED_GROUP}</td>,
  lastattended: c => (
    <td
      className={`p-3 text-xs ${isAttendanceOverdue(c) ? 'text-red-400 font-semibold' : 'text-slate-400'}`}
      title={isAttendanceOverdue(c) ? `Overdue: more than ${SO_ATTENDANCE_LIMIT_MONTHS[c.phase]} month${SO_ATTENDANCE_LIMIT_MONTHS[c.phase] === 1 ? '' : 's'} since last attended for ${c.phase}` : undefined}
    >
      {c.lastattended ? new Date(c.lastattended).toLocaleDateString() : 'Never'}
    </td>
  ),
  lastpoly: c => <td className="p-3 text-slate-400 text-xs">{!takesPolygraphs(c.programtype) ? '—' : c.lastpoly ? new Date(c.lastpoly).toLocaleDateString() : 'None'}</td>,
  status: c => <td className="p-3"><span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${c.programstatus === 'Active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`} title={c.programstatus}>{c.programstatus === 'Discharged Supervision' ? 'Discharged' : c.programstatus}</span></td>,
  balance: c => <td className={`p-3 font-semibold ${toDisplayBalance(c.accountbalance) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(c.accountbalance)}</td>,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// The Client Roster tab: searchable, filterable client list and the New Client form. Clicking a row opens the
// client's account (App's drawer).
export default function ClientRoster({ clients, activeGroups, directoryAgents, userEmail, onOpenClient, onCreated, onSuccess, onError, headerActions }: Props) {
  const [clientSearch, setClientSearch] = useState('');
  const [clientFilters, setClientFilters] = useState<ClientFilters>(DEFAULT_CLIENT_FILTERS);
  // Clients with the picked statuses; Status: All and the discharge statuses load discharged clients from the server
  const { clients: statusClients, loading: statusLoading, error: statusError } = useClientsByStatus(clients, clientFilters.status);
  // Filter row is hidden until toggled; the choice is remembered in this browser. Filters still apply while hidden.
  const [showClientFilters, setShowClientFilters] = useState(() => {
    try { return localStorage.getItem('showClientFilters') === 'true'; } catch { return false; }
  });
  const toggleClientFilters = () => setShowClientFilters(show => {
    try { localStorage.setItem('showClientFilters', String(!show)); } catch { /* storage unavailable */ }
    return !show;
  });
  // Filters changed from the defaults, shown on the Filters button so hidden filters aren't forgotten
  const changedClientFilterCount = (Object.keys(DEFAULT_CLIENT_FILTERS) as (keyof ClientFilters)[])
    .filter(key => JSON.stringify(clientFilters[key]) !== JSON.stringify(DEFAULT_CLIENT_FILTERS[key])).length;

  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClient, setNewClient] = useState(getEmptyNewClient);
  const [saving, setSaving] = useState(false);
  const newClientField = (label: string, key: Exclude<keyof NewClient, 'pretrial'>, type = 'text', required = false, listId?: string) => (
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
  const clientFilterActive = Object.values(clientFilters).some(v => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
  const distinctClientValues = (key: FilterKey): string[] => {
    if (key === 'status') return PROGRAM_STATUSES;
    if (key === 'phase') {
      return Array.from(new Set(statusClients.map(c => String(c.phase ?? '').trim()).filter(Boolean)))
        .sort((a, b) => phaseRank(a) - phaseRank(b) || a.localeCompare(b));
    }
    const field = key === 'agent' ? 'supervisingagent' : key === 'currentgroup' ? 'groupname' : 'programtype';
    const values = Array.from(new Set(statusClients.map(c => String(c[field] ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    return key === 'currentgroup' ? [UNASSIGNED_GROUP, ...values] : values;
  };
  const filteredClients = statusClients
    .filter(c => {
      if (clientSearchTerm && ![
        c.firstname, c.lastname, `${c.firstname} ${c.lastname}`, `${c.lastname}, ${c.firstname}`,
        c.docnumber, c.supervisingagent, c.groupname, c.programtype, c.phase, c.programstatus
      ].some(v => String(v ?? '').toLowerCase().includes(clientSearchTerm))) return false;

      // Each list filter keeps clients matching any value picked in it; an empty list allows everything
      const allowed = (picked: string[], value: unknown) => !picked.length || picked.includes(String(value ?? '').trim());
      if (!allowed(clientFilters.agent, c.supervisingagent)) return false;
      if (!allowed(clientFilters.programtype, c.programtype)) return false;
      if (!allowed(clientFilters.phase, c.phase)) return false;
      if (!allowed(clientFilters.currentgroup, String(c.groupname ?? '').trim() || UNASSIGNED_GROUP)) return false;
      if (!allowed(clientFilters.status, c.programstatus)) return false;
      if (clientFilters.feeoverride === 'active' && (c.activefeeoverride === null || c.activefeeoverride === undefined)) return false;
      if (clientFilters.feeoverride === 'none' && c.activefeeoverride !== null && c.activefeeoverride !== undefined) return false;
      // Not pretrial: Federal SO and Fed Drug Test clients without the box ticked
      if (clientFilters.pretrial === 'yes' && pretrialValue(c) !== true) return false;
      if (clientFilters.pretrial === 'no' && pretrialValue(c) !== false) return false;
      if (clientFilters.docnumber && (textOrNull(c.docnumber) === null) !== (clientFilters.docnumber === 'missing')) return false;

      return true;
    });
  // Hide mode: each row gets a toggle that blanks the client's details while working down the list; the row keeps its
  // place so it can be shown again. Only this screen remembers it (nothing is saved, other users don't see it); turning
  // hide mode off shows every client again.
  const [hideMode, setHideMode] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(() => new Set());
  const toggleHideMode = () => {
    setHideMode(on => !on);
    setHiddenIds(new Set());
  };
  const toggleHidden = (clientId: number) => setHiddenIds(ids => {
    const next = new Set(ids);
    if (!next.delete(clientId)) next.add(clientId);
    return next;
  });

  // Which columns show and in what order, saved in this browser
  const columns = useColumnLayout('clientRosterColumns', ROSTER_COLUMN_KEYS, ['name'], ROSTER_DEFAULT_HIDDEN);

  // Column sorting: clicking a header sorts by it ascending, clicking again flips the direction
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const toggleSort = (key: SortKey) => setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const sortedClients = [...filteredClients].sort((a, b) => {
    const va = SORT_VALUES[sort.key](a), vb = SORT_VALUES[sort.key](b);
    // Empty values go last in either direction
    if (va === null || vb === null) return va === vb ? byName(a, b) : va === null ? 1 : -1;
    const diff = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return diff * sort.dir || byName(a, b);
  });
  // 50 clients per page; a new search, filter, or sort starts again on page 1
  const pager = usePagination(sortedClients, JSON.stringify([clientSearchTerm, clientFilters, sort]));
  const sortHeader = (key: SortKey, label: string) => {
    const Icon = sort.key !== key ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <th key={key} className="p-0" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
        <button type="button" onClick={() => toggleSort(key)} className={`w-full p-3 flex items-center gap-1 uppercase tracking-wider text-left hover:text-white ${sort.key === key ? 'text-white' : ''}`}>
          {label}
          <Icon size={12} className={`shrink-0 ${sort.key === key ? 'text-blue-400' : 'text-slate-600'}`} />
        </button>
      </th>
    );
  };

  const filterSelect = (key: FilterKey, title: string, label: (v: string) => string = v => v) => (
    <MultiSelect
      label={title}
      options={distinctClientValues(key)}
      selected={clientFilters[key]}
      onChange={(picked) => setClientFilters(f => ({ ...f, [key]: picked }))}
      optionLabel={label}
    />
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
      <div className="p-4 md:p-5 border-b border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3">
          <h2 className="font-semibold text-white">Active Client Directory</h2>
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <button type="button" onClick={() => setShowNewClientForm(s => !s)} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap">+ New Client</button>
            {headerActions}
            <input
              type="search"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Search name, DOC #, agent, group..."
              className="max-md:order-first bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs w-full md:w-64 max-w-full"
            />
            <button
              type="button"
              onClick={toggleClientFilters}
              aria-expanded={showClientFilters}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showClientFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
            >
              <SlidersHorizontal size={13} /> Filters
              {changedClientFilterCount > 0 && (
                <span className="bg-blue-600 text-white rounded-full px-1.5 text-[0.625rem] leading-4">{changedClientFilterCount}</span>
              )}
            </button>
            <button
              type="button"
              onClick={toggleHideMode}
              aria-pressed={hideMode}
              title={hideMode ? 'Stop hiding and show every client again' : 'Hide clients from view while you look through the list (just for you, until you turn this off)'}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${hideMode ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
            >
              {hideMode ? <><Eye size={13} /> Show All{hiddenIds.size > 0 && <span className="bg-amber-500 text-slate-950 rounded-full px-1.5 text-[0.625rem] leading-4">{hiddenIds.size} hidden</span>}</> : <><EyeOff size={13} /> Hide Clients</>}
            </button>
            {/* Columns only exist on the table; phones show cards, sorted from the Filters panel instead of by column header */}
            <div className="hidden md:block"><ColumnPicker layout={columns} labels={ROSTER_COLUMN_LABELS} /></div>
            <span className="text-xs bg-slate-800 px-3 py-1 rounded-full text-slate-300 whitespace-nowrap">
              {statusLoading ? 'Loading…' : filteredClients.length === statusClients.length ? `${statusClients.length} Clients` : `${filteredClients.length} of ${statusClients.length} Clients`}
            </span>
          </div>
        </div>

        {showClientFilters && (
        <div className="flex gap-3 flex-wrap">
        <div className="md:hidden flex items-center gap-2 w-full">
          <select
            aria-label="Sort clients by"
            value={sort.key}
            onChange={(e) => setSort({ key: e.target.value as SortKey, dir: 1 })}
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
          >
            {ROSTER_COLUMN_KEYS.map(key => <option key={key} value={key}>Sort: {ROSTER_COLUMN_LABELS[key]}</option>)}
          </select>
          <button
            type="button"
            onClick={() => toggleSort(sort.key)}
            aria-label={sort.dir === 1 ? 'Sorted ascending; switch to descending' : 'Sorted descending; switch to ascending'}
            className="bg-slate-800 border border-slate-700 text-slate-300 p-1.5 rounded-lg"
          >
            {sort.dir === 1 ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
          </button>
        </div>
          {filterSelect('agent', 'Agent')}
          {filterSelect('programtype', 'Program Type')}
          {/* BIP clients store a week number as their phase */}
          {filterSelect('phase', 'Phase', phase => (isWholeNumber(phase) ? `Week ${phase} (BIP)` : phase))}
          {filterSelect('currentgroup', 'Current Group')}
          {filterSelect('status', 'Status')}

          <select
            value={clientFilters.feeoverride}
            onChange={(e) => setClientFilters({ ...clientFilters, feeoverride: e.target.value as ClientFilters['feeoverride'] })}
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
          >
            <option value="">Fee Override: All</option>
            <option value="active">Reduced fee active</option>
            <option value="none">No override</option>
          </select>

          {/* Only Federal SO and Fed Drug Test clients can be pretrial */}
          <select
            value={clientFilters.pretrial}
            onChange={(e) => setClientFilters({ ...clientFilters, pretrial: e.target.value as ClientFilters['pretrial'] })}
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
          >
            <option value="">Pretrial: All</option>
            <option value="yes">Pretrial</option>
            <option value="no">Not pretrial (Federal SO / Fed Drug Test)</option>
          </select>

          <select
            value={clientFilters.docnumber}
            onChange={(e) => setClientFilters({ ...clientFilters, docnumber: e.target.value as ClientFilters['docnumber'] })}
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs"
          >
            <option value="">DOC #: All</option>
            <option value="missing">No DOC #</option>
            <option value="has">Has DOC #</option>
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
                  treatmentfee: programType === 'BIP' ? 35 : (STATE_FEE_PROGRAM_TYPES.includes(programType) ? SO_TREATMENT_FEES['Phase 1 - Weekly'] : 0),
                  pretrial: PRETRIAL_PROGRAM_TYPES.includes(programType) && newClient.pretrial,
                });
              }} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm">
                <option value="">Select a program type...</option>
                <option value="State SO">State SO</option>
                <option value="Federal SO">Federal SO</option>
                <option value="BIP">BIP</option>
                <option value="Voluntary SO">Voluntary SO</option>
                <option value="Poly Only">Poly Only</option>
                <option value="Fed Drug Test">Fed Drug Test</option>
              </select>
              {PRETRIAL_PROGRAM_TYPES.includes(newClient.programtype) && (
                <label className="mt-2 flex items-center gap-1.5 text-slate-200 text-sm cursor-pointer">
                  <input type="checkbox" checked={newClient.pretrial} onChange={(e) => setNewClient({ ...newClient, pretrial: e.target.checked })} className="accent-blue-500" />
                  Pretrial
                </label>
              )}
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
      {/* Phones: one card per client, always showing the fields that matter most at a glance */}
      <ul className="md:hidden divide-y divide-slate-800">
        {pager.pageItems.map((c) => {
          const hidden = hideMode && hiddenIds.has(c.clientid);
          const pretrial = pretrialValue(c);
          return (
            <li key={c.clientid} className="flex items-stretch">
              {hideMode && (
                <button
                  type="button"
                  onClick={() => toggleHidden(c.clientid)}
                  aria-pressed={hidden}
                  aria-label={hidden ? 'Show this client again' : `Hide ${c.firstname} ${c.lastname} from view`}
                  className={`shrink-0 flex items-center justify-center px-3 border-r border-slate-800 ${hidden ? 'bg-amber-500/15 text-amber-300' : 'text-slate-400'}`}
                >
                  {hidden ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
              )}
              {hidden ? (
                <div className="flex-1 min-h-16 bg-slate-950/60" aria-label="Hidden client" />
              ) : (
                <button type="button" data-client-row onClick={() => onOpenClient(c)} className="flex-1 min-w-0 text-left p-4 space-y-1.5">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-white truncate">{c.lastname}, {c.firstname}</span>
                    <span className={`shrink-0 text-sm font-semibold ${toDisplayBalance(c.accountbalance) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(c.accountbalance)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-semibold">{c.programtype || 'State SO'}</span>
                    {pretrial && <span className="bg-amber-500/10 border border-amber-500/20 text-amber-300 px-2 py-0.5 rounded font-semibold">Pretrial</span>}
                    <span className="bg-slate-800 px-2 py-0.5 rounded text-slate-300">{formatPhase(c.programtype, c.phase) || 'N/A'}</span>
                    <span className={`whitespace-nowrap px-2 py-0.5 rounded-full font-medium ${c.programstatus === 'Active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>{c.programstatus === 'Discharged Supervision' ? 'Discharged' : c.programstatus}</span>
                  </span>
                  <span className="block text-xs text-slate-400 truncate">
                    {[c.docnumber && `DOC ${c.docnumber}`, c.supervisingagent, c.groupname || UNASSIGNED_GROUP].filter(Boolean).join(' · ')}
                  </span>
                  <span className="block text-xs text-slate-400">
                    Last attended: <span className={isAttendanceOverdue(c) ? 'text-red-400 font-semibold' : ''}>{c.lastattended ? new Date(c.lastattended).toLocaleDateString() : 'Never'}</span>
                    {takesPolygraphs(c.programtype) && ` · Last poly: ${c.lastpoly ? new Date(c.lastpoly).toLocaleDateString() : 'None'}`}
                  </span>
                </button>
              )}
            </li>
          );
        })}
        {filteredClients.length === 0 && (
          <li className={`p-6 text-center text-sm ${statusError ? 'text-red-400' : 'text-slate-500'}`}>
            {statusError || (statusLoading ? 'Loading discharged clients…' : 'No clients match your filters.')}
          </li>
        )}
      </ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              {hideMode && <th className="p-3 w-px"><span className="sr-only">Hide</span></th>}
              {columns.visibleKeys.map(key => sortHeader(key, ROSTER_COLUMN_LABELS[key]))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-sm">
            {pager.pageItems.map((c) => {
              const hidden = hideMode && hiddenIds.has(c.clientid);
              return (
              <tr
                key={c.clientid}
                onClick={hidden ? undefined : () => onOpenClient(c)}
                className={hidden ? 'bg-slate-950/60' : 'hover:bg-slate-800/50 cursor-pointer transition'}
              >
                {hideMode && (
                  <td className="p-3 w-px" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => toggleHidden(c.clientid)}
                      aria-pressed={hidden}
                      title={hidden ? 'Show this client again' : `Hide ${c.firstname} ${c.lastname} from view`}
                      aria-label={hidden ? 'Show this client again' : `Hide ${c.firstname} ${c.lastname} from view`}
                      className={`border p-1.5 rounded ${hidden ? 'bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25' : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-amber-500/20 hover:text-amber-300'}`}
                    >
                      {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                  </td>
                )}
                {hidden
                  ? <td colSpan={columns.visibleKeys.length} className="p-3" aria-label="Hidden client" />
                  : columns.visibleKeys.map(key => <Fragment key={key}>{ROSTER_CELLS[key](c)}</Fragment>)}
              </tr>
              );
            })}
            {filteredClients.length === 0 && (
              <tr>
                <td colSpan={columns.visibleKeys.length + (hideMode ? 1 : 0)} className={`p-6 text-center text-sm ${statusError ? 'text-red-400' : 'text-slate-500'}`}>
                  {statusError || (statusLoading ? 'Loading discharged clients…' : 'No clients match your filters.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total} onPageChange={pager.setPage} noun="clients" />
    </div>
  );
}
