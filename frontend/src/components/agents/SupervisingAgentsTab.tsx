import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mail, Pencil, Phone, PlusCircle, Search, Trash2, UserCheck } from 'lucide-react';
import { deleteSupervisingAgent, getClients, getSupervisingAgents, saveSupervisingAgent } from '../../api';
import type { SupervisingAgent } from '../../api';
import { usePagination } from '../../hooks/usePagination';
import Pagination from '../Pagination';
import { scrollToStackedPanel } from '../../utils/layout';
import { idText } from '../../utils/clients';

interface Props {
  // Current clients (not discharged); the selected agent's discharged clients are loaded on their own
  clients: any[];
  user: { employeeemail: string; role: string };
  dischargeStatuses: string[];
  onOpenClient: (client: any) => void;
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
  clients: any[];
}

// Clients link to an agent by name; case and surrounding spaces are ignored (the server matches the same way)
const agentKey = (name: string | null | undefined) => String(name ?? '').trim().toLowerCase();

const emptyForm = { name: '', phone: '', email: '' };

export default function SupervisingAgentsTab({ clients, user, dischargeStatuses, onOpenClient, onSuccess, onError, onClientsChanged, onAgentsLoaded }: Props) {
  const [agents, setAgents] = useState<SupervisingAgent[]>([]);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // The selected agent's clients; on phones this sits below the whole agent list
  const detailPanelRef = useRef<HTMLDivElement>(null);
  const selectAgent = (key: string) => {
    setSelectedKey(key);
    setShowDischarged(false);
    // After the frame, so the scroll is measured with the agent's clients in the panel
    requestAnimationFrame(() => scrollToStackedPanel(detailPanelRef.current));
  };
  const [showDischarged, setShowDischarged] = useState(false);
  // null: form closed; 0: adding; otherwise the id of the agent being edited
  const [editingId, setEditingId] = useState<number | null>(null);
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
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load supervising agents.');
    }
  }, [onAgentsLoaded]);

  useEffect(() => {
    // loadAgents only sets state after the request finishes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAgents();
  }, [loadAgents]);

  const isDischarged = (c: any) => dischargeStatuses.includes(c.programstatus);

  const rows = useMemo<AgentRow[]>(() => {
    const byKey = new Map<string, AgentRow>();
    for (const a of agents) {
      byKey.set(agentKey(a.name), { key: agentKey(a.name), agent: a, name: a.name, clients: [] });
    }
    for (const c of clients) {
      const key = agentKey(c.supervisingagent);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, { key, agent: null, name: String(c.supervisingagent).trim(), clients: [] });
      byKey.get(key)!.clients.push(c);
    }
    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [agents, clients]);

  const term = search.trim().toLowerCase();
  const visibleRows = rows.filter(r => !term || [r.name, r.agent?.phone, r.agent?.email].some(v => String(v ?? '').toLowerCase().includes(term)));
  const unlistedCount = rows.filter(r => !r.agent).length;
  // 50 agents per page; a new search starts again on page 1
  const pager = usePagination(visibleRows, term);

  const selected = rows.find(r => r.key === selectedKey) || null;
  const selectedName = selected?.name;

  // The selected agent's discharged clients, loaded from the server since App's list holds current clients only
  const [dischargedLoaded, setDischargedLoaded] = useState<{ key: string; clients: Props['clients'] } | null>(null);
  useEffect(() => {
    if (!selectedKey || !selectedName) return;
    let cancelled = false;
    getClients({ status: 'discharged', agent: selectedName })
      .then(loaded => { if (!cancelled) setDischargedLoaded({ key: selectedKey, clients: loaded }); })
      .catch(err => { if (!cancelled) onError(err.message || 'Failed to load discharged clients.'); });
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
  const selectedVisible = (showDischarged ? [...selectedCurrent, ...selectedDischarged] : selectedCurrent)
    .slice()
    .sort((a, b) => `${a.lastname}, ${a.firstname}`.localeCompare(`${b.lastname}, ${b.firstname}`));

  const openForm = (row: AgentRow | null) => {
    if (row?.agent) {
      setEditingId(row.agent.agentid);
      setForm({ name: row.agent.name, phone: row.agent.phone || '', email: row.agent.email || '' });
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
      const { agent: saved, clientsRenamed } = await saveSupervisingAgent(editingId || null, { ...form, user: user.employeeemail });
      if (clientsRenamed > 0) {
        onSuccess(`Agent updated. ${clientsRenamed} client record(s) moved to the new name.`);
        onClientsChanged();
      } else {
        onSuccess(editingId ? 'Agent updated.' : 'Agent added.');
      }
      closeForm();
      await loadAgents();
      setSelectedKey(agentKey(saved.name));
    } catch (err: any) {
      onError(err.message || 'Failed to save the supervising agent.');
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
    } catch (err: any) {
      onError(err.message || 'Failed to delete the supervising agent.');
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
              placeholder="Search by name, phone, or email..."
              className="w-full bg-slate-950 border border-slate-700 rounded p-2.5 pl-9 text-white text-xs placeholder-slate-500"
            />
          </div>
          {unlistedCount > 0 && canEdit && (
            <p className="text-xs text-amber-400">{unlistedCount} agent name(s) on client records aren't in the directory yet. They're marked "Not in directory" below.</p>
          )}
        </div>

        {editingId !== null && (
          <form onSubmit={handleSave} className="p-5 border-b border-slate-800 bg-slate-950/40 space-y-3">
            <p className="text-xs font-semibold text-slate-300 uppercase">{editingId ? 'Edit Agent' : 'New Agent'}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full Name" className="bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" required />
              <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone Number" className="bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" />
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" className="bg-slate-950 border border-slate-700 rounded p-2.5 text-white text-sm" />
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
            const current = r.clients.filter(c => !isDischarged(c)).length;
            return (
              <li
                key={r.key}
                onClick={() => selectAgent(r.key)}
                className={`p-4 cursor-pointer ${selectedKey === r.key ? 'bg-blue-500/10' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{r.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{current} client{current === 1 ? '' : 's'}</p>
                    {!r.agent && <span className="mt-1 inline-block bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[0.625rem] font-semibold">Not in directory</span>}
                  </div>
                  {canEdit && (
                    <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => openForm(r)} title={r.agent ? 'Edit' : 'Add to Directory'} aria-label={r.agent ? `Edit ${r.name}` : `Add ${r.name} to directory`} className="bg-slate-800 text-slate-300 p-1.5 rounded">{r.agent ? <Pencil size={14} /> : <PlusCircle size={14} />}</button>
                      {r.agent && canDelete && <button type="button" onClick={() => handleDelete(r.agent!)} title="Delete" aria-label={`Delete ${r.name}`} className="bg-slate-800 text-slate-300 p-1.5 rounded"><Trash2 size={14} /></button>}
                    </div>
                  )}
                </div>
                {r.agent?.phone && <a href={`tel:${r.agent.phone}`} onClick={(e) => e.stopPropagation()} className="mt-1 flex w-fit max-w-full items-center gap-2 min-h-10 text-sm text-blue-400"><Phone size={14} className="shrink-0" />{r.agent.phone}</a>}
                {r.agent?.email && <a href={`mailto:${r.agent.email}`} onClick={(e) => e.stopPropagation()} className="flex w-fit max-w-full items-center gap-2 min-h-10 text-sm text-blue-400 break-all"><Mail size={14} className="shrink-0" />{r.agent.email}</a>}
              </li>
            );
          })}
          {visibleRows.length === 0 && (
            <li className="p-6 text-center text-slate-500 text-sm">{rows.length === 0 ? 'No supervising agents yet.' : 'No agents match your search.'}</li>
          )}
        </ul>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <th className="p-3">Name</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Email</th>
                <th className="p-3 text-right">Clients</th>
                {canEdit && <th className="p-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {pager.pageItems.map(r => {
                const current = r.clients.filter(c => !isDischarged(c)).length;
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
                    <td className="p-3 text-slate-300 text-xs whitespace-nowrap">{r.agent?.phone ? <a href={`tel:${r.agent.phone}`} onClick={(e) => e.stopPropagation()} className="hover:text-blue-400">{r.agent.phone}</a> : <span className="text-slate-600">—</span>}</td>
                    <td className="p-3 text-slate-300 text-xs min-w-[12rem]">{r.agent?.email ? <a href={`mailto:${r.agent.email}`} onClick={(e) => e.stopPropagation()} className="hover:text-blue-400 break-all">{r.agent.email}</a> : <span className="text-slate-600">—</span>}</td>
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
                  <td colSpan={canEdit ? 5 : 4} className="p-6 text-center text-slate-500 text-sm">{rows.length === 0 ? 'No supervising agents yet.' : 'No agents match your search.'}</td>
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
              {selected.agent?.phone && <p className="text-xs text-slate-300 flex items-center gap-2"><Phone size={12} className="text-slate-500" /><a href={`tel:${selected.agent.phone}`} className="max-md:inline-block max-md:py-3 hover:text-blue-400">{selected.agent.phone}</a></p>}
              {selected.agent?.email && <p className="text-xs text-slate-300 flex items-center gap-2"><Mail size={12} className="text-slate-500" /><a href={`mailto:${selected.agent.email}`} className="max-md:inline-block max-md:py-3 hover:text-blue-400 break-all">{selected.agent.email}</a></p>}
              <p className="text-xs text-slate-400">{selectedCurrent.length} assigned client(s){selectedDischarged.length > 0 ? `, ${selectedDischarged.length} discharged` : ''}</p>
            </div>
            {selectedDischarged.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={showDischarged} onChange={(e) => setShowDischarged(e.target.checked)} className="rounded accent-blue-500" />
                Include discharged clients
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
                <p className="text-center text-slate-500 text-sm py-6">No clients assigned.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
