// Dates as the office means them: the server's local calendar day (Oklahoma), as YYYY-MM-DD. toISOString() gives the
// UTC day instead, which after 6 PM local time is already tomorrow.
const pad = (n) => String(n).padStart(2, '0');

// A Date as its local calendar day. pg returns DATE columns as local midnight, so this gives back the stored day.
const ymdLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayLocal = (now = new Date()) => ymdLocal(now);
// A DATE value from pg (Date) or text ('YYYY-MM-DD', or an ISO timestamp) as YYYY-MM-DD
const ymdOf = (value) => (value instanceof Date ? ymdLocal(value) : String(value || '').split('T')[0]);

module.exports = { ymdLocal, todayLocal, ymdOf };
