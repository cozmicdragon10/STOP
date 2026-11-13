// What a Polygrapher can do. Their account is limited to their own work: the Polygraphs tab (opening, cancelling,
// rescheduling slots, recording results), the Forms library, a client's personal, contact and program information,
// polygraph history and documents (view and upload), and their own Settings. Everything else is refused here, on the
// server, whatever the screen shows.
const ALLOWED = [
    ['POST', /^\/api\/auth\/logout$/],
    // Shared lists the app loads at sign-in
    ['GET', /^\/api\/clients$/],
    ['GET', /^\/api\/groups$/],
    ['GET', /^\/api\/admin\/employees$/],
    ['GET', /^\/api\/agents$/],
    ['GET', /^\/api\/program-fees$/],
    ['GET', /^\/api\/federal-units$/],
    // A client's limited account: information, polygraph history, documents
    ['GET', /^\/api\/clients\/\d+$/],
    ['GET', /^\/api\/clients\/\d+\/(polygraphs|poly-summary|attachments)$/],
    ['GET', /^\/api\/attachments\/\d+$/],
    ['POST', /^\/api\/clients\/\d+\/attachments$/],
    // Polygraphs: slots, opening, cancelling and rescheduling, results
    ['GET', /^\/api\/polygraphs\/slots$/],
    ['POST', /^\/api\/polygraphs\/slots$/],
    ['POST', /^\/api\/polygraphs\/slots\/\d+\/(open|reschedule)$/],
    ['POST', /^\/api\/polygraphs\/results$/],
    // The Forms library (read only)
    ['GET', /^\/api\/documents(\/\d+)?$/],
];

// Client fields a Polygrapher isn't sent: money, billing, and internal comments
const HIDDEN_CLIENT_FIELDS = ['accountbalance', 'treatmentfee', 'vouchers', 'polyfeevoucher', 'polyfeepaid', 'polyfee',
    'polyvouchersbeforefill', 'copay', 'buspasses', 'buspassrefill', 'federalunits', 'federalunitrefills', 'activefeeoverride',
    'feealreadycharged', 'attendedthismonth', 'cardpaymentsblocked', 'cardblockreason', 'comments'];
const CLIENT_ROWS = /^\/api\/clients(\/\d+)?$/;

const isAllowed = (method, path) => ALLOWED.some(([m, re]) => m === method && re.test(path));
const withoutHidden = (row) => {
    if (!row || typeof row !== 'object') return row;
    const copy = { ...row };
    for (const f of HIDDEN_CLIENT_FIELDS) delete copy[f];
    return copy;
};

// Express middleware, after requireSession
const polygrapherAccess = (req, res, next) => {
    if (req.user?.role !== 'Polygrapher') return next();
    if (!isAllowed(req.method, req.path)) {
        return res.status(403).json({ error: 'Polygrapher accounts can\'t do that. Ask the office if you need it.' });
    }
    if (req.method === 'GET' && CLIENT_ROWS.test(req.path)) {
        const json = res.json.bind(res);
        res.json = (body) => json(Array.isArray(body) ? body.map(withoutHidden) : withoutHidden(body));
    }
    next();
};

module.exports = { polygrapherAccess, isAllowed, withoutHidden, HIDDEN_CLIENT_FIELDS };
