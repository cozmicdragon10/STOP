import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Printer } from 'lucide-react';
import { SO_PHASES } from '../../utils/soPhases';
import { formatBalance, toDisplayBalance } from '../../utils/balance';
import { escapeHtml } from '../../utils/receipt';
import { useClientsByStatus } from '../../hooks/useClientsByStatus';

interface ReportClient {
  clientid: number;
  firstname: string;
  lastname: string;
  docnumber?: string | null;
  programtype?: string | null;
  programstatus?: string | null;
  phase?: string | null;
  groupid?: number | string | null;
  accountbalance?: number | string | null;
  // Latest attendance row's date (the stored lastdateattended can lag behind it)
  lastattended?: string | null;
  lastdateattended?: string | null;
}

interface ReportGroup {
  groupid: number;
  groupname: string;
  counselor?: string | null;
  programtype?: string | null;
  location?: string | null;
  schedule?: string | null;
  active?: boolean | null;
}

interface Props {
  // Current clients (not discharged)
  clients: ReportClient[];
  groups: ReportGroup[];
  statuses: string[];
  onOpenClient: (client: any) => void;
}

const NO_COUNSELOR = 'No counselor';
const NO_PHASE = 'No phase set';

// BIP clients store the number of weeks attended in phase; the report counts them in these bands
const BIP_WEEK_BANDS: { label: string; min: number; max: number }[] = [
  { label: 'Weeks 0–12', min: 0, max: 12 },
  { label: 'Weeks 13–26', min: 13, max: 26 },
  { label: 'Weeks 27–39', min: 27, max: 39 },
  { label: 'Weeks 40+', min: 40, max: Infinity },
];

const isBip = (c: ReportClient) => c.programtype === 'BIP';

// The SO phase, or the BIP week band, a client is counted under
const phaseBucket = (c: ReportClient) => {
  const phase = String(c.phase ?? '').trim();
  if (isBip(c)) {
    if (!/^\d+$/.test(phase)) return NO_PHASE;
    const week = Number(phase);
    return BIP_WEEK_BANDS.find(b => week >= b.min && week <= b.max)?.label ?? NO_PHASE;
  }
  return SO_PHASES.includes(phase) ? phase : NO_PHASE;
};

const phaseLabel = (c: ReportClient) => {
  const phase = String(c.phase ?? '').trim();
  if (isBip(c)) return /^\d+$/.test(phase) ? `Week ${phase}` : '—';
  return phase || '—';
};

