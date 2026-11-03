import { useState } from 'react';
import { BY_APPOINTMENT, SCHEDULE_DAYS, SCHEDULE_TIMES, formatSchedule, isByAppointment, parseSchedule } from '../utils/schedule';

// Day and time pickers for a group schedule, read from and written back as "Thursdays @ 7:00 PM". With
// allowByAppointment (drug-test groups) the day list also offers By Appointment, which needs no time.
const ScheduleSelect = ({ value, onChange, className, allowByAppointment = false }: {
  value: string; onChange: (v: string) => void; className: string; allowByAppointment?: boolean;
}) => {
  const read = (v: string) => (isByAppointment(v) ? { day: BY_APPOINTMENT, time: '' } : parseSchedule(v));
  const [day, setDay] = useState(() => read(value).day);
  const [time, setTime] = useState(() => read(value).time);
  // Pick up values set from outside (opening a group, cancelling the new-group form)
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    if (value !== formatSchedule(day, time) && !(day === BY_APPOINTMENT && isByAppointment(value))) {
      const next = read(value);
      setDay(next.day);
      setTime(next.time);
    }
  }
  const pick = (nextDay: string, nextTime: string) => {
    setDay(nextDay);
    setTime(nextTime);
    onChange(nextDay === BY_APPOINTMENT ? BY_APPOINTMENT : formatSchedule(nextDay, nextTime));
  };
  // By Appointment isn't offered once the group is no longer a drug-test group, so a day has to be picked again
  const shownDay = day === BY_APPOINTMENT && !allowByAppointment ? '' : day;
  return (
    <div className="flex gap-2">
      <select required value={shownDay} onChange={(e) => pick(e.target.value, e.target.value === BY_APPOINTMENT ? '' : time)} className={`flex-1 ${className}`}>
        <option value="">Day...</option>
        {allowByAppointment && <option value={BY_APPOINTMENT}>{BY_APPOINTMENT}</option>}
        {SCHEDULE_DAYS.map(d => <option key={d} value={d}>{d}s</option>)}
      </select>
      {shownDay !== BY_APPOINTMENT && (
        <select required value={time} onChange={(e) => pick(shownDay, e.target.value)} className={`flex-1 ${className}`}>
          <option value="">Time...</option>
          {SCHEDULE_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
    </div>
  );
};

export default ScheduleSelect;
