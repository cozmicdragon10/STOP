import { Fragment, useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { assignClientToGroup, createGroup, deleteGroup, getGroupClients, updateGroup } from '../../api';
import ScheduleSelect from '../ScheduleSelect';
import { DEFAULT_GROUP_FILTERS } from '../../utils/filters';
import { formatBalance } from '../../utils/balance';

interface DirectoryGroup {
  groupid: number;
  groupname: string;
  location?: string | null;
  counselor?: string | null;
  programtype?: string | null;
  schedule?: string | null;
  address?: string | null;
  clientcount?: number | string | null;
  active?: boolean | null;
}

interface DirectoryClient {
  clientid: number;
  firstname: string;
  lastname: string;
  docnumber?: string | null;
}

interface RosterClient extends DirectoryClient {
  accountbalance?: number | string | null;
}

interface Employee {
  displayname?: string | null;
  role: string;
  active?: boolean | null;
}

interface Props {
  groups: DirectoryGroup[];
  clients: DirectoryClient[];
  // Supplies the counselor choices
  employees: Employee[];
  role: string;
  userEmail: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  // Reload groups and clients after a group is created, changed, deleted, or gets a client
  onGroupsChanged: () => void;
}

type GroupSortKey = 'groupname' | 'location' | 'counselor' | 'programtype' | 'schedule' | 'clientcount' | 'active';
type FilterKey = 'location' | 'counselor' | 'programtype' | 'status';

// Normalize location names (e.g., "Oklahoma City" → "OKC")
const normalizeLocation = (loc: string | null | undefined) => (loc === 'Oklahoma City' ? 'OKC' : loc ?? '');
// Reverse normalization for storage (e.g., "OKC" → "Oklahoma City")
const denormalizeLocation = (loc: string) => (loc === 'OKC' ? 'Oklahoma City' : loc);

const emptyNewGroup = { groupName: '', location: '', counselor: '', programType: '', schedule: '', address: '' };

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

// The Group Directory: filters, sorting, the New Group form, and the Roster / Assign Clients / Group Details panel
// that opens under a group's row
export default function GroupsTab({ groups, clients, employees, role, userEmail, onSuccess, onError, onGroupsChanged }: Props) {
  const canEditGroupDetails = role !== 'Office Admin';
  const canDeleteGroups = role === 'Business Administrator';

  const [selectedGroupDetail, setSelectedGroupDetail] = useState<DirectoryGroup | null>(null);
  const groupDetailRef = useRef<HTMLDivElement>(null);
  const [groupRoster, setGroupRoster] = useState<RosterClient[]>([]);
  const [assignClientSearch, setAssignClientSearch] = useState('');
  const [groupTab, setGroupTab] = useState<'roster' | 'assign' | 'schedule'>('roster');
  const [editGroupName, setEditGroupName] = useState('');
  const [editCounselor, setEditCounselor] = useState('');
  const [editSchedule, setEditSchedule] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editLocation, setEditLocation] = useState('');
  const [editProgramType, setEditProgramType] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [saving, setSaving] = useState(false);

  // Directory filters; an empty string means "all". The list starts on active groups only.
  const [groupFilters, setGroupFilters] = useState(DEFAULT_GROUP_FILTERS);
  const changedGroupFilterCount = (Object.keys(DEFAULT_GROUP_FILTERS) as FilterKey[])
    .filter(k => groupFilters[k] !== DEFAULT_GROUP_FILTERS[k]).length;
  const groupFilterActive = changedGroupFilterCount > 0;
  // Same behavior as the Client Roster Filters button: hidden until toggled, remembered in this browser.
  const [showGroupFilters, setShowGroupFilters] = useState(() => {
    try { return localStorage.getItem('showGroupFilters') === 'true'; } catch { return false; }
  });
  const toggleGroupFilters = () => setShowGroupFilters(show => {
    try { localStorage.setItem('showGroupFilters', String(!show)); } catch { /* storage unavailable */ }
    return !show;
  });
  const distinctGroupValues = (key: FilterKey) => {
    if (key === 'status') return ['Active', 'Inactive'];
    return Array.from(new Set(groups.map(g => {
      const val = g[key];
      return key === 'location' && val ? normalizeLocation(val) : val;
    }).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
  };

  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroup, setNewGroup] = useState(emptyNewGroup);

  const [groupSort, setGroupSort] = useState<{ key: GroupSortKey; dir: 'asc' | 'desc' }>({ key: 'groupname', dir: 'asc' });
  const toggleGroupSort = (key: GroupSortKey) => {
    setGroupSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };
  const groupSortArrow = (key: GroupSortKey) => (groupSort.key === key ? (groupSort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const sortedDirectoryGroups = groups
    .filter(g => (!groupFilters.location || normalizeLocation(g.location) === groupFilters.location)
      && (!groupFilters.counselor || g.counselor === groupFilters.counselor)
      && (!groupFilters.programtype || g.programtype === groupFilters.programtype)
      && (!groupFilters.status || (groupFilters.status === 'Active' ? g.active !== false : g.active === false)))
    .sort((a, b) => {
      const read = (g: DirectoryGroup) => (groupSort.key === 'active' ? (g.active !== false ? 1 : 0)
        : groupSort.key === 'clientcount' ? Number(g.clientcount || 0)
        : String(g[groupSort.key] ?? ''));
      const va = read(a);
      const vb = read(b);
      const result = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
      return groupSort.dir === 'asc' ? result : -result;
    });

  // Counselor dropdown choices: active employees with the Counselor role. A group's saved counselor is kept as an option even if that account is no longer listed
  const counselorOptions = employees.filter(e => e.role === 'Counselor' && e.active !== false).map(e => e.displayname as string).filter(Boolean);
  const counselorChoices = (current: string) => (current && !counselorOptions.includes(current) ? [current, ...counselorOptions] : counselorOptions);

  const locationOptions = Array.from(new Set(groups.map(g => normalizeLocation(g.location)).filter(Boolean)));
  const programTypeOptions = Array.from(new Set(groups.map(g => g.programtype).filter(Boolean) as string[]));

  // Auto-scroll to group details when a group is selected
  useEffect(() => {
    if (selectedGroupDetail && groupDetailRef.current) {
      setTimeout(() => {
        // The panel opens under the clicked row, so only scroll as far as needed to show it
        groupDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 0);
    }
  }, [selectedGroupDetail]);

  const loadRoster = async (groupId: number) => {
    setGroupRoster(await getGroupClients(groupId));
  };

  const handleOpenGroup = async (group: DirectoryGroup) => {
    setSelectedGroupDetail(group);
    setEditGroupName(group.groupname);
    setEditLocation(normalizeLocation(group.location));
    setEditProgramType(group.programtype || '');
    setEditCounselor(group.counselor || '');
    setEditSchedule(group.schedule || '');
    setEditAddress(group.address || '');
    setEditActive(group.active !== false);
    setGroupRoster([]);
    try {
      await loadRoster(group.groupid);
    } catch (err) {
      onError(errorText(err, 'Could not load the group roster.'));
    }
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupDetail || !canEditGroupDetails) return;
    try {
      await updateGroup(selectedGroupDetail.groupid, {
        groupName: editGroupName,
        location: denormalizeLocation(editLocation),
        counselor: editCounselor,
        programType: editProgramType,
        schedule: editSchedule,
        address: editAddress,
        active: editActive
      });
      setSelectedGroupDetail({
        ...selectedGroupDetail,
        groupname: editGroupName, location: editLocation, counselor: editCounselor, programtype: editProgramType,
        schedule: editSchedule, address: editAddress, active: editActive
      });
      onSuccess('Group details updated successfully!');
      onGroupsChanged();
    } catch (err) {
      onError(errorText(err, 'Error updating group.'));
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await createGroup({ ...newGroup, location: denormalizeLocation(newGroup.location) });
      onSuccess(res.message || 'Group created successfully!');
      setNewGroup(emptyNewGroup);
      setShowNewGroupForm(false);
      onGroupsChanged();
    } catch (err) {
      onError(errorText(err, 'Error creating group.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroupDetail || !canDeleteGroups) return;
    if (!window.confirm(`Delete group "${selectedGroupDetail.groupname}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      const res = await deleteGroup(selectedGroupDetail.groupid);
      onSuccess(res.message || 'Group deleted successfully!');
      setSelectedGroupDetail(null);
      setGroupRoster([]);
      setGroupTab('roster');
      setAssignClientSearch('');
      onGroupsChanged();
    } catch (err) {
      onError(errorText(err, 'Error deleting group.'));
    } finally {
      setSaving(false);
    }
  };

  const handleAssignClient = async (clientId: number) => {
    if (!selectedGroupDetail) return;
    try {
      await assignClientToGroup(selectedGroupDetail.groupid, clientId, userEmail);
      await loadRoster(selectedGroupDetail.groupid);
      setAssignClientSearch('');
      onSuccess('Client reassigned to group successfully!');
      onGroupsChanged();
    } catch (err) {
      onError(errorText(err, 'Could not assign the client.'));
    }
  };

  // Roster, Assign Clients, and Group Details for the open group. Shown under the group's row.
  const renderGroupDetailPanel = () => selectedGroupDetail && (
    <div ref={groupDetailRef} className="p-6 space-y-4 text-left">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <h3 className="text-lg font-bold text-white">Managing: {selectedGroupDetail.groupname}</h3>
        <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button onClick={() => setGroupTab('roster')} className={`px-3 py-1 rounded text-xs font-semibold ${groupTab === 'roster' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Roster</button>
          <button onClick={() => setGroupTab('assign')} className={`px-3 py-1 rounded text-xs font-semibold ${groupTab === 'assign' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Assign Clients</button>
          <button onClick={() => setGroupTab('schedule')} className={`px-3 py-1 rounded text-xs font-semibold ${groupTab === 'schedule' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Group Details</button>
        </div>
        <div className="flex items-center gap-2">
          {canDeleteGroups && (
            <button onClick={handleDeleteGroup} disabled={saving} className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-semibold">Delete Group</button>
          )}
          <button type="button" onClick={() => setSelectedGroupDetail(null)} aria-label="Close group" className="text-slate-400 hover:text-white p-1 rounded bg-slate-800"><X size={16} /></button>
        </div>
      </div>

      {groupTab === 'roster' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400 uppercase font-semibold">Assigned Clients ({groupRoster.length})</p>
          {groupRoster.map(c => (
            <div key={c.clientid} className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex justify-between items-center text-sm">
              <span className="font-medium text-white">{c.lastname}, {c.firstname} ({c.docnumber})</span>
              <span className="text-xs text-slate-400">Balance: {formatBalance(c.accountbalance)}</span>
            </div>
          ))}
        </div>
      )}

      {groupTab === 'assign' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs text-slate-400 uppercase font-semibold">Assign Client to this Group</p>
            <input
              type="search"
              value={assignClientSearch}
              onChange={(e) => setAssignClientSearch(e.target.value)}
              placeholder="Search client name or DOC #..."
              className="bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-white text-xs w-64 max-w-full"
            />
          </div>
          {(() => {
            const assignedClientIds = new Set(groupRoster.map(c => c.clientid));
            const unassignedClients = clients.filter(c => !assignedClientIds.has(c.clientid));
            const searchTerm = assignClientSearch.trim().toLowerCase();
            const filteredClients = searchTerm
              ? unassignedClients.filter(c => [
                  c.firstname, c.lastname, `${c.firstname} ${c.lastname}`, `${c.lastname}, ${c.firstname}`, c.docnumber
                ].some(v => String(v ?? '').toLowerCase().includes(searchTerm)))
              : unassignedClients;

            return (
              <div className="grid grid-cols-2 gap-4">
                {filteredClients.length > 0 ? (
                  filteredClients.map(c => (
                    <div key={c.clientid} className="bg-slate-950 border border-slate-800 p-3 rounded-lg flex justify-between items-center text-xs">
                      <span>{c.lastname}, {c.firstname} ({c.docnumber})</span>
                      <button onClick={() => handleAssignClient(c.clientid)} className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded">Assign</button>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 italic col-span-2">
                    {searchTerm ? 'No clients match your search.' : 'All available clients are already assigned to this group.'}
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {groupTab === 'schedule' && (
        <form onSubmit={handleUpdateGroup} className="space-y-4 max-w-2xl">
          <datalist id="edit-group-locations">
            {locationOptions.map(v => <option key={v} value={v} />)}
          </datalist>
          <datalist id="edit-group-program-types">
            {programTypeOptions.map(v => <option key={v} value={v} />)}
          </datalist>
          {!canEditGroupDetails && (
            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2">Group details are view-only for your role.</p>
          )}
          <fieldset disabled={!canEditGroupDetails} className="space-y-4 disabled:opacity-70">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-xs text-slate-400 mb-1">Group Name *</label><input type="text" required value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Location *</label><input type="text" required list="edit-group-locations" value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Counselor *</label><select required value={editCounselor} onChange={(e) => setEditCounselor(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm"><option value="">Select a counselor...</option>{counselorChoices(editCounselor).map(name => <option key={name} value={name}>{name}</option>)}</select></div>
            <div><label className="block text-xs text-slate-400 mb-1">Program Type *</label><input type="text" required list="edit-group-program-types" value={editProgramType} onChange={(e) => setEditProgramType(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Schedule *</label><ScheduleSelect value={editSchedule} onChange={setEditSchedule} className="bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Address</label><input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} className="accent-blue-600" />
            Active (uncheck to deactivate; hides the group from new assignments and sessions)
          </label>
          {canEditGroupDetails && (
            <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-xs font-semibold">Save Group Settings</button>
          )}
          </fieldset>
        </form>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl p-5">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-white">Group Directory</h2>
            <button type="button" onClick={() => setShowNewGroupForm(s => !s)} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-semibold">+ New Group</button>
          </div>
          <button
            type="button"
            onClick={toggleGroupFilters}
            aria-expanded={showGroupFilters}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 border ${showGroupFilters ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'}`}
          >
            <SlidersHorizontal size={13} /> Filters
            {changedGroupFilterCount > 0 && (
              <span className="bg-blue-600 text-white rounded-full px-1.5 text-[10px] leading-4">{changedGroupFilterCount}</span>
            )}
          </button>
        </div>

        {showGroupFilters && (
        <div className="flex flex-wrap items-end gap-3 mb-4 text-xs">
          {([
            ['location', 'Location', 'All locations'],
            ['counselor', 'Counselor', 'All counselors'],
            ['programtype', 'Program Type', 'All program types'],
            ['status', 'Status', 'All statuses'],
          ] as const).map(([key, label, allLabel]) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-slate-400">{label}</label>
              <select value={groupFilters[key]} onChange={(e) => setGroupFilters({ ...groupFilters, [key]: e.target.value })} className="bg-slate-900 border border-slate-700 rounded p-1.5 text-white text-sm min-w-[12rem]">
                <option value="">{allLabel}</option>
                {distinctGroupValues(key).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          ))}
          {groupFilterActive && (
            <button type="button" onClick={() => setGroupFilters(DEFAULT_GROUP_FILTERS)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-semibold">Clear filters</button>
          )}
        </div>
        )}

        {showNewGroupForm && (
          <form onSubmit={handleCreateGroup} className="bg-slate-950 border border-slate-800 rounded-lg p-4 mb-5 grid grid-cols-2 gap-4 text-sm">
            <datalist id="group-locations">
              {locationOptions.map(v => <option key={v} value={v} />)}
            </datalist>
            <datalist id="group-program-types">
              {programTypeOptions.map(v => <option key={v} value={v} />)}
            </datalist>
            <div><label className="block text-xs text-slate-400 mb-1">Group Name *</label><input type="text" required value={newGroup.groupName} onChange={(e) => setNewGroup({ ...newGroup, groupName: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Location *</label><input type="text" required list="group-locations" value={newGroup.location} onChange={(e) => setNewGroup({ ...newGroup, location: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Counselor *</label><select required value={newGroup.counselor} onChange={(e) => setNewGroup({ ...newGroup, counselor: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm"><option value="">Select a counselor...</option>{counselorChoices(newGroup.counselor).map(name => <option key={name} value={name}>{name}</option>)}</select></div>
            <div><label className="block text-xs text-slate-400 mb-1">Program Type *</label><input type="text" required list="group-program-types" value={newGroup.programType} onChange={(e) => setNewGroup({ ...newGroup, programType: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Schedule *</label><ScheduleSelect value={newGroup.schedule} onChange={(v) => setNewGroup({ ...newGroup, schedule: v })} className="bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" /></div>
            <div><label className="block text-xs text-slate-400 mb-1">Address</label><input type="text" value={newGroup.address} onChange={(e) => setNewGroup({ ...newGroup, address: e.target.value })} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-sm" /></div>
            <div className="col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => { setShowNewGroupForm(false); setNewGroup(emptyNewGroup); }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded text-xs font-semibold">Cancel</button>
              <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded text-xs font-semibold">Create Group</button>
            </div>
          </form>
        )}

        <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
          <thead>
            <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
              <th className="p-3"><button onClick={() => toggleGroupSort('groupname')} className="uppercase tracking-wider hover:text-slate-200">Group Name{groupSortArrow('groupname')}</button></th>
              <th className="p-3"><button onClick={() => toggleGroupSort('location')} className="uppercase tracking-wider hover:text-slate-200">Location{groupSortArrow('location')}</button></th>
              <th className="p-3"><button onClick={() => toggleGroupSort('counselor')} className="uppercase tracking-wider hover:text-slate-200">Counselor{groupSortArrow('counselor')}</button></th>
              <th className="p-3"><button onClick={() => toggleGroupSort('programtype')} className="uppercase tracking-wider hover:text-slate-200">Program Type{groupSortArrow('programtype')}</button></th>
              <th className="p-3"><button onClick={() => toggleGroupSort('schedule')} className="uppercase tracking-wider hover:text-slate-200">Schedule{groupSortArrow('schedule')}</button></th>
              <th className="p-3"><button onClick={() => toggleGroupSort('clientcount')} className="uppercase tracking-wider hover:text-slate-200">Assigned Clients{groupSortArrow('clientcount')}</button></th>
              <th className="p-3"><button onClick={() => toggleGroupSort('active')} className="uppercase tracking-wider hover:text-slate-200">Status{groupSortArrow('active')}</button></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-sm">
            {sortedDirectoryGroups.map(g => {
              const open = selectedGroupDetail?.groupid === g.groupid;
              return (
              <Fragment key={g.groupid}>
              {/* Clicking the open group again closes it */}
              <tr onClick={() => (open ? setSelectedGroupDetail(null) : handleOpenGroup(g))} className={`transition cursor-pointer ${open ? 'bg-blue-500/10' : 'hover:bg-slate-800/50'}`}>
                <td className="p-3 font-medium text-white">{g.groupname}</td>
                <td className="p-3 text-slate-400">{normalizeLocation(g.location)}</td>
                <td className="p-3 text-slate-300">{g.counselor}</td>
                <td className="p-3"><span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded text-xs">{g.programtype}</span></td>
                <td className="p-3 text-slate-400">{g.schedule}</td>
                <td className="p-3 font-bold text-slate-200">{g.clientcount || 0} Clients</td>
                <td className="p-3">
                  {g.active === false
                    ? <span className="bg-slate-700/50 text-slate-400 px-2 py-0.5 rounded text-xs">Inactive</span>
                    : <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-xs">Active</span>}
                </td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={7} className="p-0 whitespace-normal bg-slate-950/40 border-l-2 border-blue-500">
                    {renderGroupDetailPanel()}
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The open group is shown under its row; when filters hide that row (e.g. just set inactive), it's shown here instead */}
      {selectedGroupDetail && !sortedDirectoryGroups.some(g => g.groupid === selectedGroupDetail.groupid) && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl">{renderGroupDetailPanel()}</div>
      )}
    </div>
  );
}
