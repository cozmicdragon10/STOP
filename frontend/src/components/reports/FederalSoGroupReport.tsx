import { useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import type { Client, Group } from '../../api';
import { escapeHtml } from '../../utils/receipt';
import { idText } from '../../utils/clients';

interface Props {
  // Current clients (not discharged)
  clients: Client[];
  groups: Group[];
  onOpenClient: (client: Client) => void;
}

// Poly Only clients are all federal, so they're listed too
const FEDERAL_PROGRAMS = ['Federal SO', 'Poly Only'];
const POLY_ONLY = 'Poly Only';
const NO_GROUP = 'No group';
// Poly Only clients have no group; they get their own section instead of being mixed into "No group"
const POLY_ONLY_SECTION = 'Poly Only (no group)';

const formatDay = (value?: string | null) => {
  if (!value) return '—';
  const [y, m, d] = String(value).split('T')[0].split('-').map(Number);
  return y ? `${m}/${d}/${y}` : '—';
};
const byName = (a: Client, b: Client) => `${a.lastname}, ${a.firstname}`.localeCompare(`${b.lastname}, ${b.firstname}`);

const COLUMNS = ['Client', 'ID #', 'Program', 'Phase', 'Supervising Agent', 'Pretrial', 'Start Date', 'Last Attended'];
const cells = (c: Client) => [
  `${c.lastname}, ${c.firstname}`, idText(c) || '—', c.programtype, c.phase || '—', c.supervisingagent || '—',
  c.pretrial ? 'Yes' : '', formatDay(c.programstartdate), formatDay(c.lastattended ?? c.lastdateattended),
];

// Every federal client (Federal SO and Poly Only), listed under the group they're in
export default function FederalSoGroupReport({ clients, groups, onOpenClient }: Props) {
  // Active, Inactive, or '' for both (the list holds current clients only)
  const [statusFilter, setStatusFilter] = useState('Active');

  // A group counselor's name, or '' for all; clients with no group have no counselor, so picking one hides them
  const [counselorFilter, setCounselorFilter] = useState('');

  const allSections = useMemo(() => {
    const fed = clients.filter(c => FEDERAL_PROGRAMS.includes(c.programtype) && (!statusFilter || c.programstatus === statusFilter));
    const groupById = new Map(groups.map(g => [g.groupid, g]));
    // Keyed by group id, or by POLY_ONLY_SECTION / NO_GROUP for clients without a group
    const byKey = new Map<number | string, Client[]>();
    // A client in both a regular group and an individual group is listed under each
    const inGroup = (id?: number | null) => id != null && groupById.has(Number(id));
    for (const c of fed) {
      const keys: (number | string)[] = [c.groupid, c.individualgroupid].filter(inGroup).map(Number);
      if (!keys.length) keys.push(c.programtype === POLY_ONLY ? POLY_ONLY_SECTION : NO_GROUP);
      for (const key of keys) {
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push(c);
      }
    }
    // Groups by name, then Poly Only, then Federal SO clients with no group
    const order = (key: number | string) => (typeof key === 'number' ? 0 : key === POLY_ONLY_SECTION ? 1 : 2);
    return [...byKey.entries()]
      .map(([key, members]) => {
        const group = typeof key === 'number' ? groupById.get(key)! : null;
        return { key, group, title: group?.groupname ?? String(key), clients: members.sort(byName) };
      })
      .sort((a, b) => order(a.key) - order(b.key) || a.title.localeCompare(b.title));
  }, [clients, groups, statusFilter]);

  // Counselors of the groups that have federal clients
  const counselors = useMemo(
    () => [...new Set(allSections.map(s => s.group?.counselor?.trim()).filter((n): n is string => Boolean(n)))].sort((a, b) => a.localeCompare(b)),
    [allSections]
  );
  // A picked counselor with no federal groups left (e.g. after changing status) shows everyone
  const counselor = counselors.includes(counselorFilter) ? counselorFilter : '';
  const sections = counselor ? allSections.filter(s => s.group?.counselor?.trim() === counselor) : allSections;

  // Each client counted once, even when listed under both a regular and an individual group
  const shownClients = [...new Map(sections.flatMap(s => s.clients).map(c => [c.clientid, c])).values()];
  const total = shownClients.length;
  const polyOnlyCount = shownClients.filter(c => c.programtype === POLY_ONLY).length;
  const groupCount = sections.filter(s => s.group).length;
  const groupDetails = (g: Group | null) => (g ? [g.counselor, g.schedule, g.location].filter(Boolean).join(' · ') : '');

  const printReport = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const body = sections.map(s => `
      <h2>${escapeHtml(s.title)} <span>${escapeHtml(groupDetails(s.group))}${s.group ? ' · ' : ''}${s.clients.length} client${s.clients.length === 1 ? '' : 's'}</span></h2>
      <table><thead><tr>${COLUMNS.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>
        ${s.clients.map(c => `<tr>${cells(c).map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}
      </tbody></table>`).join('');
    win.document.write(`<!doctype html><html><head><title>Federal Clients by Group</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-size:18px;margin:0}
      h2{font-size:13px;margin:18px 0 4px;border-bottom:1px solid #999;padding-bottom:3px;break-after:avoid}h2 span{font-weight:normal;color:#555}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:3px 5px;text-align:left}th{background:#eee}tr{break-inside:avoid}
      .sub{color:#555;margin:2px 0 12px}
    </style></head><body>
      <h1>Federal Clients by Group</h1>
      <p class="sub">${total} ${escapeHtml(statusFilter || 'Active and Inactive')} client${total === 1 ? '' : 's'} (${total - polyOnlyCount} Federal SO, ${polyOnlyCount} Poly Only) · ${escapeHtml(counselor || 'All counselors')} · ${groupCount} group${groupCount === 1 ? '' : 's'} · Printed ${new Date().toLocaleString()}</p>
      ${body || '<p>No federal clients.</p>'}
    </body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">Federal Clients by Group</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {total} client{total === 1 ? '' : 's'} ({total - polyOnlyCount} Federal SO, {polyOnlyCount} Poly Only) in {groupCount} group{groupCount === 1 ? '' : 's'}.
            Click a client to open their account.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">Counselor
            <select value={counselor} onChange={(e) => setCounselorFilter(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs">
              <option value="">All Counselors</option>
              {counselors.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Client Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs">
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="">Active and Inactive</option>
            </select>
          </label>
          <button
            type="button"
            onClick={printReport}
            className="flex items-center gap-1.5 h-9 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 rounded text-xs font-semibold"
          >
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

      {sections.length === 0 && <p className="text-sm text-slate-500 text-center p-4">No federal clients.</p>}

      {sections.map(s => (
        <div key={s.key} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 border-b border-slate-800 pb-1">
            <p className={`font-semibold ${s.group || s.key === POLY_ONLY_SECTION ? 'text-white' : 'text-amber-400'}`}>{s.title}</p>
            {s.group && <p className="text-xs text-slate-400">{groupDetails(s.group)}</p>}
            <p className="text-xs text-blue-400 ml-auto">{s.clients.length} client{s.clients.length === 1 ? '' : 's'}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="stack-table w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-800/50 text-slate-400 uppercase">
                  {COLUMNS.map(h => <th key={h} className="p-2 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-sm">
                {s.clients.map(c => {
                  const [name, ...rest] = cells(c);
                  return (
                    <tr key={c.clientid} onClick={() => onOpenClient(c)} className="cursor-pointer hover:bg-slate-800/50" title="Open client account">
                      <td className="p-2 font-medium text-white">{name}</td>
                      {rest.map((v, i) => <td key={COLUMNS[i + 1]} data-label={COLUMNS[i + 1]} className="p-2 text-slate-300">{v}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
