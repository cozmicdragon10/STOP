import { useState } from 'react';
import type { PolygraphSlot } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { polySlotsOn, polygrapherSlots } from '../../utils/home';
import DayPicker from './DayPicker';
import HomeCount from './HomeCount';
import PolySlotList from './PolySlotList';

interface Props {
  polySlots: PolygraphSlot[];
  // The Polygrapher's own email (slots name their examiner by email)
  userEmail: string;
  // Privacy view: booked clients' names are left out
  privacy: boolean;
  // The Polygraphs tab filtered to this examiner: Poly Schedule (optionally one status) or Poly Results
  onOpenSchedule: (status?: 'Open' | 'Assigned') => void;
  onOpenResults: () => void;
  // One slot on the Poly Schedule
  onOpenSlot: (slotId: number) => void;
}

const needsResultBadge = () => (
  <span className="px-2 py-0.5 rounded-full border text-[0.625rem] font-semibold bg-amber-500/10 text-amber-400 border-amber-500/30">Needs result</span>
);

// A Polygrapher's Home page: their own work. Counts of results to record, appointments this week and open slots; their
// slots on a day (today to start, any day can be picked); and the past appointments still waiting on a result.
export default function PolygrapherHome({ polySlots, userEmail, privacy, onOpenSchedule, onOpenResults, onOpenSlot }: Props) {
  const today = todayLocal();
  const [day, setDay] = useState(today);
  const mine = polygrapherSlots(polySlots, userEmail);
  const onDay = polySlotsOn(mine.mine, day);
  const onWhen = day === today ? 'today' : 'on this day';

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <HomeCount
          label="Results to Record"
          value={mine.needResult.length}
          warn={mine.needResult.length > 0}
          detail={mine.needResult.length ? 'Past appointments waiting on a result' : 'All caught up'}
          onClick={onOpenResults}
          title="Open Poly Results"
        />
        <HomeCount
          label="Booked, Next 7 Days"
          value={mine.bookedSoon.length}
          detail="Your upcoming appointments"
          onClick={() => onOpenSchedule('Assigned')}
          title="Open your booked slots on the Poly Schedule"
        />
        <HomeCount
          label="Open Slots Ahead"
          value={mine.openAhead.length}
          detail="Your slots not booked yet"
          onClick={() => onOpenSchedule('Open')}
          title="Open your open slots on the Poly Schedule"
        />
      </div>

      <section>
        <DayPicker day={day} today={today} onChange={setDay} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PolySlotList
            title="My Polygraphs"
            summary={`${onDay.assigned} booked · ${onDay.open} open${onDay.closed ? ` · ${onDay.closed} closed` : ''}`}
            slots={onDay.list}
            empty={`You have no polygraph slots ${onWhen}.`}
            privacy={privacy}
            onOpen={() => onOpenSchedule()}
            onOpenSlot={onOpenSlot}
            badge={s => (mine.needResult.includes(s) ? needsResultBadge() : undefined)}
          />
          <PolySlotList
            title="Waiting on a Result"
            summary={mine.needResult.length ? `${mine.needResult.length} to record, oldest first` : undefined}
            slots={mine.needResult}
            empty="No past appointments are waiting on a result."
            showDate
            limit={8}
            privacy={privacy}
            onOpen={onOpenResults}
            onOpenSlot={onOpenResults}
            badge={needsResultBadge}
          />
        </div>
      </section>
    </>
  );
}
