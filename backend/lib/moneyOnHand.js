// Money on Hand: the cash and checks waiting to go to the bank, who is holding each one right now, hand-offs between
// employees, and bank deposits (routes/moneyOnHand.js, migration 089).
//
// An item of money is either a closed group session's cash and checks, or one cash or check payment taken outside a
// group (account payments, assessments, individual sessions). Its key is 'g:<GroupId>:<YYYY-MM-DD>:<SessionNumber>' or
// 'p:<TransactionId>'.
//   - It starts with the employee responsible for it: for a group session, lib/cashResponsibility.js; for a payment,
//     whoever entered it.
//   - It moves to someone else only when they accept a hand-off. While a hand-off is waiting, the item stays with the
//     giver and can't be handed off again or deposited.
//   - It leaves Money on Hand when it goes in a bank deposit (a GroupDeposits / CashPaymentDeposits row marks it, with
//     the deposit's BankDepositId). A Business Administrator can void a deposit that hasn't been checked against the
//     bank yet; its items go back to whoever held them.
// Money taken at a group that is still open shows too, with the person who will be responsible for it, but it can't be
// handed off or deposited until the group closes (until then the amount can still change).

const { HELD_PAYMENT_SQL, isHeldPayment } = require('./paymentMethods');
const { withResponsible, closedSessionsSql } = require('./cashResponsibility');
const { nameOf } = require('./printedReceipts');
const { YMD } = require('./sql');

const BUSINESS_ADMIN = 'Business Administrator';
const SLIP_MAX = 100;
const NOTES_MAX = 500;

const cents = (n) => Math.round(Number(n || 0) * 100);
const money = (n) => `$${(cents(n) / 100).toFixed(2)}`;
const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const isBusinessAdmin = (viewer) => viewer?.role === BUSINESS_ADMIN;

