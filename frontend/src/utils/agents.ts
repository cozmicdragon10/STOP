// Supervising agent directory rules: how agents are matched to clients, and how the directory list is searched and filtered.

// Clients link to an agent by name; case and surrounding spaces are ignored (the server matches the same way)
export const agentKey = (name: string | null | undefined) => String(name ?? '').trim().toLowerCase();

// Offered in the Type box; any other type can be typed in
export const AGENT_TYPE_SUGGESTIONS = ['Probation (DOC)', 'Parole (DOC)', 'Federal Probation', 'DHS', 'District Attorney', 'Pretrial'];

// Directory filter: every row, only names found on client records that have no directory entry, or only saved agents
export type DirectoryFilter = 'all' | 'missing' | 'listed';

// The Type filter value for agents with no type
export const NO_TYPE = '__none__';

// Active client filter: every agent, only agents with at least one Active client, or only agents with none
export type ActiveClientFilter = 'all' | 'with' | 'without';

export interface AgentFilterRow {
  name: string;
  agent: { phone: string | null; email: string | null; agenttype: string | null; location: string | null } | null;
  // Clients with program status Active assigned to this agent
  activeClients: number;
}

export interface AgentFilters {
  search: string;
  directory: DirectoryFilter;
  // '' for every type; NO_TYPE for agents with no type
  type: string;
  // Missing means every agent
  active?: ActiveClientFilter;
}

// The rows matching the search (name, phone, email, type, or location), directory, type, and active client filters.
// Names not in the directory have no type, so they only show under "every type" or "no type".
export function filterAgentRows<T extends AgentFilterRow>(rows: T[], { search, directory, type, active = 'all' }: AgentFilters): T[] {
  const term = search.trim().toLowerCase();
  return rows.filter(r => {
    if (directory === 'missing' && r.agent) return false;
    if (directory === 'listed' && !r.agent) return false;
    if (active === 'with' && r.activeClients === 0) return false;
    if (active === 'without' && r.activeClients > 0) return false;
    if (type) {
      const rowType = agentKey(r.agent?.agenttype);
      if (type === NO_TYPE ? rowType !== '' : rowType !== agentKey(type)) return false;
    }
    if (!term) return true;
    return [r.name, r.agent?.phone, r.agent?.email, r.agent?.agenttype, r.agent?.location]
      .some(v => String(v ?? '').toLowerCase().includes(term));
  });
}

// Distinct non-blank values (case and spacing ignored, first spelling kept), sorted; for the Type and Location suggestions
export function distinctValues(values: (string | null | undefined)[]): string[] {
  const byKey = new Map<string, string>();
  for (const v of values) {
    const text = String(v ?? '').trim();
    if (text && !byKey.has(agentKey(text))) byKey.set(agentKey(text), text);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
}
