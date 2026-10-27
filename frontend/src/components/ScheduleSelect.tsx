import { useState } from 'react';
import { SCHEDULE_DAYS, SCHEDULE_TIMES, formatSchedule, parseSchedule } from '../utils/schedule';

// Day and time pickers for a group schedule, read from and written back as "Thursdays @ 7:00 PM"
const ScheduleSelect = ({ value, onChange, className }: { value: string; onChange: (v: string) => void; className: string }) => {
  const [day, setDay] = useState(() => parseSchedule(value).day);
  const [time, setTime] = useState(() => parseSchedule(value).time);
  // Pick up values set from outside (opening a group, cancelling the new-group form)
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    if (value !== formatSchedule(day, time)) {
      const next = parseSchedule(value);
      setDay(next.day);
      setTime(next.time);
    }
  }
  const pick = (nextDay: string, nextTime: string) => {
    setDay(nextDay);
    setTime(nextTime);
    onChange(formatSchedule(nextDay, nextTime));
  };
  return (
    <div className="flex gap-2">
      <select required value={day} onChange={(e) => pick(e.target.value, time)} className={`flex-1 ${className}`}>
        <option value="">Day...</option>
        {SCHEDULE_DAYS.map(d => <option key={d} value={d}>{d}s</option>)}
      </select>
      <select required value={time} onChange={(e) => pick(day, e.target.value)} className={`flex-1 ${className}`}>
        <option value="">Time...</option>
        {SCHEDULE_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
};

export default ScheduleSelect;
