import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mail, MapPin, Pencil, Phone, PlusCircle, Search, Trash2, UserCheck } from 'lucide-react';
import { EditConflictError, deleteSupervisingAgent, getClients, getSupervisingAgents, saveSupervisingAgent } from '../../api';
import type { Client, SupervisingAgent } from '../../api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../Pagination';
import { revealPanel } from '../../utils/layout';
import { idText } from '../../utils/clients';
import { errorMessage } from '../../utils/errors';
import { AGENT_TYPE_SUGGESTIONS, NO_TYPE, agentKey, distinctValues, filterAgentRows } from '../../utils/agents';
import type { ActiveClientFilter, DirectoryFilter } from '../../utils/agents';

interface Props {
  // Current clients (not discharged); the selected agent's discharged clients are loaded on their own
  clients: Client[];
  user: { employeeemail: string; role: string };
  dischargeStatuses: string[];
  onOpenClient: (client: Client) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  // Reload the roster after a rename moves clients to the new agent name
  onClientsChanged: () => void;
  // Shares the freshly loaded directory with the client forms' agent picker
  onAgentsLoaded: (agents: SupervisingAgent[]) => void;
}

// One directory row: a saved agent, or a name found on client records with no directory entry yet
interface AgentRow {
  key: string;
  agent: SupervisingAgent | null;
  name: string;
  clients: Client[];
  // Clients in the list with program status Active
  activeClients: number;
}

const emptyForm = { name: '', phone: '', email: '', agentType: '', location: '' };

// "Type · Location" for an agent, or '' when neither is set
const typeAndLocation = (a: SupervisingAgent | null) => [a?.agenttype, a?.location].filter(Boolean).join(' · ');

