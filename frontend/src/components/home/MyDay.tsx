import { clientsNotAttendedThisMonth, groupsMeetingOn, isMyClient, myGroupIds, weekdayName } from '../../utils/counselor';
import type { ClientOwnership } from '../../utils/counselor';

interface GroupRow {
  groupid: number | string;
  groupname?: string | null;
  counselor?: string | null;
  schedule?: string | null;
  active?: boolean | null;
  clientcount?: number | null;
}

interface ClientRow extends ClientOwnership {
  clientid: number;
  firstname?: string | null;
  lastname?: string | null;
  programstatus?: string | null;
  attendedthismonth?: boolean | null;
}

interface Props {
  displayName: string;
  groups: GroupRow[];
  clients: ClientRow[];
  onOpenAttendance: () => void;
  onOpenClient: (clientId: number) => void;
}

const SHOWN_CLIENTS = 8;

// The counselor's home screen: today's groups and their own clients who haven't attended this month.
// Nothing about money is shown here, since clients are often in the room.
export default function MyDay({ displayName, groups, clients, onOpenAttendance, onOpenClient }: Props) {
  const today = new Date();
  const day = weekdayName(today);
  const meeting = groupsMeetingOn(groups, displayName, day);
  const groupIds = myGroupIds(groups, displayName);
  const notIn = clientsNotAttendedThisMonth(clients.filter(c => isMyClient(c, groupIds, displayName)));
  const dateLabel = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <section aria-label="My Day" className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-white">My Day</h3>
        <p className="text-xs text-slate-400">{dateLabel}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Groups I lead on {day}s</p>
          {meeting.length === 0 ? (
            <p className="text-sm text-slate-500">No groups of yours meet today.</p>
          ) : (
            <ul className="space-y-2">
              {meeting.map(g => (
                <li key={g.groupid} className="text-sm">
                  <span className="block text-white truncate">{g.groupname}</span>
                  <span className="block text-xs text-slate-400">{g.schedule}{g.clientcount != null ? ` · ${g.clientcount} active` : ''}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={onOpenAttendance} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded text-xs font-semibold">Open Attendance & Sign-In</button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">My clients not in this month</p>
          <p className="text-2xl font-bold text-white">{notIn.length}</p>
          {notIn.length > 0 && (
            <ul className="space-y-1 text-sm">
              {notIn.slice(0, SHOWN_CLIENTS).map(c => (
                <li key={c.clientid}>
                  <button type="button" onClick={() => onOpenClient(Number(c.clientid))} className="text-left text-blue-300 hover:text-blue-200 hover:underline truncate max-w-full">
                    {c.lastname}, {c.firstname}
                  </button>
                </li>
              ))}
              {notIn.length > SHOWN_CLIENTS && <li className="text-xs text-slate-500">and {notIn.length - SHOWN_CLIENTS} more in the roster</li>}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
