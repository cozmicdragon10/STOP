import { useEffect, useState } from 'react';
import { getGroupScheduleChanges, getMySessions } from '../../api';
import type { GroupScheduleChange, MyAssessment, MyClosedSession, MyOpenSession } from '../../api';
import { dayKey, monthGrid, monthOfDate, myGroupIds, scheduledDatesIn, shiftMonth } from '../../utils/counselor';
import { formatDisplayTime } from '../../utils/dates';
import { parseSchedule } from '../../utils/schedule';
import GroupMeetingPanel, { type Meeting } from './GroupMeetingPanel';
import AssessmentTimePanel, { type PanelClient } from './AssessmentTimePanel';

interface GroupRow {
  groupid: number | string;
  groupname?: string | null;
  counselor?: string | null;
  schedule?: string | null;
  active?: boolean | null;
  clientcount?: number | null;
}

interface Props {
  displayName: string;
  groups: GroupRow[];
  onOpenAttendance?: () => void;
  // The Calendars tab: an office user looking at this counselor's calendar instead of their own
  viewing?: boolean;
  // Clients who can be assigned to an open assessment time (active ones are offered)
  clients?: PanelClient[];
}

// A day's chip: a group session (closed, open, or coming up), or one of the counselor's assessment times (open
// availability, or a client booked)
// An upcoming meeting of a group the counselor leads carries `meeting`, so its chip opens the cancel/reschedule panel.
// label is the short chip text; name, detail and sort (HH:MM, '' when no time) are for the day's list when the day is clicked.
interface DayItem {
  key: string;
  kind: 'closed' | 'open' | 'scheduled' | 'cancelled' | 'moved' | 'assessOpen' | 'assessBooked';
  label: string;
  title: string;
  name: string;
  detail: string;
  sort: string;
  meeting?: Meeting;
  // An assessment time from today on: assign a client (open), or cancel or reschedule (scheduled)
  appt?: MyAssessment;
}
// '5:00 PM' -> '17:00', for sorting a day's list by time
const to24h = (time: string) => {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time || '');
  return match ? `${String((Number(match[1]) % 12) + (match[3] === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[2]}` : '';
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const KIND_STYLE: Record<DayItem['kind'], string> = {
  closed: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
  open: 'bg-amber-500/15 border-amber-500/40 text-amber-200',
  scheduled: 'bg-transparent border-dashed border-blue-400/60 text-blue-200',
  cancelled: 'bg-rose-500/10 border-rose-500/40 text-rose-300 line-through',
  moved: 'bg-transparent border-dashed border-rose-400/50 text-rose-300',
  assessOpen: 'bg-transparent border-dashed border-violet-400/60 text-violet-200',
  assessBooked: 'bg-violet-500/20 border-violet-500/50 text-violet-100',
};
const KIND_LABEL: Record<DayItem['kind'], string> = {
  closed: 'Closed', open: 'Open', scheduled: 'Scheduled', cancelled: 'Cancelled', moved: 'Moved',
  assessOpen: 'Open assessment time', assessBooked: 'Assessment',
};
const shortDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const assessmentClient = (a: MyAssessment) => (a.status === 'Scheduled' ? `${a.lastname ?? ''}, ${a.firstname ?? ''}` : 'Open');
const assessmentPlace = (a: MyAssessment) => a.location || 'No location set';
const MAX_CHIPS = 3;
const WEEKDAY_HEADINGS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "Closed by you", "Closed on your behalf", etc., from what the server says about the session
// you: the counselor is reading their own calendar; otherwise the tags describe the counselor being viewed
const closedTags = (s: MyClosedSession, you: boolean) => [
  s.openedbyme && (you ? 'You opened' : 'Opened'),
  s.closedbyme ? (you ? 'You closed' : 'Closed') : s.coveredforme && (you ? 'Closed on your behalf' : 'Closed on their behalf'),
].filter(Boolean) as string[];
const openTags = (s: MyOpenSession, you: boolean) => [
  s.openedbyme && (you ? 'You opened' : 'Opened'),
  s.coveredforme && (you ? "You're covering" : 'Covering'),
].filter(Boolean) as string[];

const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

