// BIP clients store their week in Clients.Phase: the group attendances since their last BIP intake (lib/sql.js BIP_WEEKS).
// A check-in adds one and a deletion takes one off, but only for attendance on or after the last intake; the week is
// counted again from scratch when the last intake changes (an intake completed, recorded from another provider, or removed).
const { BIP_WEEKS, LAST_BIP_INTAKE } = require('./sql');
const { logClientChange } = require('./changeLog');

// Whether a group attendance on this date (YYYY-MM-DD) counts toward the client's BIP week: on or after their last intake
const countsAsBipWeek = async (db, clientId, date) => (await db.query(
    `SELECT $2::date >= COALESCE(${LAST_BIP_INTAKE('$1::int')}, '-infinity'::date) AS counts`, [clientId, date]
)).rows[0].counts;

// Sets a BIP client's week to the group attendances since their last intake and logs a change. Nothing happens for other
// clients. Returns the new week, or null when the client isn't BIP.
const recountBipWeek = async (db, { clientId, changedBy, why }) => {
    const res = await db.query(
        `WITH old AS (SELECT ClientId, Phase FROM Clients WHERE ClientId = $1 AND ProgramType = 'BIP' FOR UPDATE)
         UPDATE Clients c SET Phase = (${BIP_WEEKS('c.ClientId')})::text FROM old WHERE c.ClientId = old.ClientId
         RETURNING old.Phase AS Before, c.Phase AS After`,
        [clientId]
    );
    const row = res.rows[0];
    if (!row) return null;
    if (String(row.before ?? '').trim() !== row.after) {
        await logClientChange(db, {
            clientId, changedBy, changeType: 'Phase', oldValue: row.before ? `Week ${row.before}` : null, newValue: `Week ${row.after}`,
            details: `BIP week counted again from the last intake: ${why}`,
        });
    }
    return row.after;
};

module.exports = { countsAsBipWeek, recountBipWeek };
