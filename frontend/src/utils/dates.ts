// A timestamp's calendar day in the browser's time zone, as YYYY-MM-DD
export const localYmd = (value: unknown) => {
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Calendar time between two YYYY-MM-DD days as "Same day", "5 days", "2 weeks, 3 days", or "3 months, 1 week"
export const timeBetween = (fromYmd: string, toYmd: string) => {
  const [a, b] = [fromYmd, toYmd].sort();
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const start = new Date(ay, am - 1, ad);
  const end = new Date(by, bm - 1, bd);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (totalDays === 0) return 'Same day';
  if (totalDays < 14) return plural(totalDays, 'day');
  // Whole calendar months first, then the leftover days as weeks
  let months = (by - ay) * 12 + (bm - am);
  if (new Date(ay, am - 1 + months, ad) > end) months--;
  const leftover = Math.round((end.getTime() - new Date(ay, am - 1 + months, ad).getTime()) / 86400000);
  if (months < 2) {
    const weeks = Math.floor(totalDays / 7);
    return [plural(weeks, 'week'), totalDays % 7 ? plural(totalDays % 7, 'day') : ''].filter(Boolean).join(', ');
  }
  const years = Math.floor(months / 12);
  const parts = [years ? plural(years, 'year') : '', months % 12 ? plural(months % 12, 'month') : '', leftover >= 7 ? plural(Math.floor(leftover / 7), 'week') : ''];
  return parts.filter(Boolean).join(', ');
};

// Date and Time Helpers for Appointments
export const getLocalDateString = (d: Date = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getLocalTimeString = (d: Date = new Date()) => {
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

export const getDefaultPolyTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 15);
  return getLocalTimeString(now);
};

// Date-only values (YYYY-MM-DD) are read as local dates; `new Date(str)` would treat them as UTC and can show the previous day
export const parseLogDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  return new Date(value);
};

export const formatLogMonthDay = (value?: string | null) => {
  const d = parseLogDate(value);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
};

export const formatLogYear = (value?: string | null) => {
  const d = parseLogDate(value);
  return d ? String(d.getFullYear()) : '';
};

// Time only means something for timestamps; date-only values have no time of day
export const formatLogTime = (value?: string | null) => {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

export const formatDisplayTime = (timeStr?: string) => {
  if (!timeStr) return '';
  if (/am|pm/i.test(timeStr)) return timeStr;
  const parts = timeStr.split(':');
  if (parts.length >= 2) {
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    return `${formattedHours}:${minutes} ${ampm}`;
  }
  return timeStr;
};

// Reads the calendar date of a date-only or ISO value as a local date, ignoring any time zone shift
export const toLocalDay = (value: unknown) => {
  const [y, m, d] = String(value).split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
};
// Whole years since the birth date, or null when there is no valid date
export const ageFromBirthDate = (value: unknown, today = new Date()) => {
  if (!value) return null;
  const born = toLocalDay(value);
  if (isNaN(born.getTime())) return null;
  const hadBirthday = today.getMonth() > born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate());
  const age = today.getFullYear() - born.getFullYear() - (hadBirthday ? 0 : 1);
  return age >= 0 ? age : null;
};
