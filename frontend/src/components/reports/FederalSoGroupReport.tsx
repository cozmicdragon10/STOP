import { useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import type { Client, Group } from '../../api';
import { escapeHtml } from '../../utils/receipt';

interface Props {
  // Current clients (not discharged)
  clients: Client[];
  groups: Group[];
  onOpenClient: (client: Client) => void;
}

const FEDERAL_SO = 'Federal SO';
const NO_GROUP = 'No group';

const formatDay = (value?: string | null) => {
  if (!value) return '—';
  const [y, m, d] = String(value).split('T')[0].split('-').map(Number);
  return y ? `${m}/${d}/${y}` : '—';
};
const byName = (a: Client, b: Client) => `${a.lastname}, ${a.firstname}`.localeCompare(`${b.lastname}, ${b.firstname}`);

const COLUMNS = ['Client', 'DOC / PACTS #', 'Phase', 'Supervising Agent', 'Pretrial', 'Start Date', 'Last Attended'];
const cells = (c: Client) => [
  `${c.lastname}, ${c.firstname}`, c.docnumber || '—', c.phase || '—', c.supervisingagent || '—',
  c.pretrial ? 'Yes' : '', formatDay(c.programstartdate), formatDay(c.lastattended ?? c.lastdateattended),
];

// Every Federal SO client, listed under the group they're in
export default function FederalSoGroupReport({ clients, groups, onOpenClient }: Props) {
  // Active, Inactive, or '' for both (the list holds current clients only)
  const [statusFilter, setStatusFilter] = useState('Active');

  const sections = useMemo(() => {
    const fed = clients.filter(c => c.programtype === FEDERAL_SO && (!statusFilter || c.programstatus === statusFilter));
    const groupById = new Map(groups.map(g => [g.groupid, g]));
    const byGroup = new Map<number | null, Client[]>();
    for (const c of fed) {
      const id = c.groupid != null && groupById.has(Number(c.groupid)) ? Number(c.groupid) : null;
      if (!byGroup.has(id)) byGroup.set(id, []);
      byGroup.get(id)!.push(c);
    }
    return [...byGroup.entries()]
      .map(([id, members]) => ({ id, group: id === null ? null : groupById.get(id)!, clients: members.sort(byName) }))
      // Groups by name; clients with no group last
      .sort((a, b) => (a.group === null ? 1 : b.group === null ? -1 : a.group.groupname.localeCompare(b.group.groupname)));
  }, [clients, groups, statusFilter]);

  const total = sections.reduce((n, s) => n + s.clients.length, 0);
  const groupCount = sections.filter(s => s.group).length;
  const groupDetails = (g: Group | null) => (g ? [g.counselor, g.schedule, g.location].filter(Boolean).join(' · ') : '');

  const printReport = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const body = sections.map(s => `
      <h2>${escapeHtml(s.group?.groupname ?? NO_GROUP)} <span>${escapeHtml(groupDetails(s.group))}${s.group ? ' · ' : ''}${s.clients.length} client${s.clients.length === 1 ? '' : 's'}</span></h2>
      <table><thead><tr>${COLUMNS.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>
        ${s.clients.map(c => `<tr>${cells(c).map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}
      </tbody></table>`).join('');
    win.document.write(`<!doctype html><html><head><title>Federal SO Clients by Group</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-size:18px;margin:0}
      h2{font-size:13px;margin:18px 0 4px;border-bottom:1px solid #999;padding-bottom:3px;break-after:avoid}h2 span{font-weight:normal;color:#555}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:3px 5px;text-align:left}th{background:#eee}tr{break-inside:avoid}
      .sub{color:#555;margin:2px 0 12px}
    </style></head><body>
      <h1>Federal SO Clients by Group</h1>
      <p class="sub">${total} ${escapeHtml(statusFilter || 'Active and Inactive')} client${total === 1 ? '' : 's'} in ${groupCount} group${groupCount === 1 ? '' : 's'} · Printed ${new Date().toLocaleString()}</p>
      ${body || '<p>No Federal SO clients.</p>'}
    </body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">Federal SO Clients by Group</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {total} client{total === 1 ? '' : 's'} in {groupCount} group{groupCount === 1 ? '' : 's'}. Click a client to open their account.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
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

      {sections.length === 0 && <p className="text-sm text-slate-500 text-center p-4">No Federal SO clients.</p>}

      {sections.map(s => (
        <div key={s.id ?? 'none'} className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 border-b border-slate-800 pb-1">
            <p className={`font-semibold ${s.group ? 'text-white' : 'text-amber-400'}`}>{s.group?.groupname ?? NO_GROUP}</p>
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