// The counselor's home screen: a calendar of their groups for the month (closed, open, and what's coming up), and the
// sessions they opened, closed, or covered that month. No client or money figures here.
export default function MyDay({ displayName, groups, onOpenAttendance, viewing = false, clients = [] }: Props) {
  const todayKey = dayKey(new Date());
  const [month, setMonth] = useState(monthOfDate(new Date()));
  const [sessions, setSessions] = useState<{ closed: MyClosedSession[]; open: MyOpenSession[]; assessments: MyAssessment[] } | null>(null);
  const [error, setError] = useState('');
  // Cancelled and rescheduled meetings this month; reloaded after a change (changesKey)
  const [changes, setChanges] = useState<GroupScheduleChange[]>([]);
  const [changesKey, setChangesKey] = useState(0);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [notice, setNotice] = useState('');
  // The day clicked on the calendar; its full list shows under the calendar. Defaults to today in the current month.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  // The assessment time being assigned, rescheduled or cancelled; sessionsKey reloads the month after a change
  const [selectedAppt, setSelectedAppt] = useState<MyAssessment | null>(null);
  const [sessionsKey, setSessionsKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getMySessions(month, viewing ? displayName : undefined)
      .then(rows => { if (!cancelled) { setSessions(rows); setError(''); } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the sessions.'); });
    return () => { cancelled = true; };
  }, [month, viewing, displayName, sessionsKey]);
  // One panel at a time: a group meeting or an assessment time
  const openMeeting = (meeting: Meeting) => { setSelectedAppt(null); setSelected(meeting); };
  const openAppt = (appt: MyAssessment) => { setSelected(null); setSelectedAppt(appt); };

  useEffect(() => {
    let cancelled = false;
    getGroupScheduleChanges(month)
      .then(rows => { if (!cancelled) setChanges(rows); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load group changes.'); });
    return () => { cancelled = true; };
  }, [month, changesKey]);

  // Only the groups this counselor leads; keyed "groupid|original date"
  const mine = myGroupIds(groups, displayName);
  const myChanges = changes.filter(c => mine.has(String(c.groupid)));
  const changeFor = new Map(myChanges.map(c => [`${c.groupid}|${c.originaldate}`, c]));
  const groupById = new Map(groups.map(g => [String(g.groupid), g]));
  const meetingOf = (groupid: number | string, groupname: string, date: string, change?: GroupScheduleChange): Meeting => {
    const g = groupById.get(String(groupid));
    return { groupid, groupname, date, time: parseSchedule(g?.schedule || '').time, clients: g?.clientcount ?? null, change };
  };

  // Calendar entries by day: sessions from the server, then the upcoming scheduled groups that haven't happened yet
  const byDay = new Map<string, DayItem[]>();
  const add = (day: string, item: DayItem) => byDay.set(day, [...(byDay.get(day) ?? []), item]);
  const taken = new Set<string>();
  // A group's regular meeting time ('5:00 PM'), from its schedule
  const groupTime = (groupid: number | string) => parseSchedule(groupById.get(String(groupid))?.schedule || '').time;
  const groupItem = (key: string, kind: DayItem['kind'], name: string, groupid: number | string, detail: string): DayItem => ({
    key, kind, label: name, title: `${KIND_LABEL[kind]}: ${name}`, name, detail, sort: to24h(groupTime(groupid)),
  });
  for (const s of sessions?.closed ?? []) {
    taken.add(`${s.sessiondate}|${s.groupid}`);
    const tags = closedTags(s, !viewing);
    add(s.sessiondate, groupItem(`c${s.groupid}-${s.sessiondate}-${s.sessionnumber}`, 'closed', s.groupname, s.groupid,
      [`Closed · ${plural(s.clients, 'client')} checked in`, ...tags].join(' · ')));
  }
  for (const s of sessions?.open ?? []) {
    taken.add(`${s.sessiondate}|${s.groupid}`);
    add(s.sessiondate, groupItem(`o${s.groupid}-${s.sessiondate}-${s.sessionnumber}`, 'open', s.groupname, s.groupid,
      ['Check-in sheet still open', ...openTags(s, !viewing)].join(' · ')));
  }
  // Upcoming meetings: click to cancel or reschedule; a changed one shows as Cancelled, or Moved with its new date
  for (const [day, meets] of scheduledDatesIn(groups, displayName, month, todayKey)) {
    for (const g of meets) {
      if (taken.has(`${day}|${g.groupid}`)) continue;
      const name = g.groupname || '';
      const time = groupTime(g.groupid);
      const change = changeFor.get(`${g.groupid}|${day}`);
      const meeting = meetingOf(g.groupid, name, day, change);
      const why = change?.reason ? ` · Reason: ${change.reason}` : '';
      if (!change) {
        add(day, { ...groupItem(`s${g.groupid}-${day}`, 'scheduled', name, g.groupid, `Coming up${time ? ` at ${time}` : ''}`), meeting });
      } else if (change.action === 'Cancelled') {
        add(day, { key: `x${change.changeid}`, kind: 'cancelled', label: name, title: `Cancelled: ${name}`, name, detail: `Cancelled${why}`, sort: to24h(time), meeting });
      } else {
        const moved = `${shortDate(change.newdate || '')} at ${formatDisplayTime(change.newtime || '')}`;
        add(day, { key: `m${change.changeid}`, kind: 'moved', label: `${name} → ${shortDate(change.newdate || '')}`, title: `Moved to ${moved}: ${name}`, name, detail: `Moved to ${moved}${why}`, sort: to24h(time), meeting });
      }
    }
  }
  // Where a rescheduled meeting moved to (its original date may be in another month)
  for (const c of myChanges) {
    if (c.action !== 'Rescheduled' || !c.newdate || !c.newdate.startsWith(month)) continue;
    const time = formatDisplayTime(c.newtime || '');
    add(c.newdate, {
      key: `r${c.changeid}`, kind: 'scheduled', label: `${time} ${c.groupname}`,
      title: `Rescheduled from ${shortDate(c.originaldate)}: ${c.groupname} at ${time}`,
      name: c.groupname, detail: `Rescheduled here from ${shortDate(c.originaldate)} · at ${time}${c.reason ? ` · Reason: ${c.reason}` : ''}`,
      sort: c.newtime || '',
      meeting: meetingOf(c.groupid, c.groupname, c.originaldate, c),
    });
  }
  // Assessment times; the chip shows the time and location, the hover text and day list the client too
  for (const a of sessions?.assessments ?? []) {
    const kind = a.status === 'Scheduled' ? 'assessBooked' : 'assessOpen';
    const time = formatDisplayTime(a.appttime);
    add(a.apptdate, {
      key: `a${a.appointmentid}`,
      kind,
      label: `${time} ${a.location || 'Assessment'}`,
      title: `${KIND_LABEL[kind]} at ${time}, ${assessmentPlace(a)}${a.status === 'Scheduled' ? `: ${assessmentClient(a)}` : ''}`,
      name: a.status === 'Scheduled' ? `Assessment: ${assessmentClient(a)}` : 'Open assessment time',
      detail: `${time} · ${assessmentPlace(a)}`,
      sort: a.appttime,
      // Past times can't be assigned or moved (the server refuses earlier dates)
      appt: a.apptdate >= todayKey ? a : undefined,
    });
  }
  // The picked day (if it's in this month), else today when looking at the current month
  const shownDay = pickedDay?.startsWith(month) ? pickedDay : todayKey.startsWith(month) ? todayKey : null;
  // That day's entries by time; entries with no time (held sessions of a group without a schedule) go last
  const dayEntries = shownDay
    ? [...(byDay.get(shownDay) ?? [])].sort((a, b) => (a.sort || '99').localeCompare(b.sort || '99') || a.name.localeCompare(b.name))
    : [];
  const pickDay = (day: string) => { setPickedDay(day); setNotice(''); };
  const assessments = sessions?.assessments ?? [];

  const listed = [
    ...(sessions?.closed ?? []).map(s => ({ day: s.sessiondate, kind: 'closed' as const, groupname: s.groupname, tags: closedTags(s, !viewing), clients: s.clients })),
    ...(sessions?.open ?? []).map(s => ({ day: s.sessiondate, kind: 'open' as const, groupname: s.groupname, tags: openTags(s, !viewing), clients: null })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.groupname.localeCompare(b.groupname));

  const isCurrentMonth = month === monthOfDate(new Date());

  return (
    <section aria-label={viewing ? `${displayName}'s calendar` : 'My Day'} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{viewing ? `${displayName}'s Calendar` : 'My Day'}</h3>
          <p className="text-xs text-slate-400">
            {viewing
              ? `${displayName}'s groups and assessment times for the month: what they opened, closed, or covered, and what's coming up.`
              : "Your groups and assessment times for the month: what you opened, closed, or covered, and what's coming up."}
          </p>
        </div>
        {onOpenAttendance && (
          <button type="button" onClick={onOpenAttendance} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded text-xs font-semibold">Open Attendance & Sign-In</button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month" className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-semibold">← Previous</button>
        <input
          type="month"
          value={month}
          onChange={e => { if (e.target.value) setMonth(e.target.value); }}
          aria-label="Month"
          className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs"
        />
        <button type="button" onClick={() => setMonth(m => shiftMonth(m, 1))} aria-label="Next month" className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-semibold">Next →</button>
        {!isCurrentMonth && (
          <button type="button" onClick={() => setMonth(monthOfDate(new Date()))} className="text-xs text-blue-300 hover:text-blue-200 underline px-2">This month</button>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">{error}</p>}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 md:p-4 overflow-x-auto">
        <div className="grid grid-cols-7 gap-1 min-w-[560px]">
          {WEEKDAY_HEADINGS.map(w => (
            <div key={w} className="text-[11px] uppercase tracking-wide text-slate-500 px-1 pb-1">{w}</div>
          ))}
          {monthGrid(month).map((day, i) => {
            if (!day) return <div key={`blank-${i}`} className="min-h-24" />;
            const items = byDay.get(day) ?? [];
            const isToday = day === todayKey;
            const picked = day === shownDay;
            // The whole day opens its list below the calendar; a group chip inside also opens its cancel/reschedule panel
            return (
              <div
                key={day}
                role="button"
                tabIndex={0}
                aria-pressed={picked}
                aria-label={`${longDate(day)}: ${items.length ? plural(items.length, 'item') : 'nothing scheduled'}`}
                onClick={() => pickDay(day)}
                onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickDay(day); } }}
                className={`min-h-24 rounded-lg border p-1.5 space-y-1 cursor-pointer transition hover:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${picked ? 'border-blue-400 bg-blue-500/10 ring-1 ring-blue-400/60' : isToday ? 'border-blue-500/60 bg-blue-500/5' : 'border-slate-800 bg-slate-950/40'}`}>
                <p className={`text-xs ${isToday ? 'text-blue-300 font-semibold' : 'text-slate-400'}`}>{Number(day.slice(8))}</p>
                {items.slice(0, MAX_CHIPS).map(item => (item.meeting || item.appt ? (
                  <button
                    key={item.key}
                    type="button"
                    title={`${item.title} (click to ${item.appt ? (item.appt.status === 'Open' ? 'assign a client' : 'cancel or reschedule') : item.meeting!.change ? 'see or undo the change' : 'cancel or reschedule'})`}
                    onClick={e => { e.stopPropagation(); pickDay(day); if (item.appt) openAppt(item.appt); else openMeeting(item.meeting!); }}
                    className={`block w-full text-left text-[11px] leading-tight border rounded px-1 py-0.5 truncate hover:brightness-125 ${KIND_STYLE[item.kind]}`}>
                    {item.label}
                  </button>
                ) : (
                  <p key={item.key} title={item.title} className={`text-[11px] leading-tight border rounded px-1 py-0.5 truncate ${KIND_STYLE[item.kind]}`}>
                    {item.label}
                  </p>
                )))}
                {items.length > MAX_CHIPS && <p className="text-[11px] text-slate-500">+{items.length - MAX_CHIPS} more</p>}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-4 text-[11px] text-slate-400 mt-3">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-emerald-500/40 bg-emerald-500/15" /> Closed</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-amber-500/40 bg-amber-500/15" /> Still open</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-dashed border-blue-400/60" /> Scheduled, coming up</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-rose-500/40 bg-rose-500/10" /> Cancelled</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-dashed border-rose-400/50" /> Moved to another day</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-violet-500/50 bg-violet-500/20" /> Assessment with a client</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded border border-dashed border-violet-400/60" /> Open assessment time</span>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">Click a day to see everything on it. Click an upcoming group to cancel or reschedule that meeting; its clients get a case note.</p>
      </div>

      {shownDay && (
        <section aria-label={`Everything on ${longDate(shownDay)}`} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-white">
              {new Date(`${shownDay}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              {shownDay === todayKey && <span className="ml-2 text-xs font-normal text-blue-300">Today</span>}
            </h4>
            <span className="text-xs text-slate-400">{dayEntries.length ? plural(dayEntries.length, 'item') : 'Nothing scheduled'}</span>
          </div>
          {dayEntries.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No groups or assessment times on this day.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {dayEntries.map(item => (
                <li key={item.key} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex items-start gap-2">
                    <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded border text-[11px] no-underline ${KIND_STYLE[item.kind].replace('line-through', '')}`}>{KIND_LABEL[item.kind]}</span>
                    <span className="min-w-0">
                      <span className={`block text-white ${item.kind === 'cancelled' ? 'line-through text-slate-400' : ''}`}>{item.name}</span>
                      <span className="block text-xs text-slate-400">{item.detail}</span>
                    </span>
                  </span>
                  {item.meeting && (
                    <button type="button" onClick={() => openMeeting(item.meeting!)} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-semibold">
                      {item.meeting.change ? 'See change / Undo' : 'Cancel or Reschedule'}
                    </button>
                  )}
                  {item.appt && (
                    <button type="button" onClick={() => openAppt(item.appt!)} className={`px-3 py-1.5 rounded text-xs font-semibold border ${item.appt.status === 'Open' ? 'bg-blue-600 hover:bg-blue-500 border-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'}`}>
                      {item.appt.status === 'Open' ? 'Assign Client' : 'Cancel or Reschedule'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {notice && <p role="status" className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">{notice}</p>}
      {selected && (
        <GroupMeetingPanel
          key={`${selected.groupid}-${selected.date}-${selected.change?.changeid ?? 'new'}`}
          meeting={selected}
          today={todayKey}
          onClose={() => setSelected(null)}
          onChanged={(message) => { setNotice(message); setSelected(null); setChangesKey(k => k + 1); }}
        />
      )}
      {selectedAppt && (
        <AssessmentTimePanel
          key={selectedAppt.appointmentid}
          appt={selectedAppt}
          clients={clients}
          today={todayKey}
          onClose={() => setSelectedAppt(null)}
          onChanged={(message) => { setNotice(message); setSelectedAppt(null); setSessionsKey(k => k + 1); }}
        />
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <p className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-800">
          Assessments this month {sessions ? `(${assessments.length})` : ''}
        </p>
        {sessions && assessments.length === 0 && <p className="p-4 text-sm text-slate-500">No assessment times this month. Open some on the Assessments tab's Calendar.</p>}
        <ul className="divide-y divide-slate-800">
          {assessments.map(a => (
            <li key={a.appointmentid} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="text-white">{a.status === 'Scheduled' ? assessmentClient(a) : 'Open for assessment'}</span>
                <span className="text-xs text-slate-400"> · {longDate(a.apptdate)} · {formatDisplayTime(a.appttime)} · {assessmentPlace(a)}</span>
              </span>
              <span className={`px-2 py-0.5 rounded border text-[11px] ${KIND_STYLE[a.status === 'Scheduled' ? 'assessBooked' : 'assessOpen']}`}>
                {a.status === 'Scheduled' ? 'Scheduled' : 'Open'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <p className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-800">
          Sessions this month {sessions ? `(${listed.length})` : ''}
        </p>
        {!sessions && !error && <p className="p-4 text-sm text-slate-500">Loading…</p>}
        {sessions && listed.length === 0 && <p className="p-4 text-sm text-slate-500">No sessions {viewing ? 'they' : 'you'} opened, closed, or covered this month.</p>}
        <ul className="divide-y divide-slate-800">
          {listed.map(row => (
            <li key={`${row.kind}-${row.day}-${row.groupname}`} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="text-white">{row.groupname}</span>
                <span className="text-xs text-slate-400"> · {longDate(row.day)}{row.clients != null ? ` · ${row.clients} client${row.clients === 1 ? '' : 's'}` : ''}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className={`px-2 py-0.5 rounded border ${KIND_STYLE[row.kind]}`}>{KIND_LABEL[row.kind]}</span>
                {row.tags.map(t => <span key={t} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">{t}</span>)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
