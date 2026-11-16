import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MyDay from './MyDay';

interface GroupRow {
  groupid: number | string;
  groupname?: string | null;
  counselor?: string | null;
  schedule?: string | null;
  active?: boolean | null;
  clientcount?: number | null;
}

interface Props {
  employees: { displayname?: string | null; role?: string | null; active?: boolean | null }[];
  groups: GroupRow[];
}

const PICK_KEY = 'stop.calendars.counselor';

// The Calendars tab (Business Administrators, Office Admins and DEV): any counselor's calendar, the same one they see
// as My Day: their groups (held, open, coming up, cancelled or moved) and their assessment times. Office users can
// cancel or reschedule a counselor's upcoming meetings from here too.
export default function CalendarsTab({ employees, groups }: Props) {
  const counselors = Array.from(new Set(employees
    .filter(e => e.active !== false && e.role === 'Counselor' && e.displayname)
    .map(e => e.displayname as string))).sort((a, b) => a.localeCompare(b));
  const [picked, setPickedState] = useState(() => {
    try { return localStorage.getItem(PICK_KEY) || ''; } catch { return ''; }
  });
  const setPicked = (name: string) => {
    setPickedState(name);
    try { localStorage.setItem(PICK_KEY, name); } catch { /* just not remembered */ }
  };
  // The remembered counselor when still active, else the first one
  const counselor = counselors.includes(picked) ? picked : counselors[0] ?? '';
  const at = counselors.indexOf(counselor);

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Counselor Calendars</h2>
          <p className="text-xs text-slate-400 mt-0.5">Each counselor's month: groups held, open, coming up, cancelled or moved, and their assessment times.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPicked(counselors[at - 1])} disabled={at <= 0} aria-label="Previous counselor" className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40">
            <ChevronLeft size={16} />
          </button>
          <label htmlFor="calendars-counselor" className="sr-only">Counselor</label>
          <select id="calendars-counselor" value={counselor} onChange={e => setPicked(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg p-2 text-white text-sm min-w-56">
            {counselors.length === 0 && <option value="">No active counselors</option>}
            {counselors.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <button type="button" onClick={() => setPicked(counselors[at + 1])} disabled={at < 0 || at >= counselors.length - 1} aria-label="Next counselor" className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-40">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      {counselor ? (
        <MyDay key={counselor} displayName={counselor} groups={groups} viewing />
      ) : (
        <p className="text-sm text-slate-500">There are no active counselors to show.</p>
      )}
    </div>
  );
}
