// Group schedules are stored as text like "Thursdays @ 7:00 PM"; ScheduleSelect builds and reads that same format
export const SCHEDULE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const SCHEDULE_TIMES = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
});
export const formatSchedule = (day: string, time: string) => (day && time ? `${day}s @ ${time}` : '');
export const parseSchedule = (value: string) => {
  const match = /^\s*([A-Za-z]+?)s?\s*@\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i.exec(value || '');
  const day = SCHEDULE_DAYS.find(d => match && d.toLowerCase() === match[1].toLowerCase()) || '';
  const time = match && day ? `${parseInt(match[2], 10)}:${match[3]} ${match[4].toUpperCase()}` : '';
  return { day, time };
};