export default function SupervisingAgentsTab({ clients, user, dischargeStatuses, onOpenClient, onSuccess, onError, onClientsChanged, onAgentsLoaded }: Props) {
  const [agents, setAgents] = useState<SupervisingAgent[]>([]);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [directoryFilter, setDirectoryFilter] = useState<DirectoryFilter>('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveClientFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // The selected agent's clients. On phones this sits below the whole agent list; on wider screens it is beside the list
  // at the top of the page, out of sight once you've scrolled down the list. Either way, picking an agent brings it into view.
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const selectAgent = (key: string) => {
    setSelectedKey(key);
    setShowDischarged(false);
    // After the frame, so the scroll is measured with the agent's clients in the panel
    requestAnimationFrame(() => revealPanel(detailPanelRef.current));
  };
  const [showDischarged, setShowDischarged] = useState(false);
  // null: form closed; 0: adding; otherwise the id of the agent being edited
  const [editingId, setEditingId] = useState<number | null>(null);
  // The agent as the form loaded it; sent with the save so a change made on another screen meanwhile is caught
  const [editingOriginal, setEditingOriginal] = useState<SupervisingAgent | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const canEdit = user.role === 'Business Administrator' || user.role === 'Office Admin';
  const canDelete = user.role === 'Business Administrator';

  const loadAgents = useCallback(async () => {
    try {
      const loaded = await getSupervisingAgents();
      setAgents(loaded);
      onAgentsLoaded(loaded);
      setLoadError('');
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load supervising agents.'));
    }
  }, [onAgentsLoaded]);

  useEffect(() => {
    // loadAgents only sets state after the request finishes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAgents();
  }, [loadAgents]);

  const isDischarged = (c: Client) => dischargeStatuses.includes(c.programstatus);

  const rows = useMemo<AgentRow[]>(() => {
    const byKey = new Map<string, AgentRow>();
    for (const a of agents) {
      byKey.set(agentKey(a.name), { key: agentKey(a.name), agent: a, name: a.name, clients: [], activeClients: 0 });
    }
    for (const c of clients) {
      const key = agentKey(c.supervisingagent);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, { key, agent: null, name: String(c.supervisingagent).trim(), clients: [], activeClients: 0 });
      const row = byKey.get(key)!;
      row.clients.push(c);
      if (c.programstatus === 'Active') row.activeClients++;
    }
    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [agents, clients]);

  const visibleRows = filterAgentRows(rows, { search, directory: directoryFilter, type: typeFilter, active: activeFilter });
  const unlistedCount = rows.filter(r => !r.agent).length;
  const typesInUse = useMemo(() => distinctValues(agents.map(a => a.agenttype)), [agents]);
  const typeOptions = useMemo(() => distinctValues([...AGENT_TYPE_SUGGESTIONS, ...typesInUse]), [typesInUse]);
  const locationOptions = useMemo(() => distinctValues(agents.map(a => a.location)), [agents]);
  const filtering = search.trim() !== '' || directoryFilter !== 'all' || typeFilter !== '' || activeFilter !== 'all';
  // 50 agents per page; a new search or filter starts again on page 1
  const pager = usePagination(visibleRows, `${search.trim().toLowerCase()}|${directoryFilter}|${typeFilter}|${activeFilter}`);

  const selected = rows.find(r => r.key === selectedKey) || null;
  const selectedName = selected?.name;

  // The selected agent's discharged clients, loaded from the server since App's list holds current clients only
  const [dischargedLoaded, setDischargedLoaded] = useState<{ key: string; clients: Props['clients'] } | null>(null);
  useEffect(() => {
    if (!selectedKey || !selectedName) return;
    let cancelled = false;
    getClients({ status: 'discharged', agent: selectedName })
      .then(loaded => { if (!cancelled) setDischargedLoaded({ key: selectedKey, clients: loaded }); })
      .catch(err => { if (!cancelled) onError(errorMessage(err, 'Failed to load discharged clients.')); });
    return () => { cancelled = true; };
  }, [selectedKey, selectedName, clients, onError]);

  const selectedCurrent = selected ? selected.clients.filter(c => !isDischarged(c)) : [];
  // Clients discharged during this session are still in App's list until it reloads
  const dischargedHere = selected ? selected.clients.filter(isDischarged) : [];
  const dischargedHereIds = new Set(dischargedHere.map(c => c.clientid));
  const selectedDischarged = [
    ...dischargedHere,
    ...(dischargedLoaded?.key === selectedKey ? dischargedLoaded.clients.filter(c => !dischargedHereIds.has(c.clientid)) : []),
  ];
  // Active clients are shown by default; inactive (and other not-yet-discharged statuses) join discharged behind the checkbox
  const selectedActive = selectedCurrent.filter(c => c.programstatus === 'Active');
  const selectedInactive = selectedCurrent.filter(c => c.programstatus !== 'Active');
  const selectedVisible = (showDischarged ? [...selectedCurrent, ...selectedDischarged] : selectedActive)
    .slice()
    .sort((a, b) => `${a.lastname}, ${a.firstname}`.localeCompare(`${b.lastname}, ${b.firstname}`));

  const openForm = (row: AgentRow | null) => {
    if (row?.agent) {
      setEditingId(row.agent.agentid);
      setEditingOriginal(row.agent);
      setForm({
        name: row.agent.name, phone: row.agent.phone || '', email: row.agent.email || '',
        agentType: row.agent.agenttype || '', location: row.agent.location || '',
      });
    } else {
      setEditingId(0);
      setForm({ ...emptyForm, name: row?.name || '' });
    }
  };

  const closeForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const expected = editingId && editingOriginal ? {
        name: editingOriginal.name, phone: editingOriginal.phone, email: editingOriginal.email,
        agenttype: editingOriginal.agenttype, location: editingOriginal.location,
      } : undefined;
      const { agent: saved, clientsRenamed } = await saveSupervisingAgent(editingId || null, { ...form, user: user.employeeemail, expected });
      if (clientsRenamed > 0) {
        onSuccess(`Agent updated. ${clientsRenamed} client record(s) moved to the new name.`);
        onClientsChanged();
      } else {
        onSuccess(editingId ? 'Agent updated.' : 'Agent added.');
      }
      closeForm();
      await loadAgents();
      setSelectedKey(agentKey(saved.name));
    } catch (err) {
      // Changed on another screen since the form opened: reload the form with the agent as it is now
      if (err instanceof EditConflictError && editingId) {
        const fresh = await getSupervisingAgents().catch(() => null);
        if (fresh) {
          setAgents(fresh);
          onAgentsLoaded(fresh);
          const current = fresh.find(a => a.agentid === editingId);
          if (current) openForm({ key: agentKey(current.name), agent: current, name: current.name, clients: [], activeClients: 0 });
          else closeForm();
        }
      }
      onError(errorMessage(err, 'Failed to save the supervising agent.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (agent: SupervisingAgent) => {
    if (!window.confirm(`Delete ${agent.name} from the directory? Clients keep this agent's name on their records.`)) return;
    try {
      await deleteSupervisingAgent(agent.agentid, user.employeeemail);
      onSuccess('Agent deleted.');
      if (editingId === agent.agentid) closeForm();
      await loadAgents();
    } catch (err) {
      onError(errorMessage(err, 'Failed to delete the supervising agent.'));
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 space-y-4">
          <div className="flex justify-between items-center gap-3">
            <div>
              <h2 className="font-semibold text-white">Supervising Agents</h2>
              <p className="text-xs text-slate-400 mt-0.5">Click an agent to see the clients assigned to them.</p>
            </div>
            {canEdit && editingId === null && (
              <button type="button" onClick={() => openForm(null)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded text-xs font-semibold shrink-0"><PlusCircle size={14} /> Add Agent</button>
            )}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              title="Search by name, type, location, phone, or email"
              className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 pl-9 text-white text-xs placeholder-slate-500"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded border border-slate-700 overflow-hidden text-xs" role="group" aria-label="Directory filter">
              {([['all', 'All'], ['listed', 'In directory'], ['missing', `Not in directory (${unlistedCount})`]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDirectoryFilter(value)}
                  aria-pressed={directoryFilter === value}
                  className={`px-3 py-1.5 font-semibold ${directoryFilter === value
                    ? (value === 'missing' ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-600 text-white')
                    : 'bg-slate-950 text-slate-300 hover:bg-slate-800'}`}
                >{label}</button>
              ))}
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Agent type filter"
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
            >
              <option value="">All types</option>
              {typesInUse.map(t => <option key={t} value={t}>{t}</option>)}
              <option value={NO_TYPE}>No type set</option>
            </select>
            <select
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as ActiveClientFilter)}
              aria-label="Active clients filter"
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
            >
              <option value="all">With or without active clients</option>
              <option value="with">With active clients</option>
              <option value="without">Without active clients</option>
            </select>
            {filtering && (
              <button type="button" onClick={() => { setSearch(''); setDirectoryFilter('all'); setTypeFilter(''); setActiveFilter('all'); }} className="text-xs text-blue-400 hover:text-blue-300">Clear</button>
            )}
            {filtering && <span className="text-xs text-slate-500 ml-auto">{visibleRows.length} of {rows.length}</span>}
          </div>
        </div>

        {editingId !== null && (
          <form onSubmit={handleSave} className="p-5 border-b border-slate-800 bg-slate-950/40 space-y-3">
            <p className="text-xs font-semibold text-slate-300 uppercase">{editingId ? 'Edit Agent' : 'New Agent'}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full Name" className="bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required />
              <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone Number" className="bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" />
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" className="bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" />
              {/* Pick a listed type or location, or type a new one */}
              <input type="text" list="agent-type-options" value={form.agentType} onChange={(e) => setForm({ ...form, agentType: e.target.value })} placeholder="Type (Probation, DHS...)" aria-label="Agent type" className="bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" />
              <input type="text" list="agent-location-options" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Location (office, county...)" aria-label="Location" className="bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm md:col-span-2" />
              <datalist id="agent-type-options">{typeOptions.map(t => <option key={t} value={t} />)}</datalist>
              <datalist id="agent-location-options">{locationOptions.map(l => <option key={l} value={l} />)}</datalist>
            </div>
            {editingId !== 0 && (
              <p className="text-xs text-slate-500">Changing the name also updates every client assigned under the old name.</p>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded text-xs">{editingId ? 'Save Changes' : 'Add Agent'}</button>
              <button type="button" onClick={closeForm} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold px-4 py-2 rounded text-xs">Cancel</button>
            </div>
          </form>
        )}

        {loadError && <p className="p-5 text-xs text-red-400">{loadError}</p>}

        {/* Phones: one compact card per agent. The table's columns don't fit, and a call or email is usually why they're here. */}
        <ul className="md:hidden divide-y divide-slate-800">
          {pager.pageItems.map(r => {
            const current = r.activeClients;
            return (
              <li
                key={r.key}
                onClick={() => selectAgent(r.key)}
                className={`p-4 cursor-pointer ${selectedKey === r.key ? 'bg-blue-500/10' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{r.name}</p>
                    {typeAndLocation(r.agent) && <p className="text-xs text-slate-300 mt-0.5">{typeAndLocation(r.agent)}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">{current} active client{current === 1 ? '' : 's'}</p>
                    {!r.agent && <span className="mt-1 inline-block bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[0.625rem] font-semibold">Not in directory</span>}
                  </div>
                  {canEdit && (
                    <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => openForm(r)} title={r.agent ? 'Edit' : 'Add to Directory'} aria-label={r.agent ? `Edit ${r.name}` : `Add ${r.name} to directory`} className="bg-slate-800 text-slate-300 p-1.5 rounded">{r.agent ? <Pencil size={14} /> : <PlusCircle size={14} />}</button>
                      {r.agent && canDelete && <button type="button" onClick={() => handleDelete(r.agent!)} title="Delete" aria-label={`Delete ${r.name}`} className="bg-slate-800 text-slate-300 p-1.5 rounded"><Trash2 size={14} /></button>}
                    </div>
                  )}
                </div>
                {/* Plain text here, so a tap anywhere on the agent opens them; the card that opens has the call and email links */}
                {r.agent?.phone && <p className="mt-1 flex items-center gap-2 text-sm text-slate-300"><Phone size={14} className="shrink-0 text-slate-500" />{r.agent.phone}</p>}
                {r.agent?.email && <p className="mt-1 flex items-center gap-2 text-sm text-slate-300 break-all"><Mail size={14} className="shrink-0 text-slate-500" />{r.agent.email}</p>}
              </li>
            );
          })}
          {visibleRows.length === 0 && (
            <li className="p-6 text-center text-slate-500 text-sm">{rows.length === 0 ? 'No supervising agents yet.' : 'No agents match your search or filters.'}</li>
          )}
        </ul>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <th className="p-3">Name</th>
                <th className="p-3">Type</th>
                <th className="p-3">Location</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Email</th>
                <th className="p-3 text-right">Active Clients</th>
                {canEdit && <th className="p-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {pager.pageItems.map(r => {
                const current = r.activeClients;
                return (
                  <tr
                    key={r.key}
                    onClick={() => selectAgent(r.key)}
                    className={`cursor-pointer transition ${selectedKey === r.key ? 'bg-blue-500/10' : 'hover:bg-slate-800/50'}`}
                  >
                    <td className="p-3 font-medium text-white">
                      {r.name}
                      {!r.agent && <span className="ml-2 inline-block whitespace-nowrap bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[0.625rem] font-semibold">Not in directory</span>}
                    </td>
                    <td className="p-3 text-slate-300 text-xs">{r.agent?.agenttype || <span className="text-slate-600">—</span>}</td>
                    <td className="p-3 text-slate-300 text-xs">{r.agent?.location || <span className="text-slate-600">—</span>}</td>
                    <td className="p-3 text-slate-300 text-xs whitespace-nowrap">{r.agent?.phone || <span className="text-slate-600">—</span>}</td>
                    <td className="p-3 text-slate-300 text-xs min-w-[12rem] break-all">{r.agent?.email || <span className="text-slate-600">—</span>}</td>
                    <td className="p-3 text-right"><span className="bg-slate-800 text-slate-200 px-2 py-0.5 rounded font-semibold text-xs">{current}</span></td>
                    {canEdit && (
                      <td className="p-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {r.agent ? (
                          <div className="flex justify-end gap-1">
                            <button type="button" onClick={() => openForm(r)} title="Edit" className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1.5 rounded"><Pencil size={12} /></button>
                            {canDelete && <button type="button" onClick={() => handleDelete(r.agent!)} title="Delete" className="bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-400 p-1.5 rounded"><Trash2 size={12} /></button>}
                          </div>
                        ) : (
                          <div className="flex justify-end">
                            <button type="button" onClick={() => openForm(r)} title="Add to Directory" className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1.5 rounded"><PlusCircle size={12} /></button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="p-6 text-center text-slate-500 text-sm">{rows.length === 0 ? 'No supervising agents yet.' : 'No agents match your search or filters.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total} onPageChange={pager.setPage} noun="agents" />
      </div>

      <div ref={detailPanelRef} className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl space-y-4 self-start scroll-mt-4">
        {!selected ? (
          <div className="text-center text-slate-500 text-sm py-10">
            <UserCheck size={28} className="mx-auto mb-3 text-slate-600" />
            Select an agent to see their assigned clients.
          </div>
        ) : (
          <>
            <div className="border-b border-slate-800 pb-3 space-y-1">
              <h2 className="text-lg font-bold text-white">{selected.name}</h2>
              {selected.agent?.agenttype && <p className="text-xs font-semibold text-slate-300">{selected.agent.agenttype}</p>}
              {selected.agent?.location && <p className="text-xs text-slate-300 flex items-center gap-2"><MapPin size={12} className="text-slate-500" />{selected.agent.location}</p>}
              {selected.agent?.phone && <p className="text-xs text-slate-300 flex items-center gap-2"><Phone size={12} className="text-slate-500" /><a href={`tel:${selected.agent.phone}`} className="max-md:inline-block max-md:py-3 hover:text-blue-400">{selected.agent.phone}</a></p>}
              {selected.agent?.email && <p className="text-xs text-slate-300 flex items-center gap-2"><Mail size={12} className="text-slate-500" /><a href={`mailto:${selected.agent.email}`} className="max-md:inline-block max-md:py-3 hover:text-blue-400 break-all">{selected.agent.email}</a></p>}
              <p className="text-xs text-slate-400">
                {selectedActive.length} active client(s)
                {selectedInactive.length > 0 ? `, ${selectedInactive.length} inactive` : ''}
                {selectedDischarged.length > 0 ? `, ${selectedDischarged.length} discharged` : ''}
              </p>
            </div>
            {(selectedInactive.length > 0 || selectedDischarged.length > 0) && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={showDischarged} onChange={(e) => setShowDischarged(e.target.checked)} className="rounded accent-blue-500" />
                Include inactive and discharged clients
              </label>
            )}
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {selectedVisible.map(c => (
                <button
                  key={c.clientid}
                  type="button"
                  onClick={() => onOpenClient(c)}
                  className="w-full text-left bg-slate-950 border border-slate-800 hover:border-slate-600 p-3 rounded text-xs flex justify-between items-center gap-3 transition"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{c.lastname}, {c.firstname}</p>
                    <p className="text-slate-400 truncate">ID # {idText(c) || 'N/A'} · {c.groupname || 'No group'}</p>
                  </div>
                  <span className={`shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full font-medium ${c.programstatus === 'Active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                    {c.programstatus === 'Discharged Supervision' ? 'Discharged' : c.programstatus}
                  </span>
                </button>
              ))}
              {selectedVisible.length === 0 && (
                <p className="text-center text-slate-500 text-sm py-6">{showDischarged ? 'No clients assigned.' : 'No active clients.'}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
