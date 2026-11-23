// Counselors' license credentials (set on the Admin tab, e.g. "LPC, LADC-MH"), printed after their name on everything the
// system prints. Mirrors withCredentials and CREDENTIALS_SQL in backend/lib/credentials.js.

export type StaffRecord = { employeeemail: string; displayname?: string | null; active?: boolean | null; credentials?: string | null };

// A name followed by its credentials, e.g. "Belinda Harris, LPC, LADC-MH"; just the name when there are none
export const withCredentials = (name?: string | null, credentials?: string | null) => {
  const n = String(name ?? '').trim();
  const c = String(credentials ?? '').trim();
  return n && c ? `${n}, ${c}` : n;
};

// The employee a display name or account email (covering counselors are saved by email) refers to, preferring an active account
export const findStaff = <T extends StaffRecord>(nameOrEmail: string | null | undefined, employees: T[]): T | undefined => {
  const key = String(nameOrEmail ?? '').trim().toLowerCase();
  if (!key) return undefined;
  const matches = employees.filter(e => (e.displayname || '').trim().toLowerCase() === key || e.employeeemail.toLowerCase() === key);
  return matches.find(e => e.active !== false) ?? matches[0];
};

// How a counselor's name prints: their display name (never an email) followed by their credentials. A name that matches no
// account prints as given; an unmatched email prints nothing.
export const nameWithCredentials = (nameOrEmail: string | null | undefined, employees: StaffRecord[]) => {
  const given = String(nameOrEmail ?? '').trim();
  const fallback = given.includes('@') ? '' : given;
  const match = findStaff(given, employees);
  if (!match) return fallback;
  return withCredentials(match.displayname?.trim() || fallback, match.credentials);
};