// --- Item keys ---
const groupItemKey = (groupId, sessionDate, sessionNumber) => `g:${Number(groupId)}:${sessionDate}:${Number(sessionNumber) || 1}`;
const paymentItemKey = (transactionId) => `p:${Number(transactionId)}`;
const parseItemKey = (key) => {
    const s = String(key ?? '');
    let m = /^g:(\d+):(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(s);
    if (m) return { kind: 'group', groupId: Number(m[1]), sessionDate: m[2], sessionNumber: Number(m[3]) };
    m = /^p:(\d+)$/.exec(s);
    if (m) return { kind: 'payment', transactionId: Number(m[1]) };
    return null;
};
// The same keys built in SQL
const groupKeySql = (groupId, date, sessionNumber) => `('g:' || ${groupId} || ':' || to_char(${date}, 'YYYY-MM-DD') || ':' || ${sessionNumber})`;
const paymentKeySql = (transactionId) => `('p:' || ${transactionId})`;

// How an item is named in lists, logs and messages: "Tulsa BIP 11/20/2026 #2" or "Smith, John: Payment 11/20/2026"
const shortDate = (ymd) => {
    const [y, m, d] = String(ymd || '').split('-');
    return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : String(ymd || '');
};
const itemLabel = (item) => (item.kind === 'group'
    ? `${item.label} ${shortDate(item.eventdate)}${Number(item.sessionnumber) > 1 ? ` #${item.sessionnumber}` : ''}`
    : `${item.clientname || 'Unknown client'}: ${item.label} ${shortDate(item.eventdate)}`);

// --- Who holds an item ---
// The receiver of the item's last accepted hand-off (Holder, HeldSince), or no row when it never changed hands
const lastHandoffJoin = (keyExpr, alias = 'h') => `LEFT JOIN LATERAL (
        SELECT ho.ToEmployee AS Holder, ho.ResolvedOn AS HeldSince
        FROM CashHandoffItems hi JOIN CashHandoffs ho ON ho.HandoffId = hi.HandoffId
        WHERE hi.ItemKey = ${keyExpr} AND ho.Status = 'Accepted'
        ORDER BY ho.ResolvedOn DESC, ho.HandoffId DESC LIMIT 1
    ) ${alias} ON TRUE`;
// The item's waiting hand-off, if any
const pendingHandoffJoin = (keyExpr, alias = 'ph') => `LEFT JOIN LATERAL (
        SELECT ho.HandoffId, ho.ToEmployee
        FROM CashHandoffItems hi JOIN CashHandoffs ho ON ho.HandoffId = hi.HandoffId
        WHERE hi.ItemKey = ${keyExpr} AND ho.Status = 'Pending'
        ORDER BY ho.HandoffId LIMIT 1
    ) ${alias} ON TRUE`;

// Every item of money not yet at the bank, from closed groups and payments, with who holds it now. One row per item:
// ItemKey, Kind ('group' | 'payment'), GroupId, SessionNumber, TransactionId, ClientId, Label (group name, or the
// payment's fee type), ClientName, EventDate (session or payment date), CollectedOn, Amount, Collector, Method (a
// payment's method), Checks (the checks / money orders in it: [{ kind, reference, amount, client }]), Payers (a group
// session's clients who paid: [{ client, method, kind, reference, amount }]; empty for a payment), Holder, HeldSince,
// PendingHandoffId, PendingTo, HolderName, CollectorName. OPEN_GROUP_ADMIN_ROLES is bound as adminRolesParam.
const heldItemsSql = (adminRolesParam) => `
    WITH grp AS (
        SELECT s.* FROM (${withResponsible(closedSessionsSql(`(a."Group", a.Date, a.SessionNumber) IN (
            SELECT "Group", Date, SessionNumber FROM Attendance
            WHERE "Group" IS NOT NULL AND ${HELD_PAYMENT_SQL()} AND AccountPaid > 0)`), adminRolesParam)}) s
        LEFT JOIN GroupDeposits d ON d.GroupId = s.GroupId AND d.SessionDate = s.Date AND d.SessionNumber = s.SessionNumber
        WHERE s.Cash > 0 AND d.DepositId IS NULL
    ), items AS (
        SELECT ${groupKeySql('grp.GroupId', 'grp.Date', 'grp.SessionNumber')} AS ItemKey, 'group'::text AS Kind,
               grp.GroupId, grp.SessionNumber, NULL::int AS TransactionId, NULL::int AS ClientId,
               grp.GroupName::text AS Label, NULL::text AS ClientName, to_char(grp.Date, 'YYYY-MM-DD') AS EventDate,
               grp.ClosedOn AS CollectedOn, grp.Cash AS Amount, grp.Responsible::text AS Collector, NULL::text AS Method,
               ck.Checks, py.Payers
        FROM grp
        LEFT JOIN LATERAL (
            SELECT COALESCE(json_agg(json_build_object('client', c.LastName || ', ' || c.FirstName, 'method', a.PaymentMethod,
                       'kind', a.PaymentSubtype, 'reference', a.PaymentReference, 'amount', a.AccountPaid)
                       ORDER BY c.LastName, c.FirstName, a.AttendanceId), '[]'::json) AS Payers
            FROM Attendance a JOIN Clients c ON c.ClientId = a.Client
            WHERE a."Group" = grp.GroupId AND a.Date = grp.Date AND a.SessionNumber = grp.SessionNumber
              AND ${HELD_PAYMENT_SQL('a.')} AND a.AccountPaid > 0
        ) py ON TRUE
        LEFT JOIN LATERAL (
            SELECT COALESCE(json_agg(json_build_object('kind', a.PaymentSubtype, 'reference', a.PaymentReference,
                       'amount', a.AccountPaid, 'client', c.LastName || ', ' || c.FirstName) ORDER BY c.LastName, c.FirstName), '[]'::json) AS Checks
            FROM Attendance a JOIN Clients c ON c.ClientId = a.Client
            WHERE a."Group" = grp.GroupId AND a.Date = grp.Date AND a.SessionNumber = grp.SessionNumber
              AND a.PaymentMethod = 'Other' AND ${HELD_PAYMENT_SQL('a.')} AND a.AccountPaid > 0
        ) ck ON TRUE
        UNION ALL
        SELECT ${paymentKeySql('f.TransactionId')}, 'payment', NULL, NULL, f.TransactionId, c.ClientId,
               COALESCE(NULLIF(TRIM(f.FeeType), ''), 'Payment')::text, (c.LastName || ', ' || c.FirstName)::text,
               to_char(f.Date, 'YYYY-MM-DD'), f.Date, f.Amount, f.EnteredBy::text, f.PaymentMethod::text,
               CASE WHEN f.PaymentMethod = 'Other' THEN json_build_array(json_build_object('kind', f.PaymentSubtype,
                   'reference', f.PaymentReference, 'amount', f.Amount, 'client', c.LastName || ', ' || c.FirstName))
                   ELSE '[]'::json END,
               '[]'::json
        FROM FinancialTransactions f
        LEFT JOIN Attendance a ON a.AttendanceId = f.AttendanceId
        LEFT JOIN Clients c ON c.ClientId = f.Client
        LEFT JOIN CashPaymentDeposits d ON d.TransactionId = f.TransactionId
        WHERE f.Type = 'Payment' AND ${HELD_PAYMENT_SQL('f.')} AND a."Group" IS NULL AND d.TransactionId IS NULL AND f.Amount > 0
    )
    SELECT i.*, COALESCE(h.Holder, i.Collector) AS Holder, COALESCE(h.HeldSince, i.CollectedOn) AS HeldSince,
           ph.HandoffId AS PendingHandoffId, ph.ToEmployee AS PendingTo,
           COALESCE(eh.DisplayName, COALESCE(h.Holder, i.Collector)) AS HolderName, COALESCE(ec.DisplayName, i.Collector) AS CollectorName
    FROM items i
    ${lastHandoffJoin('i.ItemKey')}
    ${pendingHandoffJoin('i.ItemKey')}
    LEFT JOIN EmployeeRoles eh ON LOWER(eh.EmployeeEmail) = LOWER(COALESCE(h.Holder, i.Collector))
    LEFT JOIN EmployeeRoles ec ON LOWER(ec.EmployeeEmail) = LOWER(i.Collector)`;

// Group check-ins not closed yet, with who will be responsible for their cash (Responsible, ResponsibleName) and the
// sheet (Entries). The money on each is worked out with openSheetMoney.
const openSheetsSql = (adminRolesParam) => withResponsible(`
    SELECT o.GroupId, g.GroupName, g.Counselor, to_char(o.SessionDate, 'YYYY-MM-DD') AS SessionDate, o.SessionNumber,
           o.CreatedBy AS OpenedBy, o.CoveredBy, o.UpdatedOn, o.Entries
    FROM OpenGroupSessions o JOIN Groups g ON g.GroupId = o.GroupId`, adminRolesParam);

// The cash and checks entered on an open check-in sheet: { amount, checks: [{ kind, reference, amount, client }] }.
// Card payments are on the account already and other kinds (DHS, direct deposit, ...) never pass through anyone's hands.
const openSheetMoney = (entries) => {
    let total = 0;
    const checks = [];
    for (const e of Array.isArray(entries) ? entries : []) {
        const paid = cents(e?.payment);
        if (!e || paid <= 0 || !isHeldPayment(e.paymentMethod, e.paymentSubtype)) continue;
        total += paid;
        if (e.paymentMethod === 'Other') {
            checks.push({ kind: e.paymentSubtype, reference: e.paymentReference || null, amount: paid / 100, client: nameOf(e) });
        }
    }
    return { amount: total / 100, checks };
};

// --- Rules ---
// Problems are returned as { status, error } (status: 400 bad request, 403 not allowed, 409 changed since shown), or null.

// The money picked for a hand-off or deposit, checked against what is held now. picked: [{ key, amount }] as the screen
// showed it; held: Map of ItemKey -> held item row (lower-case columns, from heldItemsSql).
const pickedItemsProblem = (picked, held) => {
    if (!Array.isArray(picked) || picked.length === 0) return { status: 400, error: 'Pick the money to include.' };
    const seen = new Set();
    for (const p of picked) {
        const key = String(p?.key ?? '');
        if (!parseItemKey(key) || seen.has(key)) return { status: 400, error: 'The list of money is not valid. Refresh and try again.' };
        seen.add(key);
        const item = held.get(key);
        if (!item) {
            return { status: 409, error: 'Not saved: some of this money was dropped off at the bank already, or is no longer on hand. Refresh the list.' };
        }
        if (item.pendinghandoffid) {
            return { status: 409, error: `Not saved: ${itemLabel(item)} is waiting on a hand-off. It can't be included until that hand-off is accepted, declined or cancelled.` };
        }
        if (cents(item.amount) !== cents(p.amount)) {
            return { status: 409, error: `Not saved: ${itemLabel(item)} is now ${money(item.amount)}, not ${money(p.amount)}. Refresh the list.` };
        }
    }
    return null;
};

// A hand-off: money one person holds, handed to another active employee who isn't a Polygrapher. The holder enters it;
// a Business Administrator can enter one for them (say, when the holder left the money in the office safe).
// to: the receiver's EmployeeRoles row ({ employeeemail, role, active }) or null.
const handoffProblem = ({ viewer, to, picked, held }) => {
    const basic = pickedItemsProblem(picked, held);
    if (basic) return basic;
    const items = picked.map(p => held.get(String(p.key)));
    const from = items[0].holder;
    if (items.some(i => !sameEmail(i.holder, from))) {
        return { status: 400, error: 'A hand-off can only include money one person is holding. Make a separate hand-off for each person.' };
    }
    if (!isBusinessAdmin(viewer) && !sameEmail(from, viewer?.employeeemail)) {
        return { status: 403, error: `You can only hand off money you are holding. ${itemLabel(items[0])} is held by ${items[0].holdername || from}.` };
    }
    if (!to || !to.active) return { status: 400, error: 'Pick an active employee to hand the money to.' };
    if (to.role === 'Polygrapher') return { status: 400, error: 'Money can\'t be handed to a Polygrapher account.' };
    if (sameEmail(to.employeeemail, from)) return { status: 400, error: 'That person is already holding this money.' };
    return null;
};

// What the viewer can do with a waiting hand-off: 'accept' and 'decline' for the receiver, 'cancel' for the giver, the
// person who entered it, or a Business Administrator. Returns a problem or null.
const HANDOFF_ACTIONS = ['accept', 'decline', 'cancel'];
const handoffActionProblem = ({ viewer, handoff, action }) => {
    if (!HANDOFF_ACTIONS.includes(action)) return { status: 400, error: 'Unknown hand-off action.' };
    if (!handoff) return { status: 404, error: 'That hand-off was not found.' };
    if (handoff.status !== 'Pending') {
        return { status: 409, error: `This hand-off was already ${String(handoff.status).toLowerCase()}. Refresh the list.` };
    }
    const me = viewer?.employeeemail;
    if (action === 'cancel') {
        if (sameEmail(handoff.fromemployee, me) || sameEmail(handoff.createdby, me) || isBusinessAdmin(viewer)) return null;
        return { status: 403, error: 'Only the person handing the money off, or a Business Administrator, can cancel this hand-off.' };
    }
    if (!sameEmail(handoff.toemployee, me)) {
        return { status: 403, error: `Only the person receiving the money can ${action} this hand-off.` };
    }
    return null;
};

// A bank deposit: the date it was dropped off (not in the future), an optional slip number, and the money in it. The
// person holding the money drops it off; a Business Administrator can deposit anyone's (it says so on the record).
const depositProblem = ({ viewer, picked, held, depositDate, slipNumber, today }) => {
    if (!YMD.test(String(depositDate || ''))) return { status: 400, error: 'Enter the date the deposit was dropped off.' };
    if (today && depositDate > today) return { status: 400, error: 'The deposit date can\'t be in the future.' };
    if (String(slipNumber ?? '').trim().length > SLIP_MAX) return { status: 400, error: `The slip number can be up to ${SLIP_MAX} characters.` };
    const basic = pickedItemsProblem(picked, held);
    if (basic) return basic;
    if (!isBusinessAdmin(viewer)) {
        const other = picked.map(p => held.get(String(p.key))).find(i => !sameEmail(i.holder, viewer?.employeeemail));
        if (other) return { status: 403, error: `You can only deposit money you are holding. ${itemLabel(other)} is held by ${other.holdername || other.holder}.` };
    }
    return null;
};

// Checking a deposit against the bank (Business Administrators): the amount the bank credited, $0.00 or more. A deposit
// that was voided can't be checked.
const verifyProblem = ({ viewer, deposit, bankAmount, notes }) => {
    if (!isBusinessAdmin(viewer)) return { status: 403, error: 'Only Business Administrators can check deposits against the bank.' };
    if (!deposit) return { status: 404, error: 'That deposit was not found.' };
    if (deposit.voidedon) return { status: 409, error: 'This deposit was voided.' };
    const amount = Number(bankAmount);
    if (bankAmount === '' || bankAmount === null || bankAmount === undefined || !Number.isFinite(amount) || amount < 0) {
        return { status: 400, error: 'Enter the amount the bank credited, $0.00 or more.' };
    }
    if (String(notes ?? '').trim().length > NOTES_MAX) return { status: 400, error: `The note can be up to ${NOTES_MAX} characters.` };
    return null;
};

// Voiding a deposit (Business Administrators, with a reason): only one not yet checked against the bank, since a checked
// one is the bank's record. Its money goes back to whoever held it.
const voidProblem = ({ viewer, deposit, reason }) => {
    if (!isBusinessAdmin(viewer)) return { status: 403, error: 'Only Business Administrators can void a deposit.' };
    if (!deposit) return { status: 404, error: 'That deposit was not found.' };
    if (deposit.voidedon) return { status: 409, error: 'This deposit was already voided.' };
    if (deposit.verifiedon) return { status: 409, error: 'This deposit was already checked against the bank, so it can\'t be voided. Clear the bank check first.' };
    if (!String(reason ?? '').trim()) return { status: 400, error: 'A reason is required to void a deposit.' };
    return null;
};

// The bank's amount minus what was dropped off: positive is over, negative is short, 0 is balanced. null until checked.
const depositDifference = (total, bankAmount) => (bankAmount === null || bankAmount === undefined || bankAmount === ''
    ? null
    : (cents(bankAmount) - cents(total)) / 100);

// One item's history, oldest first: [{ at, kind, text }]. kind is collected, offered, accepted, declined, cancelled,
// deposited, checked (against the bank), voided, or checked-off (a drop-off recorded before Money on Hand).
// origin: { kind, collectorname, collectedon, amount }; handoffs / deposits: rows as the routes load them (with names);
// legacy: an older check-off row or null.
const itemTimeline = ({ origin, handoffs = [], deposits = [], legacy = null }) => {
    const events = [{
        at: origin.collectedon,
        kind: 'collected',
        text: origin.kind === 'group'
            ? `Group closed with ${money(origin.amount)} in cash and checks; ${origin.collectorname} responsible.`
            : `${money(origin.amount)} payment taken by ${origin.collectorname}.`,
    }];
    for (const h of handoffs) {
        const forThem = h.createdby && !sameEmail(h.createdby, h.fromemployee) ? ` (entered by ${h.createdbyname || h.createdby})` : '';
        events.push({ at: h.createdon, kind: 'offered', text: `${h.fromname} handed it to ${h.toname}${forThem}${h.notes ? `: "${h.notes}"` : ''}.` });
        if (h.status === 'Accepted') events.push({ at: h.resolvedon, kind: 'accepted', text: `${h.toname} accepted it and is now holding it.` });
        if (h.status === 'Declined') events.push({ at: h.resolvedon, kind: 'declined', text: `${h.toname} declined it; it stayed with ${h.fromname}.` });
        if (h.status === 'Cancelled') events.push({ at: h.resolvedon, kind: 'cancelled', text: `The hand-off to ${h.toname} was cancelled; it stayed with ${h.fromname}.` });
    }
    for (const d of deposits) {
        const slip = d.slipnumber ? `, slip ${d.slipnumber}` : '';
        events.push({ at: d.recordedon, kind: 'deposited', text: `${d.droppedoffbyname} dropped it off at the bank on ${shortDate(d.depositdate)} (deposit ${d.bankdepositid}${slip}, ${money(d.total)} in all).` });
        if (d.verifiedon) {
            const diff = depositDifference(d.total, d.bankamount);
            events.push({ at: d.verifiedon, kind: 'checked', text: `${d.verifiedbyname} checked the deposit against the bank: ${money(d.bankamount)} credited`
                + (diff === 0 ? ', balanced.' : `, ${diff > 0 ? 'over' : 'short'} ${money(Math.abs(diff))}.`) });
        }
        if (d.voidedon) events.push({ at: d.voidedon, kind: 'voided', text: `${d.voidedbyname} voided the deposit${d.voidreason ? `: "${d.voidreason}"` : ''}. The money was back on hand.` });
    }
    if (legacy) {
        events.push({ at: legacy.recordedon, kind: 'checked-off', text: `${legacy.recordedbyname} checked it off as dropped off at the bank on ${shortDate(legacy.depositdate)}.` });
    }
    const time = (e) => (e.at ? new Date(e.at).getTime() : 0);
    return events.sort((a, b) => time(a) - time(b));
};

// --- Database helpers (db is a pool or a client inside a transaction) ---

// Locks the items' slots for the rest of the transaction, in key order so two saves can't wait on each other
const lockItems = async (db, keys) => {
    for (const key of [...new Set(keys.map(String))].sort()) {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`money-item:${key}`]);
    }
};

// The held items with these keys, as a Map of ItemKey -> row
const heldItemsByKey = async (db, keys, adminRoles) => {
    const result = await db.query(`SELECT * FROM (${heldItemsSql('$1')}) x WHERE x.ItemKey = ANY($2::text[])`, [adminRoles, keys.map(String)]);
    return new Map(result.rows.map(r => [r.itemkey, r]));
};

module.exports = {
    BUSINESS_ADMIN, SLIP_MAX, NOTES_MAX, HANDOFF_ACTIONS,
    groupItemKey, paymentItemKey, parseItemKey, groupKeySql, paymentKeySql, itemLabel, sameEmail, isBusinessAdmin,
    lastHandoffJoin, pendingHandoffJoin, heldItemsSql, openSheetsSql, openSheetMoney,
    pickedItemsProblem, handoffProblem, handoffActionProblem, depositProblem, verifyProblem, voidProblem, depositDifference,
    itemTimeline, lockItems, heldItemsByKey,
};
