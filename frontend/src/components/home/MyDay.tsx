import { useEffect, useRef, useState } from 'react';
import { getGroupScheduleChanges, getMySessions } from '../../api';
import type { GroupScheduleChange, MyAssessment, MyClosedSession, MyGroupDay, MyOpenSession } from '../../api';
import { dayKey, groupHeldDays, monthOfDate, myGroupIds, scheduledDatesIn, weekStartOf } from '../../utils/counselor';
import { formatDisplayTime } from '../../utils/dates';
import { parseSchedule } from '../../utils/schedule';
import GroupMeetingPanel, { type Meeting } from './GroupMeetingPanel';
import AssessmentTimePanel, { type PanelClient } from './AssessmentTimePanel';
import { TONE_CHIP, chipsInOrder, type CalendarTone } from '../../utils/calendar';
import { CalendarLegend, KindIcon } from '../calendar/CalendarKey';
import MonthCalendar from '../calendar/MonthCalendar';
import { revealPanel } from '../../utils/layout';

interface GroupRow {
  groupid: number | string;
  groupname?: string | null;
  counselor?: string | null;
  schedule?: string | null;
  active?: boolean | null;
  // The server sends the count as text
  clientcount?: number | string | null;
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
// A scheduled meeting (upcoming, or past and never opened) of a group the counselor leads carries `meeting`, so its chip opens the cancel/reschedule panel.
// label is the short chip text; name, detail and sort (HH:MM, '' when no time) are for the day's list when the day is clicked.
interface DayItem {
  key: string;
  // heldOtherDay: the group's regular day in a week it was held on another day; only in the day's list, not the calendar
  kind: 'closed' | 'open' | 'scheduled' | 'cancelled' | 'moved' | 'heldOtherDay' | 'assessOpen' | 'assessBooked';
  label: string;
  title: string;
  name: string;
  detail: string;
  sort: string;
  meeting?: Meeting;
  // Shown in the day's list when the day is clicked, not on the calendar
  listOnly?: boolean;
  // An assessment time from today on: assign a client (open), or cancel or reschedule (scheduled)
  appt?: MyAssessment;
}
// '5:00 PM' -> '17:00', for sorting a day's list by time
const to24h = (time: string) => {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time || '');
  return match ? `${String((Number(match[1]) % 12) + (match[3] === 'PM' ? 12 : 0)).padStart(2, '0')}:${match[2]}` : '';
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Each kind of entry in the calendar colors every calendar shares (utils/calendar.ts); assessment times also get an icon
const KIND_TONE: Record<DayItem['kind'], CalendarTone> = {
  closed: 'done', open: 'open', scheduled: 'booked', cancelled: 'cancelled', moved: 'moved', heldOtherDay: 'moved', assessOpen: 'available', assessBooked: 'assessment',
};
const KIND_STYLE = Object.fromEntries(Object.entries(KIND_TONE).map(([k, t]) => [k, TONE_CHIP[t]])) as Record<DayItem['kind'], string>;
const isAssessment = (kind: DayItem['kind']) => kind === 'assessOpen' || kind === 'assessBooked';
const KIND_LABEL: Record<DayItem['kind'], string> = {
  closed: 'Closed', open: 'Open', scheduled: 'Scheduled', cancelled: 'Cancelled', moved: 'Moved', heldOtherDay: 'Held another day',
  assessOpen: 'Open assessment time', assessBooked: 'Assessment',
};
const shortDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const assessmentClient = (a: MyAssessment) => (a.status === 'Scheduled' ? `${a.lastname ?? ''}, ${a.firstname ?? ''}` : 'Open');
const assessmentPlace = (a: MyAssessment) => a.location || 'No location set';
const MAX_CHIPS = 3;

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
  // 'HH:MM' now, so a meeting earlier today that nobody opened isn't called "Coming up"
  const nowHm = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  const [month, setMonth] = useState(monthOfDate(new Date()));
  const [sessions, setSessions] = useState<{ closed: MyClosedSession[]; open: MyOpenSession[]; assessments: MyAssessment[]; groupDays?: MyGroupDay[] } | null>(null);
  const [error, setError] = useState('');
  // Cancelled and rescheduled meetings this month; reloaded after a change (changesKey)
  const [changes, setChanges] = useState<GroupScheduleChange[]>([]);
  const [changesKey, setChangesKey] = useState(0);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [notice, setNotice] = useState('');
  // The day clicked on the calendar; its full list shows under the calendar. Defaults to today in the current month.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const dayDetailsRef = useRef<HTMLElement>(null);
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
    return { groupid, groupname, date, time: parseSchedule(g?.schedule || '').time, clients: g?.clientcount == null ? null : Number(g.clientcount), change };
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
    const item = groupItem(`c${s.groupid}-${s.sessiondate}-${s.sessionnumber}`, 'closed', s.groupname, s.groupid,
      [`Closed · ${plural(s.clients, 'client')} checked in`, ...tags].join(' · '));
    // A check on the calendar chip, like a completed assessment
    add(s.sessiondate, { ...item, label: `✓ ${item.label}` });
  }
  for (const s of sessions?.open ?? []) {
    taken.add(`${s.sessiondate}|${s.groupid}`);
    add(s.sessiondate, groupItem(`o${s.groupid}-${s.sessiondate}-${s.sessionnumber}`, 'open', s.groupname, s.groupid,
      ['Check-in sheet still open', ...openTags(s, !viewing)].join(' · ')));
  }
  // Scheduled meetings that weren't held (upcoming, or past and never opened) look the same: click to cancel or
  // reschedule. A changed one shows as Cancelled, or Moved with its new date.
  // A group held on another day that week (whoever ran it) shows only there; its regular day lists where it was held.
  const held = groupHeldDays(sessions?.groupDays ?? []);
  for (const [day, meets] of scheduledDatesIn(groups, displayName, month)) {
    for (const g of meets) {
      if (taken.has(`${day}|${g.groupid}`) || held.on.has(`${g.groupid}|${day}`)) continue;
      const name = g.groupname || '';
      const time = groupTime(g.groupid);
      const change = changeFor.get(`${g.groupid}|${day}`);
      const heldOn = held.inWeek.get(`${g.groupid}|${weekStartOf(day)}`);
      if (!change && heldOn) {
        add(day, { key: `h${g.groupid}-${day}`, kind: 'heldOtherDay', label: name, title: `Held another day: ${name}`, name,
          detail: `Held on ${heldOn.map(longDate).join(' and ')} instead of its regular day`, sort: to24h(time), listOnly: true });
        continue;
      }
      const meeting = meetingOf(g.groupid, name, day, change);
      const why = change?.reason ? ` · Reason: ${change.reason}` : '';
      if (!change) {
        add(day, { ...groupItem(`s${g.groupid}-${day}`, 'scheduled', name, g.groupid,
          `${day < todayKey ? 'Scheduled, never opened'
            : day === todayKey && to24h(time) && to24h(time) <= nowHm ? 'Scheduled, not opened yet' : 'Coming up'}${time ? ` at ${time}` : ''}`), meeting });
      } else if (change.action === 'Cancelled') {
        add(day, { key: `x${change.changeid}`, kind: 'cancelled', label: name, title: `Cancelled: ${name}`, name, detail: `Cancelled${why}`, sort: to24h(time), meeting });
      } else {
        const moved = `${shortDate(change.newdate || '')} at ${formatDisplayTime(change.newtime || '')}`;
        add(day, { key: `m${change.changeid}`, kind: 'moved', label: `${name} → ${shortDate(change.newdate || '')}`, title: `Moved to ${moved}: ${name}`, name, detail: `Moved to ${moved}${why}`, sort: to24h(time), meeting });
      }
    }
  }
  // Where a rescheduled meeting moved to (its original date may be in another month), until it's held there: then the
  // held (or open) session stands in for it
  for (const c of myChanges) {
    if (c.action !== 'Rescheduled' || !c.newdate || !c.newdate.startsWith(month)) continue;
    if (taken.has(`${c.newdate}|${c.groupid}`) || held.on.has(`${c.groupid}|${c.newdate}`)) continue;
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
    // Begun or completed (same colors; the words say so)
    const progress = a.progress === 'Completed' ? 'Completed' : a.progress === 'In Progress' ? 'In progress' : '';
    const progressDetail = a.progress === 'Completed'
      ? ` · Completed${a.completedon ? ` ${shortDate(a.completedon)}` : ''}`
      : progress ? ' · In progress' : '';
    add(a.apptdate, {
      key: `a${a.appointmentid}`,
      kind,
      label: progress === 'Completed' ? `✓ ${time} ${a.location || 'Assessment'}` : `${time} ${a.location || 'Assessment'}`,
      title: `${KIND_LABEL[kind]} at ${time}, ${assessmentPlace(a)}${a.status === 'Scheduled' ? `: ${assessmentClient(a)}` : ''}${progress ? ` (${progress})` : ''}`,
      name: a.status === 'Scheduled' ? `Assessment: ${assessmentClient(a)}${progress ? ` (${progress})` : ''}` : 'Open assessment time',
      detail: `${time} · ${assessmentPlace(a)}${progressDetail}`,
      sort: a.appttime,
      // Past times can't be assigned or moved (the server refuses earlier dates), nor ones already begun
      appt: a.apptdate >= todayKey && !a.progress ? a : undefined,
    });
  }
  // The picked day (if it's in this month), else today when looking at the current month
  const shownDay = pickedDay?.startsWith(month) ? pickedDay : todayKey.startsWith(month) ? todayKey : null;
  // That day's entries by time; entries with no time (held sessions of a group without a schedule) go last
  const dayEntries = shownDay
    ? [...(byDay.get(shownDay) ?? [])].sort((a, b) => (a.sort || '99').localeCompare(b.sort || '99') || a.name.localeCompare(b.name))
    : [];
  const pickDay = (day: string) => { setPickedDay(day); setNotice(''); };
  // Clicking a day's box: its list shows under the calendar, often below the bottom of the screen, so scroll to it.
  // (Clicking a group or time on the calendar opens its dialog instead, so the page stays put.)
  const pickDayAndShow = (day: string) => {
    pickDay(day);
    requestAnimationFrame(() => revealPanel(dayDetailsRef.current));
  };
  const assessments = sessions?.assessments ?? [];

  const listed = [
    ...(sessions?.closed ?? []).map(s => ({ day: s.sessiondate, kind: 'closed' as const, groupid: s.groupid, session: s.sessionnumber, groupname: s.groupname, tags: closedTags(s, !viewing), clients: s.clients })),
    ...(sessions?.open ?? []).map(s => ({ day: s.sessiondate, kind: 'open' as const, groupid: s.groupid, session: s.sessionnumber, groupname: s.groupname, tags: openTags(s, !viewing), clients: null })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.groupname.localeCompare(b.groupname) || Number(a.session ?? 1) - Number(b.session ?? 1));


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

      {error && <p role="alert" className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">{error}</p>}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 md:p-4">
        <MonthCalendar
          month={month}
          today={todayKey}
          onMonth={setMonth}
          summary={sessions ? `${plural(listed.length, 'session')} · ${plural(assessments.length, 'assessment time')}` : 'Loading…'}
          pickedDay={shownDay}
          onPickDay={pickDayAndShow}
          cellClassName="min-h-24"
          minWidthClassName="min-w-[560px]"
          dayLabel={day => {
            const count = (byDay.get(day) ?? []).filter(item => !item.listOnly).length;
            return `${longDate(day)}: ${count ? plural(count, 'item') : 'nothing scheduled'}`;
          }}
          renderDay={day => {
            // Assessment times first, so a busy day's "+N more" only ever hides groups
            const items = chipsInOrder((byDay.get(day) ?? []).filter(item => !item.listOnly), item => isAssessment(item.kind));
            // The whole day opens its list below the calendar; a chip inside also opens its own panel
            return (
              <>
                {items.slice(0, MAX_CHIPS).map(item => (item.meeting || item.appt ? (
                  <button
                    key={item.key}
                    type="button"
                    title={`${item.title} (click to ${item.appt ? (item.appt.status === 'Open' ? 'assign a client' : 'cancel or reschedule') : item.meeting!.change ? 'see or undo the change' : 'cancel or reschedule'})`}
                    onClick={e => { e.stopPropagation(); pickDay(day); if (item.appt) openAppt(item.appt); else openMeeting(item.meeting!); }}
                    className={`flex items-center gap-1 w-full text-left text-[11px] leading-tight border rounded px-1 py-0.5 truncate hover:brightness-125 ${KIND_STYLE[item.kind]}`}>
                    {isAssessment(item.kind) && <KindIcon kind="assessment" />}<span className="truncate">{item.label}</span>
                  </button>
                ) : (
                  <p key={item.key} title={item.title} className={`flex items-center gap-1 text-[11px] leading-tight border rounded px-1 py-0.5 truncate ${KIND_STYLE[item.kind]}`}>
                    {isAssessment(item.kind) && <KindIcon kind="assessment" />}<span className="truncate">{item.label}</span>
                  </p>
                )))}
                {items.length > MAX_CHIPS && <p className="text-[11px] text-slate-500">+{items.length - MAX_CHIPS} more</p>}
              </>
            );
          }}
          legend={
            <CalendarLegend
              tones={['done', 'open', 'booked', 'cancelled', 'moved', 'assessment', 'available']}
              labels={{ done: 'Closed', open: 'Still open', booked: 'Group scheduled, coming up', available: 'Open assessment time' }}
              kinds={['assessment']}
            />
          }
        />
        <p className="text-[11px] text-slate-500 mt-2">Click a day to see everything on it. Click a scheduled group (upcoming, or past and never opened) to cancel or reschedule that meeting; its clients get a case note.</p>
      </div>

      {shownDay && (
        <section ref={dayDetailsRef} aria-label={`Everything on ${longDate(shownDay)}`} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
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
            <li key={`${row.kind}-${row.day}-${row.groupid}-${row.session ?? 1}`} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
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
