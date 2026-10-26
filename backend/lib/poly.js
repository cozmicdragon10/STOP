

// A client's poly fee voucher runs 0 to this; paying the poly fee in full fills it
const POLY_VOUCHER_MAX = 6;

// Minimum gap after a No Deception Indicated polygraph before the next one may be scheduled
const POLY_NDI_WAIT = '5 months 14 days';

// Results that earn the client poly fee vouchers at SO group close (No Significant Response counts the same as NDI)
const POLY_VOUCHER_EARNING_RESULTS = ['No Deception Indicated', 'No Significant Response'];

// Results that can keep the client in the NDI voucher incentive, but only by Business Administrator override
const POLY_INCENTIVE_OVERRIDE_RESULTS = ['Inconclusive', 'No Opinion'];

// A client's most recent polygraph result, ordered by when it took place (falling back to the day it was recorded).
// clientParam is the query placeholder for the client id. Columns: Results, IncentiveContinued, Taken.
const LAST_POLY_RESULT_SQL = (clientParam) => `
    SELECT Results, IncentiveContinued, COALESCE(PolygraphDateTime, Date::timestamp) AS Taken
    FROM PolygraphResults WHERE Client = ${clientParam}
    ORDER BY COALESCE(PolygraphDateTime, Date::timestamp) DESC, ResultId DESC LIMIT 1`;

const activePolyFeeOverride = async (db, clientId) => {
    const r = await db.query('SELECT * FROM PolyFeeOverrides WHERE ClientId = $1 AND EndedOn IS NULL ORDER BY CreatedOn DESC LIMIT 1', [clientId]);
    return r.rows[0] || null;
};

// One more (or one fewer) fill toward the client's active poly fee override, if they have one
const countPolyFeeFill = (db, clientId, change) => db.query(
    'UPDATE PolyFeeOverrides SET FillsUsed = GREATEST(FillsUsed + $1, 0) WHERE ClientId = $2 AND EndedOn IS NULL',
    [change, clientId]
);

// Ends the client's active poly fee override and puts the regular poly fee back. Returns the ended override, if any.
const endPolyFeeOverride = async (db, clientId) => {
    const ended = await db.query(
        'UPDATE PolyFeeOverrides SET EndedOn = NOW() WHERE ClientId = $1 AND EndedOn IS NULL RETURNING *',
        [clientId]
    );
    const override = ended.rows[0];
    if (!override) return null;
    // Ended first, so a fill this causes isn't counted toward it
    const poly = await changePolyFeePaid(db, clientId, 0, { fee: Number(override.regularfee) });
    return { override, poly };
};

const polyOverrideText = (o) => `$${Number(o.reducedfee).toFixed(2)} for ${o.fillsallowed} fill${Number(o.fillsallowed) === 1 ? '' : 's'}`;

// Moves a client's PolyFeePaid by delta (and, with fee, sets a new poly fee total) and keeps the vouchers in step. Becoming
// paid in full fills them and remembers the count before; dropping below paid in full takes back only what that fill added,
// keeping incentive vouchers earned before it. A fill from before PolyVouchersBeforeFill existed has no count saved, so those
// vouchers go to 0. Fills (and fills taken back) count toward an active poly fee override.
const changePolyFeePaid = async (db, clientId, delta, { fee: newFee } = {}) => {
    const r = await db.query('SELECT PolyFeePaid, PolyFee, PolyFeeVoucher, PolyVouchersBeforeFill FROM Clients WHERE ClientId = $1 FOR UPDATE', [clientId]);
    const c = r.rows[0];
    const feeBefore = Number(c.polyfee || 0);
    const fee = newFee === undefined ? feeBefore : Number(newFee);
    const paidBefore = Number(c.polyfeepaid || 0);
    const paidAfter = Math.round((paidBefore + delta) * 100) / 100;
    const vouchersBefore = Number(c.polyfeevoucher || 0);
    let vouchers = vouchersBefore;
    let beforeFill = c.polyvouchersbeforefill;
    const wasFull = feeBefore > 0 && paidBefore >= feeBefore;
    const isFull = fee > 0 && paidAfter >= fee;
    if (!wasFull && isFull) {
        beforeFill = vouchers;
        vouchers = POLY_VOUCHER_MAX;
        await countPolyFeeFill(db, clientId, 1);
    } else if (wasFull && !isFull) {
        vouchers = Math.min(vouchers, Number(beforeFill ?? 0));
        beforeFill = null;
        await countPolyFeeFill(db, clientId, -1);
    }
    await db.query(
        'UPDATE Clients SET PolyFeePaid = $1, PolyFee = $2, PolyFeeVoucher = $3, PolyVouchersBeforeFill = $4 WHERE ClientId = $5',
        [paidAfter, fee, vouchers, beforeFill, clientId]
    );
    return { polyFeePaid: paidAfter, polyFee: fee, polyFeeVoucher: vouchers, vouchersRemoved: Math.max(0, vouchersBefore - vouchers), vouchersAdded: Math.max(0, vouchers - vouchersBefore) };
};

const voucherChangeText = (poly) => (poly.vouchersRemoved > 0 ? ` ${poly.vouchersRemoved} poly fee voucher(s) removed.` : '')
    + (poly.vouchersAdded > 0 ? ` Poly fee paid in full: vouchers filled to ${POLY_VOUCHER_MAX}.` : '');

module.exports = { POLY_VOUCHER_MAX, POLY_NDI_WAIT, POLY_VOUCHER_EARNING_RESULTS, POLY_INCENTIVE_OVERRIDE_RESULTS, LAST_POLY_RESULT_SQL, activePolyFeeOverride, countPolyFeeFill, endPolyFeeOverride, polyOverrideText, changePolyFeePaid, voucherChangeText };