const countBy = (list: ReportClient[], keys: string[]) => {
  const counts = new Map(keys.map(k => [k, 0]));
  for (const c of list) {
    const key = phaseBucket(c);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const SO_PHASE_KEYS = [...SO_PHASES, NO_PHASE];
const BIP_PHASE_KEYS = [...BIP_WEEK_BANDS.map(b => b.label), NO_PHASE];

const formatDay = (value?: string | null) => {
  if (!value) return '—';
  const [y, m, d] = String(value).split('T')[0].split('-').map(Number);
  return y ? `${m}/${d}/${y}` : '—';
};

// Clients per counselor, through the groups each counselor leads. Clients with no group are listed apart.
export default function CounselorClientReport({ clients, groups, statuses, onOpenClient }: Props) {
  const [counselorFilter, setCounselorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('Active');
  // '' shows SO and BIP together; SO or BIP narrows both the clients and the groups
  const [program, setProgram] = useState<'' | 'SO' | 'BIP'>('');
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const showSo = program !== 'BIP';
  const showBip = program !== 'SO';

  // Status: All and the discharge statuses load discharged clients from the server
  const { clients: statusClients, loading, error } = useClientsByStatus(clients, statusFilter);
  const shownClients = useMemo(
    () => statusClients.filter(c => !program || (program === 'BIP') === isBip(c)),
    [statusClients, program]
  );
  const programGroups = useMemo(
    () => groups.filter(g => !program || (program === 'BIP') === (g.programtype === 'BIP')),
    [groups, program]
  );

  const counselors = useMemo(() => {
    const byName = new Map<string, { name: string; groups: { group: ReportGroup; clients: ReportClient[] }[] }>();
    for (const g of [...programGroups].sort((a, b) => a.groupname.localeCompare(b.groupname))) {
      const name = g.counselor?.trim() || NO_COUNSELOR;
      if (!byName.has(name)) byName.set(name, { name, groups: [] });
      const members = shownClients
        .filter(c => Number(c.groupid) === g.groupid)
        .sort((a, b) => `${a.lastname}, ${a.firstname}`.localeCompare(`${b.lastname}, ${b.firstname}`));
      // Inactive groups are left out unless someone is still assigned to them
      if (g.active === false && members.length === 0) continue;
      byName.get(name)!.groups.push({ group: g, clients: members });
    }
    return Array.from(byName.values())
      .filter(c => c.groups.length > 0)
      .map(c => {
        const all = c.groups.flatMap(g => g.clients);
        return { ...c, clients: all, bip: all.filter(isBip), so: all.filter(cl => !isBip(cl)) };
      })
      .sort((a, b) => (a.name === NO_COUNSELOR ? 1 : b.name === NO_COUNSELOR ? -1 : a.name.localeCompare(b.name)));
  }, [programGroups, shownClients]);

  const groupIds = new Set(groups.map(g => g.groupid));
  const unassigned = shownClients.filter(c => !c.groupid || !groupIds.has(Number(c.groupid)));
  const shown = counselorFilter ? counselors.filter(c => c.name === counselorFilter) : counselors;
  const shownAll = shown.flatMap(c => c.clients);
  const bipAll = shownAll.filter(isBip);
  const soAll = shownAll.filter(c => !isBip(c));
  const soPhases = countBy(soAll, SO_PHASE_KEYS);
  const bipPhases = countBy(bipAll, BIP_PHASE_KEYS);

  const toggle = (id: number) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allGroupIds = shown.flatMap(c => c.groups.map(g => g.group.groupid));
  const allExpanded = allGroupIds.length > 0 && allGroupIds.every(id => expanded.has(id));

  const printReport = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const phaseCells = (list: ReportClient[]) => {
      const so = countBy(list.filter(c => !isBip(c)), SO_PHASE_KEYS);
      const bip = countBy(list.filter(isBip), BIP_PHASE_KEYS);
      return [
        ...(showSo ? SO_PHASES.map(p => so.get(p) ?? 0) : []),
        ...(showBip ? BIP_WEEK_BANDS.map(b => bip.get(b.label) ?? 0) : []),
      ].map(n => `<td class="r">${n}</td>`).join('');
    };
    const phaseHeads = [
      ...(showSo ? SO_PHASES.map(p => p.replace(' - ', ' ')) : []),
      ...(showBip ? BIP_WEEK_BANDS.map(b => `BIP ${b.label}`) : []),
    ].map(h => `<th class="r">${escapeHtml(h)}</th>`).join('');
    const both = !program;
    const sections = shown.map(c => `
      <h2>${escapeHtml(c.name)}: ${c.clients.length} ${program ? `${program} ` : ''}clients${both ? ` (${c.so.length} SO, ${c.bip.length} BIP)` : ''} in ${c.groups.length} groups</h2>
      ${c.groups.map(({ group, clients: members }) => `
        <h3>${escapeHtml(group.groupname)} <span>${escapeHtml(group.programtype || '')}${group.schedule ? ` · ${escapeHtml(group.schedule)}` : ''}${group.location ? ` · ${escapeHtml(group.location)}` : ''} · ${members.length} clients</span></h3>
        ${members.length ? `<table><thead><tr><th>Client</th><th>DOC #</th><th>Program</th><th>Phase</th><th>Status</th><th>Last Attended</th><th class="r">Balance</th></tr></thead><tbody>
          ${members.map(m => `<tr><td>${escapeHtml(`${m.lastname}, ${m.firstname}`)}</td><td>${escapeHtml(m.docnumber || '')}</td><td>${escapeHtml(m.programtype || '')}</td>
            <td>${escapeHtml(phaseLabel(m))}</td><td>${escapeHtml(m.programstatus || '')}</td><td>${formatDay(m.lastattended ?? m.lastdateattended)}</td><td class="r">${escapeHtml(formatBalance(m.accountbalance))}</td></tr>`).join('')}
        </tbody></table>` : '<p class="none">No clients.</p>'}
      `).join('')}
    `).join('');
    win.document.write(`<!doctype html><html><head><title>Counselor Client Report</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-size:18px;margin:0}h2{font-size:14px;margin:22px 0 6px;border-bottom:1px solid #999;padding-bottom:3px}
      h3{font-size:12px;margin:12px 0 4px}h3 span{font-weight:normal;color:#555}table{width:100%;border-collapse:collapse;margin-bottom:6px}th,td{border:1px solid #ccc;padding:3px 5px;text-align:left}
      th{background:#eee}.r{text-align:right}.none{color:#777;font-style:italic;margin:2px 0 8px}.sub{color:#555;margin:2px 0 12px}
    </style></head><body>
      <h1>Counselor Client Report</h1>
      <p class="sub">${escapeHtml(counselorFilter || 'All counselors')} · Program: ${program || 'SO and BIP'} · Client status: ${escapeHtml(statusFilter || 'All')} · Printed ${new Date().toLocaleString()}</p>
      <table><thead><tr><th>Counselor</th><th class="r">Groups</th><th class="r">Clients</th>${both ? '<th class="r">SO</th><th class="r">BIP</th>' : ''}${phaseHeads}</tr></thead><tbody>
        ${shown.map(c => `<tr><td>${escapeHtml(c.name)}</td><td class="r">${c.groups.length}</td><td class="r">${c.clients.length}</td>${both ? `<td class="r">${c.so.length}</td><td class="r">${c.bip.length}</td>` : ''}${phaseCells(c.clients)}</tr>`).join('')}
      </tbody></table>
      ${sections}
    </body></html>`);
    win.document.close();
    win.print();
  };

  const card = (label: string, value: number, tone = 'text-white') => (
    <div key={label} className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-xl font-bold mt-1 ${tone}`}>{value}</p>
    </div>
  );

  const phaseChips = (keys: string[], counts: Map<string, number>, tone: string) => keys
    .filter(k => k !== NO_PHASE || (counts.get(k) ?? 0) > 0)
    .map(k => (
      <span key={k} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${tone}`}>
        {k}<b className="text-white">{counts.get(k) ?? 0}</b>
      </span>
    ));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">Counselor Client Report</h3>
          <p className="text-xs text-slate-400 mt-0.5">Clients in the groups each counselor leads, split by SO and BIP and counted by phase. Click a group to list its clients, and a client to open their account.</p>
          {loading && <p className="text-xs text-slate-500 mt-1">Loading discharged clients…</p>}
          {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-xs text-slate-400">Program
            <div className="mt-1 flex h-9 bg-slate-950 p-1 rounded-lg border border-slate-700">
              {([['', 'All'], ['SO', 'SO'], ['BIP', 'BIP']] as const).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setProgram(value)}
                  aria-pressed={program === value}
                  className={`px-3 rounded text-xs font-semibold transition ${program === value ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="text-xs text-slate-400">Counselor
            <select value={counselorFilter} onChange={(e) => setCounselorFilter(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs">
              <option value="">All Counselors</option>
              {counselors.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-400">Client Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs">
              <option value="">All Statuses</option>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
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

      <div className={`grid gap-3 ${program ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
        {card(program ? `${program} Clients` : 'Clients (SO + BIP)', shownAll.length, 'text-blue-400')}
        {!program && card('SO Clients', soAll.length)}
        {!program && card('BIP Clients', bipAll.length)}
        {card(program ? `${program} Groups` : 'Groups', shown.reduce((t, c) => t + c.groups.length, 0))}
      </div>

      <div className={`grid gap-3 grid-cols-1 ${program ? '' : 'md:grid-cols-2'}`}>
        {showSo && (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">SO by Phase</p>
            <div className="flex flex-wrap gap-2">{phaseChips(SO_PHASE_KEYS, soPhases, 'border-blue-500/30 bg-blue-500/10 text-blue-300')}</div>
          </div>
        )}
        {showBip && (
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">BIP by Weeks Attended</p>
            <div className="flex flex-wrap gap-2">{phaseChips(BIP_PHASE_KEYS, bipPhases, 'border-violet-500/30 bg-violet-500/10 text-violet-300')}</div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">By Counselor</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <th className="p-3">Counselor</th>
                <th className="p-3 text-right">Groups</th>
                <th className="p-3 text-right">Clients</th>
                {!program && <th className="p-3 text-right">SO</th>}
                {!program && <th className="p-3 text-right">BIP</th>}
                {showSo && SO_PHASES.map(p => <th key={p} className="p-3 text-right whitespace-nowrap">{p.replace(' - ', ' ')}</th>)}
                {program === 'BIP' && BIP_WEEK_BANDS.map(b => <th key={b.label} className="p-3 text-right whitespace-nowrap">{b.label}</th>)}
                {showBip && <th className="p-3 text-right whitespace-nowrap">BIP Avg Week</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {counselors.map(c => {
                const phases = countBy(c.so, SO_PHASE_KEYS);
                const bands = countBy(c.bip, BIP_PHASE_KEYS);
                const weeks = c.bip.map(cl => String(cl.phase ?? '').trim()).filter(p => /^\d+$/.test(p)).map(Number);
                const avgWeek = weeks.length ? Math.round(weeks.reduce((t, w) => t + w, 0) / weeks.length) : null;
                return (
                  <tr
                    key={c.name}
                    onClick={() => setCounselorFilter(counselorFilter === c.name ? '' : c.name)}
                    title={counselorFilter === c.name ? 'Show all counselors' : `Show only ${c.name}`}
                    className={`cursor-pointer transition hover:bg-slate-800/50 ${counselorFilter === c.name ? 'bg-blue-500/10' : ''}`}
                  >
                    <td className="p-3 font-medium text-white whitespace-nowrap">{c.name}</td>
                    <td className="p-3 text-right">{c.groups.length}</td>
                    <td className="p-3 text-right font-semibold text-blue-400">{c.clients.length}</td>
                    {!program && <td className="p-3 text-right">{c.so.length}</td>}
                    {!program && <td className="p-3 text-right">{c.bip.length}</td>}
                    {showSo && SO_PHASES.map(p => <td key={p} className="p-3 text-right text-slate-300">{phases.get(p) ?? 0}</td>)}
                    {program === 'BIP' && BIP_WEEK_BANDS.map(b => <td key={b.label} className="p-3 text-right text-slate-300">{bands.get(b.label) ?? 0}</td>)}
                    {showBip && <td className="p-3 text-right text-slate-300">{avgWeek === null ? '—' : avgWeek}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Groups and Clients</p>
          <button
            type="button"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(allGroupIds))}
            className="text-xs text-slate-400 hover:text-white"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-800/50 text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <th className="p-3">Group</th>
                <th className="p-3">Counselor</th>
                <th className="p-3">Program</th>
                <th className="p-3">Schedule</th>
                <th className="p-3 text-right">Clients</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-sm">
              {shown.flatMap(c => c.groups.map(({ group, clients: members }) => {
                const open = expanded.has(group.groupid);
                return (
                  <Fragment key={group.groupid}>
                    <tr onClick={() => toggle(group.groupid)} className="cursor-pointer transition hover:bg-slate-800/50">
                      <td className="p-3 font-medium text-white whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{group.groupname}
                          {group.active === false && <span className="text-[10px] uppercase bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">Inactive</span>}
                        </span>
                      </td>
                      <td className="p-3 text-slate-300 whitespace-nowrap">{c.name}</td>
                      <td className="p-3"><span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded text-xs">{group.programtype || '—'}</span></td>
                      <td className="p-3 text-slate-400 whitespace-nowrap">{group.schedule || '—'}</td>
                      <td className="p-3 text-right font-semibold">{members.length}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} className="bg-slate-950/60 px-6 py-3">
                          {members.length === 0 ? (
                            <p className="text-xs text-slate-500 italic">No clients{statusFilter ? ` with status ${statusFilter}` : ''} in this group.</p>
                          ) : (
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="text-slate-500 uppercase tracking-wider">
                                  <th className="py-1.5 pr-3">Client</th>
                                  <th className="py-1.5 pr-3">DOC #</th>
                                  <th className="py-1.5 pr-3">Program</th>
                                  <th className="py-1.5 pr-3">Phase</th>
                                  <th className="py-1.5 pr-3">Status</th>
                                  <th className="py-1.5 pr-3">Last Attended</th>
                                  <th className="py-1.5 text-right">Balance</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60">
                                {members.map(m => (
                                  <tr key={m.clientid} onClick={() => onOpenClient(m)} className="cursor-pointer hover:bg-slate-800/50" title="Open client account">
                                    <td className="py-1.5 pr-3 text-white font-medium">{m.lastname}, {m.firstname}</td>
                                    <td className="py-1.5 pr-3 text-slate-400 font-mono">{m.docnumber || '—'}</td>
                                    <td className="py-1.5 pr-3 text-slate-300">{m.programtype || '—'}</td>
                                    <td className="py-1.5 pr-3 text-slate-300">{phaseLabel(m)}</td>
                                    <td className="py-1.5 pr-3 text-slate-300">{m.programstatus || '—'}</td>
                                    <td className="py-1.5 pr-3 text-slate-400">{formatDay(m.lastattended ?? m.lastdateattended)}</td>
                                    <td className={`py-1.5 text-right ${toDisplayBalance(m.accountbalance) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{formatBalance(m.accountbalance)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              }))}
              {shown.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center text-slate-500 italic">No groups to show.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!counselorFilter && unassigned.length > 0 && (
        <p className="text-xs text-amber-400">
          {unassigned.length} client{unassigned.length === 1 ? ' is' : 's are'} not in any group, so {unassigned.length === 1 ? "isn't" : "aren't"} counted under a counselor.
        </p>
      )}
    </div>
  );
}
