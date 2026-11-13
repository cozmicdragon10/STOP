// The money fields on a client's Information tab. Only a Business Administrator changes them by hand; everyone else
// changes the balance through payments, charges and ledger adjustments, which keep the ledger in step. Two changes
// follow from other edits and are allowed for anyone: the treatment fee the price list gives the client's program
// and phase (set by the screen when the program or phase changes), and poly fee vouchers trimmed to a new phase's
// full set.
const MONEY_FIELDS = ['accountbalance', 'treatmentfee', 'vouchers', 'polyfeevoucher', 'polyfeepaid', 'polyfee'];
const LABELS = {
    accountbalance: 'Account Balance', treatmentfee: 'Treatment Fee', vouchers: 'Vouchers',
    polyfeevoucher: 'Poly Fee Vouchers', polyfeepaid: 'Poly Fee Paid', polyfee: 'Poly Fee',
};
const STATE_FEE_PROGRAMS = ['State SO', 'Voluntary SO'];
const sent = (v) => v !== undefined && v !== null && v !== '';
const same = (a, b) => Math.round(Number(a) * 100) === Math.round(Number(b) * 100);

// The price list's treatment fee for a program and phase (routes/programFees.js), or null when the price list doesn't
// set one (the fee is then whatever is on the account)
const standardTreatmentFee = async (db, programType, phase) => {
    if (programType === 'Federal SO') return 0;
    const key = programType === 'BIP' ? 'BIP' : STATE_FEE_PROGRAMS.includes(programType) ? phase : null;
    if (!key) return null;
    const r = await db.query('SELECT Fee FROM ProgramFees WHERE FeeKey = $1', [key]);
    return r.rows[0] ? Number(r.rows[0].fee) : null;
};

// Why a non-Business-Administrator's edit can't be saved, or null. body: the fields sent; before: the client now;
// standardFee: standardTreatmentFee for the program and phase after the edit; voucherMax: the full set of poly fee
// vouchers for the phase after the edit.
const moneyEditProblem = ({ role, body, before, standardFee, voucherMax }) => {
    if (role === 'Business Administrator') return null;
    const changed = MONEY_FIELDS.filter(f => sent(body[f]) && !same(body[f], before[f]));
    const notAllowed = changed.filter(f => {
        if (f === 'treatmentfee') return !(standardFee !== null && same(body[f], standardFee));
        if (f === 'polyfeevoucher') return !same(body[f], Math.min(Number(before.polyfeevoucher || 0), voucherMax));
        return true;
    });
    if (!notAllowed.length) return null;
    return `Only a Business Administrator can change ${notAllowed.map(f => LABELS[f]).join(', ')} here. `
        + 'Use Make Payment, or ask a Business Administrator to adjust the account.';
};

// How a money field reads in the change log. Balances are stored as owed (positive) and shown the other way around.
const moneyText = (field, value) => {
    if (value === null || value === undefined || value === '') return 'None';
    if (field === 'vouchers' || field === 'polyfeevoucher') return String(Number(value));
    const n = field === 'accountbalance' ? -Number(value) : Number(value);
    return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
};

module.exports = { MONEY_FIELDS, LABELS, standardTreatmentFee, moneyEditProblem, moneyText };
