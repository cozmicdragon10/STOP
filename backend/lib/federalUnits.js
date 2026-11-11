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

module.exports = { FEDERAL_UNITS_SQL, saveClientFederalUnits, unitsProblem };
