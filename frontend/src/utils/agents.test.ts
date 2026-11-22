import { describe, expect, it } from 'vitest';
import { NO_TYPE, distinctValues, filterAgentRows } from './agents';

const agent = (agenttype: string | null, location: string | null = null) => ({ phone: null, email: null, agenttype, location });
const rows = [
  { name: 'Aarika Holt', agent: agent('DHS', 'Tulsa'), activeClients: 0 },
  { name: 'Aaron Lanford', agent: agent('Probation (DOC)', 'Tulsa County'), activeClients: 3 },
  { name: 'Adam Fisher', agent: agent(null), activeClients: 0 },
  { name: 'Unknown Person', agent: null, activeClients: 1 },
];
const names = (r: { name: string }[]) => r.map(x => x.name);
const all = { search: '', directory: 'all' as const, type: '' };

describe('filterAgentRows', () => {
  it('keeps every row with no filters', () => {
    expect(filterAgentRows(rows, all)).toHaveLength(4);
  });

  it('shows only names not in the directory, or only saved agents', () => {
    expect(names(filterAgentRows(rows, { ...all, directory: 'missing' }))).toEqual(['Unknown Person']);
    expect(filterAgentRows(rows, { ...all, directory: 'listed' })).toHaveLength(3);
  });

  it('filters by type ignoring case, and by no type', () => {
    expect(names(filterAgentRows(rows, { ...all, type: 'dhs' }))).toEqual(['Aarika Holt']);
    expect(names(filterAgentRows(rows, { ...all, type: NO_TYPE }))).toEqual(['Adam Fisher', 'Unknown Person']);
  });

  it('shows agents with active clients, without them, or both', () => {
    expect(names(filterAgentRows(rows, { ...all, active: 'with' }))).toEqual(['Aaron Lanford', 'Unknown Person']);
    expect(names(filterAgentRows(rows, { ...all, active: 'without' }))).toEqual(['Aarika Holt', 'Adam Fisher']);
    expect(filterAgentRows(rows, { ...all, active: 'all' })).toHaveLength(4);
  });

  it('searches type and location too', () => {
    expect(names(filterAgentRows(rows, { ...all, search: 'tulsa' }))).toEqual(['Aarika Holt', 'Aaron Lanford']);
    expect(names(filterAgentRows(rows, { ...all, search: 'probation' }))).toEqual(['Aaron Lanford']);
  });
});

describe('distinctValues', () => {
  it('drops blanks and case/spacing duplicates, keeping the first spelling, sorted', () => {
    expect(distinctValues(['Tulsa', ' tulsa ', '', null, 'Creek'])).toEqual(['Creek', 'Tulsa']);
  });
});
