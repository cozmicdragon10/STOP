// Federal billing units (FederalUnitCodes, ClientFederalUnits; migration 059)
const { logClientChange } = require('./changeLog');

// A client's units as { code: units }, for the client rows the frontend gets
const FEDERAL_UNITS_SQL = (client) => `(SELECT json_object_agg(u.Code, u.Units) FROM ClientFederalUnits u WHERE u.ClientId = ${client})`;

// Problem with a units value, or null. Blank clears the code.
const unitsProblem = (code, value) => {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 99999 ? null : `${code} units must be a number of 0 or more.`;
};

// Saves the codes sent in units ({ code: number | '' | null }) for the client's program; codes that aren't tracked for
// that program are ignored. Each change goes on the client's change log. Throws { status: 400 } on a bad value.
const saveClientFederalUnits = async (db, { clientId, programType, units, changedBy }) => {
    if (!units || typeof units !== 'object') return;
    const codes = (await db.query('SELECT Code, Label FROM FederalUnitCodes WHERE $1 = ANY(Programs)', [programType])).rows;
    const before = new Map((await db.query('SELECT Code, Units FROM ClientFederalUnits WHERE ClientId = $1', [clientId])).rows
        .map(r => [r.code, Number(r.units)]));
    for (const { code, label } of codes) {
        if (!(code in units)) continue;
        const problem = unitsProblem(code, units[code]);
        if (problem) throw Object.assign(new Error(problem), { status: 400 });
        const value = units[code] === '' || units[code] === null ? null : Math.round(Number(units[code]) * 100) / 100;
        const old = before.has(code) ? before.get(code) : null;
        if (old === value) continue;
        if (value === null) await db.query('DELETE FROM ClientFederalUnits WHERE ClientId = $1 AND Code = $2', [clientId, code]);
        else await db.query(
            `INSERT INTO ClientFederalUnits (ClientId, Code, Units) VALUES ($1, $2, $3)
             ON CONFLICT (ClientId, Code) DO UPDATE SET Units = EXCLUDED.Units`, [clientId, code, value]);
        await logClientChange(db, {
            clientId, changedBy, changeType: `${code} ${label}`,
            oldValue: old === null ? 'Blank' : String(old), newValue: value === null ? 'Blank' : String(value),
        });
    }
};

// Session units (Form 45 tokens). A Federal SO client's group session uses 6022 Group Units and an individual group
// session 6012 Individual Units. When closing, the counselor picks how long they attended, which sets the units used.
// A client with no units left (blank counts as none) can't be checked in, and only lengths they have units for are
// offered. Mirrors frontend/src/utils/federalUnits.ts.
const UNIT_PROGRAMS = ['Federal SO'];
const DURATION_BANDS = [
    { key: 'under16', label: 'Less than 16 minutes', units: 0 },
    { key: '16-30', label: '16-30 minutes', units: 1 },
    { key: '31-60', label: '31-60 minutes', units: 2 },
    { key: '61-90', label: '61-90+ minutes', units: 3 },
];
const unitCodeForGroup = (groupType) => (String(groupType || '').trim().toUpperCase() === 'INDIVIDUAL' ? '6012' : '6022');

// Takes the units a closed session used off the client (locking their row) and records them on the attendance.
// Throws { status: 400 } when the client has no units left, no length was picked, or the length needs more than they have.
const useSessionUnits = async (db, { clientId, name, attendanceId, groupType, durationBand, changedBy, what }) => {
    const code = unitCodeForGroup(groupType);
    const label = code === '6012' ? 'Individual Units' : 'Group Units';
    const row = (await db.query('SELECT Units FROM ClientFederalUnits WHERE ClientId = $1 AND Code = $2 FOR UPDATE', [clientId, code])).rows[0];
    const left = row ? Number(row.units) : 0;
    const fail = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
    if (left < 1) fail(`${name} has no ${code} ${label} left, so they can't be checked in. Enter their units on their account first.`);
    const band = DURATION_BANDS.find(b => b.key === durationBand);
    if (!band) fail(`Choose how long ${name} attended.`);
    if (band.units > left) fail(`${name} has only ${left} ${code} ${label} left, not enough for ${band.label} (${band.units}).`);
    if (band.units > 0) {
        await db.query('UPDATE ClientFederalUnits SET Units = Units - $1 WHERE ClientId = $2 AND Code = $3', [band.units, clientId, code]);
        await logClientChange(db, {
            clientId, changedBy, changeType: `${code} ${label}`, oldValue: String(left), newValue: String(left - band.units),
            details: `${band.units} used: ${what}, attended ${band.label}.`,
        });
    }
    await db.query('UPDATE Attendance SET DurationBand = $1, UnitCode = $2, UnitsUsed = $3 WHERE AttendanceId = $4',
        [band.key, code, band.units, attendanceId]);
    return { code, used: band.units, left: left - band.units };
};

// Names of the Federal SO clients in clientIds with no units left for this group's code (blank counts as none), so they
// can't be checked in. [] when everyone may be.
const clientsWithoutUnits = async (db, clientIds, groupType) => {
    if (!clientIds.length) return [];
    const r = await db.query(
        `SELECT c.LastName || ', ' || c.FirstName AS name FROM Clients c
         LEFT JOIN ClientFederalUnits u ON u.ClientId = c.ClientId AND u.Code = $3
         WHERE c.ClientId = ANY($1::int[]) AND c.ProgramType = ANY($2::text[]) AND COALESCE(u.Units, 0) < 1`,
        [clientIds, UNIT_PROGRAMS, unitCodeForGroup(groupType)]
    );
    return r.rows.map(x => x.name);
};

// Gives back the units a deleted attendance used. Returns a sentence for the log, or ''.
const returnSessionUnits = async (db, { att, changedBy }) => {
    const used = Number(att.unitsused || 0);
    if (!att.unitcode || used <= 0) return '';
    const label = att.unitcode === '6012' ? 'Individual Units' : 'Group Units';
    const before = (await db.query('SELECT Units FROM ClientFederalUnits WHERE ClientId = $1 AND Code = $2 FOR UPDATE', [att.client, att.unitcode])).rows[0];
    const old = before ? Number(before.units) : 0;
    await db.query(
        `INSERT INTO ClientFederalUnits (ClientId, Code, Units) VALUES ($1, $2, $3)
         ON CONFLICT (ClientId, Code) DO UPDATE SET Units = ClientFederalUnits.Units + EXCLUDED.Units`,
        [att.client, att.unitcode, used]
    );
    await logClientChange(db, {
        clientId: att.client, changedBy, changeType: `${att.unitcode} ${label}`, oldValue: before ? String(old) : 'Blank', newValue: String(old + used),
        details: `${used} given back: attendance deleted.`,
    });
    return ` ${used} ${att.unitcode} ${label} given back.`;
};

module.exports = {
    FEDERAL_UNITS_SQL, saveClientFederalUnits, unitsProblem,
    UNIT_PROGRAMS, DURATION_BANDS, unitCodeForGroup, useSessionUnits, returnSessionUnits, clientsWithoutUnits,
};
