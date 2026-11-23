import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Mail, TriangleAlert } from 'lucide-react';
import { createPoReportDraft, fetchPoClientReport, getPoReportMonth } from '../../api';
import type { PoReportAgent, PoReportMonth } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { idText } from '../../utils/clients';
import { useTableSort } from '../../hooks/useTableSort';
import { sortRows } from '../../utils/tableSort';
import SortableTh from '../SortableTh';

interface Props {
  userEmail: string;
  onOpenClient: (clientId: number) => void;
}

// The month before this one, as YYYY-MM (reports go out for the month just finished)
const lastMonth = () => {
  const [y, m] = todayLocal().split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const monthLabel = (month: string) =>
  new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
const formatWhen = (value: string) => new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message) || fallback;

const saveFile = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

// Monthly reports to supervising agents: a PDF per active client, grouped by agent into an unsent Outlook draft.
// Nothing is emailed from here; the draft opens in Outlook and someone checks it and presses Send.
export default function MonthlyPoReports({ userEmail, onOpenClient }: Props) {
  // The report period: From (month) through To (toMonth). Both start on last month, a one-month report.
  const [month, setMonth] = useState(lastMonth);
  const [toMonth, setToMonth] = useState(lastMonth);
  const period = `${month}..${toMonth}`;
  // The period the data (or load error) is for; another period shows Loading until it arrives
  const [loaded, setLoaded] = useState<{ period: string; data: PoReportMonth | null; error: string } | null>(null);
  // Bumped to reload the month in place (after a draft is made, so its "Draft made" shows)
  const [refresh, setRefresh] = useState(0);
  // Errors from viewing a PDF or making a draft
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyUndrafted, setOnlyUndrafted] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showNoAgent, setShowNoAgent] = useState(false);
  // The agent whose draft is being made
  const [drafting, setDrafting] = useState<string | null>(null);
  // One sort for every agent's client list
  const clientSort = useTableSort<'client' | 'id' | 'attended' | 'calledin' | 'notecount'>();

  const validMonth = /^\d{4}-\d{2}$/.test(month) && /^\d{4}-\d{2}$/.test(toMonth) && toMonth >= month;
  useEffect(() => {
    if (!validMonth) return;
    let cancelled = false;
    getPoReportMonth(month, toMonth)
      .then(d => { if (!cancelled) setLoaded({ period, data: d, error: '' }); })
      .catch(err => { if (!cancelled) setLoaded({ period, data: null, error: errorText(err, 'Failed to load the monthly PO reports.') }); });
    return () => { cancelled = true; };
  }, [month, toMonth, period, validMonth, refresh]);
  const data = loaded?.period === period ? loaded.data : null;
  const loadError = loaded?.period === period ? loaded.error : '';
  // Moving From past To moves To with it (and To before From moves From), so the range always runs forward
  const changeFrom = (value: string) => { setMonth(value); if (value && value > toMonth) setToMonth(value); };
  const changeTo = (value: string) => { setToMonth(value); if (value && value < month) setMonth(value); };
  const reload = useCallback(() => setRefresh(n => n + 1), []);

  const toggle = (name: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const viewPdf = async (clientId: number) => {
    setError('');
    // Opened before the fetch so the browser doesn't treat it as a blocked popup
    const viewer = window.open('', '_blank');
    try {
      const url = URL.createObjectURL(await fetchPoClientReport(clientId, month, toMonth));
      if (viewer) viewer.location.href = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      viewer?.close();
      setError(errorText(err, 'Could not make the client report.'));
    }
  };

  const makeDraft = async (agent: PoReportAgent) => {
    setError('');
    setDrafting(agent.name);
    try {
      const { blob, fileName } = await createPoReportDraft(month, agent.name, userEmail, toMonth);
      saveFile(blob, fileName);
      reload();
    } catch (err) {
      setError(errorText(err, 'Could not make the Outlook draft.'));
    } finally {
      setDrafting(null);
    }
  };

  const needle = search.trim().toLowerCase();
  const agents = (data?.agents ?? []).filter(a =>
    (!onlyUndrafted || !a.lastDraft)
    && (!needle || a.name.toLowerCase().includes(needle)
      || a.clients.some(c => `${c.lastname}, ${c.firstname} ${idText(c)}`.toLowerCase().includes(needle))));
  const clientTotal = data?.agents.reduce((n, a) => n + a.clients.length, 0) ?? 0;
  const draftedTotal = data?.agents.filter(a => a.lastDraft).length ?? 0;
  const noEmail = data?.agents.filter(a => !a.email).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <h3 className="font-semibold text-white">Monthly PO Reports</h3>
            <p className="text-xs text-slate-400 mt-1">A PDF for each active client, grouped into one Outlook draft per supervising agent.</p>
          </div>
          {/* A range of months makes one report per client covering all of them; the same month in both is one month */}
          <div className="ml-auto flex items-end gap-2">
            <label className="text-xs text-slate-400">
              From
              <input
                type="month"
                value={month}
                max={todayLocal().slice(0, 7)}
                onChange={e => changeFrom(e.target.value)}
                className="block mt-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              To
              <input
                type="month"
                value={toMonth}
                max={todayLocal().slice(0, 7)}
                onChange={e => changeTo(e.target.value)}
                className="block mt-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white"
              />
            </label>
          </div>
        </div>

        <div className="flex gap-2 items-start text-xs text-sky-200 bg-sky-500/10 border border-sky-500/30 rounded-lg p-3">
          <Mail size={16} className="shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p>
              Nothing is emailed from here. <strong>Create Outlook draft</strong> makes an unsent email addressed to the agent with
              their clients' reports attached. Look it over in Outlook and press Send there.
            </p>
            <p className="text-sky-300/80">
              To have Outlook open by itself on this PC: after the first draft, open the browser's downloads list (Ctrl+J),
              right-click the .eml file, and choose <strong>Always open files of this type</strong>.
            </p>
          </div>
        </div>

        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800"><p className="text-xs text-slate-400">Agents</p><p className="text-xl font-bold text-white">{data.agents.length}</p></div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800"><p className="text-xs text-slate-400">Client reports</p><p className="text-xl font-bold text-white">{clientTotal}</p></div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800"><p className="text-xs text-slate-400">Drafts made</p><p className="text-xl font-bold text-emerald-400">{draftedTotal} / {data.agents.length}</p></div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800"><p className="text-xs text-slate-400">Agents with no email</p><p className={`text-xl font-bold ${noEmail ? 'text-amber-400' : 'text-white'}`}>{noEmail}</p></div>
          </div>
        )}

        {data && data.noAgent.length > 0 && (
          <div className="text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-amber-200">
            <button type="button" onClick={() => setShowNoAgent(v => !v)} className="flex items-center gap-2 font-semibold">
              <TriangleAlert size={14} />
              {data.noAgent.length} active client{data.noAgent.length === 1 ? ' has' : 's have'} no supervising agent and won't get a report.
              {showNoAgent ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {showNoAgent && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {data.noAgent.map(c => (
                  <button key={c.clientid} type="button" onClick={() => onOpenClient(c.clientid)} className="hover:underline text-left">
                    {c.lastname}, {c.firstname}{c.docnumber ? ` (${idText(c)})` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agent, client, or ID #"
            className="flex-1 min-w-[200px] bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white"
          />
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={onlyUndrafted} onChange={e => setOnlyUndrafted(e.target.checked)} />
            Only agents without a draft
          </label>
        </div>

        {(error || loadError) && <p className="text-xs text-red-400">{error || loadError}</p>}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl divide-y divide-slate-800">
        {!data && !loadError &&<p className="p-6 text-center text-slate-500 text-sm">{validMonth ? 'Loading…' : 'Pick a report month.'}</p>}
        {data && agents.length === 0 && <p className="p-6 text-center text-slate-500 text-sm">No agents match.</p>}
        {data && agents.map(a => {
          const open = expanded.has(a.name);
          return (
            <div key={a.name}>
              <div className="flex flex-wrap items-center gap-3 p-4">
                <button type="button" onClick={() => toggle(a.name)} className="flex items-center gap-2 text-left min-w-0 flex-1" aria-expanded={open}>
                  {open ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                  <span className="min-w-0">
                    <span className="block font-medium text-white">{a.name} <span className="text-slate-400 font-normal">· {a.clients.length} client{a.clients.length === 1 ? '' : 's'}</span></span>
                    <span className={`block text-xs ${a.email ? 'text-slate-400' : 'text-amber-400'}`}>
                      {a.email || (a.inDirectory ? 'No email on file. Add it under Supervising Agents, or type it in Outlook.' : 'Not in the Supervising Agents directory, so no email. Type it in Outlook.')}
                    </span>
                  </span>
                </button>
                <span className={`text-xs ${a.lastDraft ? 'text-emerald-400' : 'text-slate-500'}`}>
                  {a.lastDraft
                    ? `Draft made ${formatWhen(a.lastDraft.createdOn)}${a.lastDraft.createdBy ? ` by ${a.lastDraft.createdBy}` : ''}`
                    : 'No draft yet'}
                </span>
                <button
                  type="button"
                  onClick={() => makeDraft(a)}
                  disabled={drafting !== null}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                >
                  <Mail size={14} />
                  {drafting === a.name ? 'Making draft…' : a.lastDraft ? 'Make draft again' : 'Create Outlook draft'}
                </button>
              </div>
              {open && (
                <table className="stack-table w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-800/50 text-slate-400 uppercase">
                      <SortableTh k="client" table={clientSort} className="p-2 pl-11">Client</SortableTh>
                      <SortableTh k="id" table={clientSort} className="p-2">ID #</SortableTh>
                      <SortableTh k="attended" table={clientSort} className="p-2">Attended</SortableTh>
                      <SortableTh k="calledin" table={clientSort} className="p-2">Called in</SortableTh>
                      <SortableTh k="notecount" table={clientSort} className="p-2">Notes</SortableTh>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-sm">
                    {sortRows(a.clients, clientSort.sort, (c, k) => (k === 'client' ? `${c.lastname}, ${c.firstname}` : k === 'id' ? idText(c) : c[k])).map(c => (
                      <tr key={c.clientid}>
                        <td className="p-2 pl-11">
                          <button type="button" onClick={() => onOpenClient(c.clientid)} className="font-medium text-white hover:underline text-left">{c.lastname}, {c.firstname}</button>
                        </td>
                        <td data-label="ID #" className="p-2 text-slate-300">{idText(c) || '—'}</td>
                        <td data-label="Attended" className={`p-2 ${c.attended === 0 ? 'text-amber-400' : c.attended === null ? 'text-slate-500' : 'text-slate-300'}`}
                          title={c.attended === null ? `${c.programtype} clients don't attend groups.` : undefined}>{c.attended ?? 'N/A'}</td>
                        <td data-label="Called in" className={`p-2 ${c.calledin === null ? 'text-slate-500' : 'text-slate-300'}`}>{c.calledin ?? 'N/A'}</td>
                        <td data-label="Notes" className="p-2 text-slate-300">{c.notecount}</td>
                        <td className="p-2 text-right">
                          <button type="button" onClick={() => viewPdf(c.clientid)} className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                            <FileText size={14} /> View PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
      {data && <p className="text-xs text-slate-500">Reports for {month === toMonth ? monthLabel(month) : `${monthLabel(month)} – ${monthLabel(toMonth)}`}. "Draft made" means the Outlook draft was downloaded, not that it was sent.</p>}
    </div>
  );
}
