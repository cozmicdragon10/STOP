// Edit Info sends only what was changed, plus each changed field's value as it was shown when it was first changed
// ("expected"). The server refuses the save when one of those fields was changed by someone else meanwhile, instead of
// silently replacing their change. Mirrors backend/lib/editConflicts.js.

/* eslint-disable @typescript-eslint/no-explicit-any -- client rows are untyped in the forms */
type Row = Record<string, any>;

// Fields compared as numbers (150 and "150.00" match); blanks are compared as text
const NUMBER_FIELDS = ['treatmentfee', 'accountbalance', 'vouchers', 'polyfeevoucher', 'polyfeepaid', 'polyfee', 'copay',
  'buspasses', 'buspassrefill', 'groupid', 'individualgroupid'];
export const UNIT_FIELDS = ['federalunits', 'federalunitrefills'];
const isDateField = (field: string) => /date/i.test(field);

// A federal unit count as stored: a blank is no units on record
const unitValue = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
const unitMap = (v: unknown): Row => (v && typeof v === 'object' ? v as Row : {});
// The codes in edited (only the codes that were touched) whose units differ from base
const changedUnitCodes = (edited: unknown, base: unknown) => {
  const [x, y] = [unitMap(edited), unitMap(base)];
  return Object.keys(x).filter(code => unitValue(x[code]) !== unitValue(y[code]));
};

// Whether an edited value is the same as base, compared the way they're shown: dates without their time, money and
// counts as numbers. Edited federal units hold only the codes that were touched; only those are compared.
export const sameFieldValue = (field: string, a: unknown, b: unknown) => {
  if (UNIT_FIELDS.includes(field)) return changedUnitCodes(a, b).length === 0;
  if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
  const [x, y] = [String(a ?? ''), String(b ?? '')];
  if (isDateField(field)) return x.split('T')[0] === y.split('T')[0];
  if (NUMBER_FIELDS.includes(field) && x !== '' && y !== '') return Number(x) === Number(y);
  return x === y;
};

// The starting values of fields being changed for the first time: what the client showed before this edit touched them.
// A field already recorded keeps its first value.
export const recordOrigins = (origins: Row, client: Row, fields: string[]): Row => {
  const added = fields.filter(f => !(f in origins));
  return added.length ? { ...origins, ...Object.fromEntries(added.map(f => [f, client?.[f] ?? null])) } : origins;
};

// What a save sends: the fields that differ from where they started, and their starting values. Federal units send only
// the codes that were changed (edits hold only touched codes), so a unit used at check-in for another code isn't put back.
export const editPayload = (edits: Row, origins: Row) => {
  const changes: Row = {};
  const expected: Row = {};
  for (const [field, value] of Object.entries(edits)) {
    const origin = origins[field];
    if (UNIT_FIELDS.includes(field)) {
      const codes = changedUnitCodes(value, origin);
      if (!codes.length) continue;
      changes[field] = Object.fromEntries(codes.map(c => [c, unitMap(value)[c] ?? '']));
      expected[field] = Object.fromEntries(codes.map(c => [c, unitMap(origin)[c] ?? null]));
    } else if (!sameFieldValue(field, value, origin)) {
      changes[field] = value;
      expected[field] = origin ?? null;
    }
  }
  return { changes, expected };
};

// After a refused save: the conflicting fields now start from the other person's values, so saving again (having seen
// the message) replaces them on purpose
export const rebaseOrigins = (origins: Row, current: Row, conflicts: string[]): Row =>
  ({ ...origins, ...Object.fromEntries(conflicts.map(f => [f, current?.[f] ?? null])) });
