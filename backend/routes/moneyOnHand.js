// Money on Hand (lib/moneyOnHand.js): who holds the cash and checks waiting to go to the bank, hand-offs between
// employees, and bank deposits. Every active employee except Polygraphers can use it for their own money; Business
// Administrators see and act on everyone's. The viewer is always the logged-in employee (req.user), never the request.
const express = require('express');
const { logAction, pool } = require('../db');
const { OPEN_GROUP_ADMIN_ROLES } = require('../lib/access');
const { todayLocal } = require('../lib/dates');
const {
    SLIP_MAX, NOTES_MAX, HANDOFF_ACTIONS, parseItemKey, itemLabel, sameEmail, isBusinessAdmin,
    heldItemsSql, openSheetsSql, openSheetMoney, handoffProblem, handoffActionProblem, depositProblem, verifyProblem,
    voidProblem, lockItems, heldItemsByKey, itemTimeline,
} = require('../lib/moneyOnHand');
const { withResponsible, closedSessionsSql } = require('../lib/cashResponsibility');

const router = express.Router();

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const fail = (status, error) => Object.assign(new Error(error), { status });
const throwIf = (problem) => { if (problem) throw fail(problem.status, problem.error); };
const sendError = (res, err) => res.status(err.status || 500).json({ error: err.message });
const nameOf = async (db, email) => (await db.query('SELECT DisplayName FROM EmployeeRoles WHERE LOWER(EmployeeEmail) = LOWER($1)', [email || ''])).rows[0]?.displayname || email;

// Runs work inside a transaction, rolling back if it throws
const inTransaction = async (work) => {
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        const result = await work(db);
        await db.query('COMMIT');
        return result;
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        db.release();
    }
};

const HANDOFF_SQL = `
    SELECT ho.HandoffId, ho.FromEmployee, ho.ToEmployee, ho.Total, ho.Notes, ho.CreatedBy, ho.CreatedOn, ho.Status,
           ho.ResolvedBy, ho.ResolvedOn,
           COALESCE(ef.DisplayName, ho.FromEmployee) AS FromName, COALESCE(et.DisplayName, ho.ToEmployee) AS ToName,
           COALESCE(ec.DisplayName, ho.CreatedBy) AS CreatedByName,
           (SELECT json_agg(json_build_object('key', hi.ItemKey, 'amount', hi.Amount, 'label', hi.Label) ORDER BY hi.Label)
            FROM CashHandoffItems hi WHERE hi.HandoffId = ho.HandoffId) AS Items
    FROM CashHandoffs ho
    LEFT JOIN EmployeeRoles ef ON LOWER(ef.EmployeeEmail) = LOWER(ho.FromEmployee)
    LEFT JOIN EmployeeRoles et ON LOWER(et.EmployeeEmail) = LOWER(ho.ToEmployee)
    LEFT JOIN EmployeeRoles ec ON LOWER(ec.EmployeeEmail) = LOWER(ho.CreatedBy)`;

const DEPOSIT_SQL = `
    SELECT b.BankDepositId, to_char(b.DepositDate, 'YYYY-MM-DD') AS DepositDate, b.SlipNumber, b.Total, b.DroppedOffBy,
           b.RecordedOn, b.BankAmount, b.VerifiedBy, b.VerifiedOn, b.VerifyNotes, b.VoidedBy, b.VoidedOn, b.VoidReason,
           COALESCE(ed.DisplayName, b.DroppedOffBy) AS DroppedOffByName, COALESCE(ev.DisplayName, b.VerifiedBy) AS VerifiedByName,
           COALESCE(ex.DisplayName, b.VoidedBy) AS VoidedByName,
           (SELECT json_agg(json_build_object('key', bi.ItemKey, 'amount', bi.Amount, 'label', bi.Label,
                       'collector', bi.Collector, 'collectorName', COALESCE(ei.DisplayName, bi.Collector)) ORDER BY bi.Label)
            FROM BankDepositItems bi LEFT JOIN EmployeeRoles ei ON LOWER(ei.EmployeeEmail) = LOWER(bi.Collector)
            WHERE bi.BankDepositId = b.BankDepositId) AS Items
    FROM BankDeposits b
    LEFT JOIN EmployeeRoles ed ON LOWER(ed.EmployeeEmail) = LOWER(b.DroppedOffBy)
    LEFT JOIN EmployeeRoles ev ON LOWER(ev.EmployeeEmail) = LOWER(b.VerifiedBy)
    LEFT JOIN EmployeeRoles ex ON LOWER(ex.EmployeeEmail) = LOWER(b.VoidedBy)`;

// Everything the Money on Hand screen shows: the money not at the bank yet with who holds it (items), money at groups
// still open (open), waiting and recent hand-offs, deposits not checked against the bank yet plus the last 60 days', and
// who money can be handed to. A non-admin sees only their own.
router.get('/api/money-on-hand', async (req, res) => {
    try {
        const viewer = req.user;
        const admin = isBusinessAdmin(viewer);
        const me = viewer.employeeemail;
        const [items, open, handoffs, deposits, recipients] = await Promise.all([
            pool.query(
                `SELECT * FROM (${heldItemsSql('$1')}) x WHERE $2::boolean OR LOWER(x.Holder) = LOWER($3)
                 ORDER BY x.HolderName, x.EventDate, x.Label, x.ItemKey`,
                [OPEN_GROUP_ADMIN_ROLES, admin, me]
            ),
            pool.query(`SELECT * FROM (${openSheetsSql('$1')}) o ORDER BY o.SessionDate, o.GroupName`, [OPEN_GROUP_ADMIN_ROLES]),
            pool.query(
                `${HANDOFF_SQL}
                 WHERE (ho.Status = 'Pending' OR ho.ResolvedOn > NOW() - INTERVAL '14 days')
                   AND ($1::boolean OR LOWER(ho.FromEmployee) = LOWER($2) OR LOWER(ho.ToEmployee) = LOWER($2) OR LOWER(ho.CreatedBy) = LOWER($2))
                 ORDER BY (ho.Status = 'Pending') DESC, COALESCE(ho.ResolvedOn, ho.CreatedOn) DESC`,
                [admin, me]
            ),
            pool.query(
                `${DEPOSIT_SQL}
                 WHERE ((b.VerifiedOn IS NULL AND b.VoidedOn IS NULL) OR b.DepositDate >= CURRENT_DATE - 60)
                   AND ($1::boolean OR LOWER(b.DroppedOffBy) = LOWER($2))
                 ORDER BY b.DepositDate DESC, b.BankDepositId DESC`,
                [admin, me]
            ),
            pool.query(`SELECT EmployeeEmail, DisplayName, Role FROM EmployeeRoles WHERE Active = TRUE AND Role <> 'Polygrapher' ORDER BY DisplayName`),
        ]);
        const openMoney = open.rows
            .filter(o => admin || sameEmail(o.responsible, me))
            .map(({ entries, ...o }) => ({ ...o, ...openSheetMoney(entries) }))
            .filter(o => o.amount > 0);
        res.json({
            isAdmin: admin,
            items: items.rows,
            open: openMoney,
            handoffs: handoffs.rows,
            deposits: deposits.rows,
            recipients: recipients.rows.filter(r => !sameEmail(r.employeeemail, me)),
        });
    } catch (err) {
        sendError(res, err);
    }
});

// Where one item of money has been: who collected it, every hand-off, and its bank deposits (voided ones too).
// A non-admin can see the history of money they collected, handed, received, held or deposited.
router.get('/api/money-on-hand/history/:key', async (req, res) => {
    try {
        const viewer = req.user;
        const key = String(req.params.key || '');
        const parsed = parseItemKey(key);
        if (!parsed) throw fail(400, 'That is not an item of money.');

        let origin;
        if (parsed.kind === 'group') {
            const r = (await pool.query(
                `${withResponsible(closedSessionsSql('a."Group" = $1 AND a.Date = $2 AND a.SessionNumber = $3'), '$4')}`,
                [parsed.groupId, parsed.sessionDate, parsed.sessionNumber, OPEN_GROUP_ADMIN_ROLES]
            )).rows[0];
            if (r) {
                origin = {
                    kind: 'group', label: r.groupname, eventdate: parsed.sessionDate, sessionnumber: parsed.sessionNumber,
                    amount: r.cash, collector: r.responsible, collectorname: r.responsiblename || r.responsible, collectedon: r.closedon,
                };
            }
        } else {
            const r = (await pool.query(
                `SELECT f.Amount, f.FeeType, to_char(f.Date, 'YYYY-MM-DD') AS EventDate, f.Date, f.EnteredBy,
                        COALESCE(e.DisplayName, f.EnteredBy) AS EnteredByName, c.LastName || ', ' || c.FirstName AS ClientName
                 FROM FinancialTransactions f
                 LEFT JOIN Clients c ON c.ClientId = f.Client
                 LEFT JOIN EmployeeRoles e ON LOWER(e.EmployeeEmail) = LOWER(f.EnteredBy)
                 WHERE f.TransactionId = $1 AND f.Type = 'Payment'`,
                [parsed.transactionId]
            )).rows[0];
            if (r) {
                origin = {
                    kind: 'payment', label: String(r.feetype || '').trim() || 'Payment', clientname: r.clientname, eventdate: r.eventdate,
                    amount: r.amount, collector: r.enteredby, collectorname: r.enteredbyname, collectedon: r.date,
                };
            }
        }
        if (!origin) throw fail(404, 'That money was not found.');

        const [handoffs, deposits, legacy, held] = await Promise.all([
            pool.query(`${HANDOFF_SQL} WHERE ho.HandoffId IN (SELECT HandoffId FROM CashHandoffItems WHERE ItemKey = $1) ORDER BY ho.CreatedOn, ho.HandoffId`, [key]),
            pool.query(`${DEPOSIT_SQL} WHERE b.BankDepositId IN (SELECT BankDepositId FROM BankDepositItems WHERE ItemKey = $1) ORDER BY b.RecordedOn, b.BankDepositId`, [key]),
            // A check-off from before Money on Hand (no bank deposit)
            parsed.kind === 'group'
                ? pool.query(`SELECT to_char(d.DepositDate, 'YYYY-MM-DD') AS DepositDate, d.RecordedBy, COALESCE(e.DisplayName, d.RecordedBy) AS RecordedByName, d.RecordedOn
                              FROM GroupDeposits d LEFT JOIN EmployeeRoles e ON LOWER(e.EmployeeEmail) = LOWER(d.RecordedBy)
                              WHERE d.GroupId = $1 AND d.SessionDate = $2 AND d.SessionNumber = $3 AND d.BankDepositId IS NULL`,
                [parsed.groupId, parsed.sessionDate, parsed.sessionNumber])
                : pool.query(`SELECT to_char(d.DepositDate, 'YYYY-MM-DD') AS DepositDate, d.RecordedBy, COALESCE(e.DisplayName, d.RecordedBy) AS RecordedByName, d.RecordedOn
                              FROM CashPaymentDeposits d LEFT JOIN EmployeeRoles e ON LOWER(e.EmployeeEmail) = LOWER(d.RecordedBy)
                              WHERE d.TransactionId = $1 AND d.BankDepositId IS NULL`, [parsed.transactionId]),
            heldItemsByKey(pool, [key], OPEN_GROUP_ADMIN_ROLES),
        ]);

        const current = held.get(key) || null;
        const me = viewer.employeeemail;
        const involved = sameEmail(origin.collector, me) || (current && sameEmail(current.holder, me))
            || handoffs.rows.some(h => sameEmail(h.fromemployee, me) || sameEmail(h.toemployee, me) || sameEmail(h.createdby, me))
            || deposits.rows.some(d => sameEmail(d.droppedoffby, me));
        if (!isBusinessAdmin(viewer) && !involved) throw fail(403, 'You can only see the history of money you collected, held, or handed off.');

        res.json({
            key,
            label: itemLabel(origin),
            amount: origin.amount,
            holder: current ? { email: current.holder, name: current.holdername, since: current.heldsince } : null,
            events: itemTimeline({ origin, handoffs: handoffs.rows, deposits: deposits.rows, legacy: legacy.rows[0] || null }),
        });
    } catch (err) {
        sendError(res, err);
    }
});

// Hands money to another employee: { to (email), notes, items: [{ key, amount }] as shown }. It stays with the giver
// until the receiver accepts. All or nothing: if any item changed since it was shown, nothing is saved (409).
router.post('/api/money-on-hand/handoffs', async (req, res) => {
    try {
        const viewer = req.user;
        const { to, notes, items } = req.body || {};
        const note = String(notes ?? '').trim();
        if (note.length > NOTES_MAX) throw fail(400, `The note can be up to ${NOTES_MAX} characters.`);
        const picked = Array.isArray(items) ? items : [];
        const result = await inTransaction(async (db) => {
            await lockItems(db, picked.map(p => String(p?.key ?? '')));
            const held = await heldItemsByKey(db, picked.map(p => String(p?.key ?? '')), OPEN_GROUP_ADMIN_ROLES);
            const toRow = (await db.query('SELECT EmployeeEmail, DisplayName, Role, Active FROM EmployeeRoles WHERE LOWER(EmployeeEmail) = LOWER($1)', [String(to || '')])).rows[0];
            throwIf(handoffProblem({ viewer, to: toRow || null, picked, held }));
            const list = picked.map(p => held.get(String(p.key)));
            const from = list[0].holder;
            const total = list.reduce((t, i) => t + Math.round(Number(i.amount) * 100), 0) / 100;
            const handoff = (await db.query(
                `INSERT INTO CashHandoffs (FromEmployee, ToEmployee, Total, Notes, CreatedBy) VALUES ($1, $2, $3, $4, $5) RETURNING HandoffId`,
                [from, toRow.employeeemail, total.toFixed(2), note || null, viewer.employeeemail]
            )).rows[0];
            for (const i of list) {
                await db.query('INSERT INTO CashHandoffItems (HandoffId, ItemKey, Amount, Label) VALUES ($1, $2, $3, $4)',
                    [handoff.handoffid, i.itemkey, Number(i.amount).toFixed(2), itemLabel(i).slice(0, 255)]);
            }
            return { id: handoff.handoffid, total, from, fromName: list[0].holdername, toName: toRow.displayname || toRow.employeeemail, lines: list.map(i => `${itemLabel(i)} ${money(i.amount)}`) };
        });
        const forSomeone = sameEmail(result.from, viewer.employeeemail) ? '' : ` (entered by ${viewer.displayname || viewer.employeeemail} for them)`;
        await logAction(viewer.employeeemail, 'Cash Hand-Off Offered',
            `Hand-off ${result.id}: ${result.fromName} is handing ${money(result.total)} to ${result.toName}${forSomeone}, waiting for them to accept: ${result.lines.join('; ')}.`, 'Audit');
        res.json({ handoffId: result.id, total: result.total });
    } catch (err) {
        sendError(res, err);
    }
});

// Accept (receiver: the money is now theirs), decline (receiver: it stays with the giver), or cancel (giver, whoever
// entered it, or a Business Administrator) a waiting hand-off
router.post('/api/money-on-hand/handoffs/:id/:action', async (req, res) => {
    try {
        const viewer = req.user;
        const action = String(req.params.action);
        const id = Number(req.params.id);
        if (!HANDOFF_ACTIONS.includes(action) || !Number.isInteger(id)) throw fail(404, 'Not found.');
        const result = await inTransaction(async (db) => {
            const keys = (await db.query('SELECT ItemKey FROM CashHandoffItems WHERE HandoffId = $1', [id])).rows.map(r => r.itemkey);
            await lockItems(db, keys);
            const handoff = (await db.query(`${HANDOFF_SQL} WHERE ho.HandoffId = $1 FOR UPDATE OF ho`, [id])).rows[0];
            throwIf(handoffActionProblem({ viewer, handoff, action }));
            const status = { accept: 'Accepted', decline: 'Declined', cancel: 'Cancelled' }[action];
            await db.query('UPDATE CashHandoffs SET Status = $1, ResolvedBy = $2, ResolvedOn = CURRENT_TIMESTAMP WHERE HandoffId = $3',
                [status, viewer.employeeemail, id]);
            return { handoff, status };
        });
        const h = result.handoff;
        const what = {
            Accepted: `${h.toname} accepted ${money(h.total)} from ${h.fromname}; it is now theirs to hold`,
            Declined: `${h.toname} declined ${money(h.total)} from ${h.fromname}; it stays with ${h.fromname}`,
            Cancelled: `${viewer.displayname || viewer.employeeemail} cancelled the ${money(h.total)} hand-off from ${h.fromname} to ${h.toname}; it stays with ${h.fromname}`,
        }[result.status];
        await logAction(viewer.employeeemail, `Cash Hand-Off ${result.status}`, `Hand-off ${id}: ${what}.`, 'Audit');
        res.json({ handoffId: id, status: result.status });
    } catch (err) {
        sendError(res, err);
    }
});

// Records a trip to the bank: { depositDate, slipNumber, items: [{ key, amount }] as shown }. Everything in it leaves
// Money on Hand. All or nothing: if any item changed since it was shown, nothing is saved (409), so the deposit matches
// the printed slip.
router.post('/api/money-on-hand/deposits', async (req, res) => {
    try {
        const viewer = req.user;
        const { depositDate, slipNumber, items } = req.body || {};
        const picked = Array.isArray(items) ? items : [];
        const slip = String(slipNumber ?? '').trim();
        const result = await inTransaction(async (db) => {
            await lockItems(db, picked.map(p => String(p?.key ?? '')));
            const held = await heldItemsByKey(db, picked.map(p => String(p?.key ?? '')), OPEN_GROUP_ADMIN_ROLES);
            throwIf(depositProblem({ viewer, picked, held, depositDate, slipNumber: slip, today: todayLocal() }));
            const list = picked.map(p => held.get(String(p.key)));
            const total = list.reduce((t, i) => t + Math.round(Number(i.amount) * 100), 0) / 100;
            const deposit = (await db.query(
                'INSERT INTO BankDeposits (DepositDate, SlipNumber, Total, DroppedOffBy) VALUES ($1, $2, $3, $4) RETURNING BankDepositId',
                [depositDate, slip || null, total.toFixed(2), viewer.employeeemail]
            )).rows[0].bankdepositid;
            for (const i of list) {
                const amount = Number(i.amount).toFixed(2);
                await db.query('INSERT INTO BankDepositItems (BankDepositId, ItemKey, Amount, Label, Collector) VALUES ($1, $2, $3, $4, $5)',
                    [deposit, i.itemkey, amount, itemLabel(i).slice(0, 255), i.collector]);
                const parsed = parseItemKey(i.itemkey);
                const inserted = parsed.kind === 'group'
                    ? await db.query(
                        `INSERT INTO GroupDeposits (GroupId, SessionDate, SessionNumber, AmountDeposited, DepositDate, RecordedBy, BankDepositId)
                         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (GroupId, SessionDate, SessionNumber) DO NOTHING RETURNING DepositId`,
                        [parsed.groupId, parsed.sessionDate, parsed.sessionNumber, amount, depositDate, viewer.employeeemail, deposit])
                    : await db.query(
                        `INSERT INTO CashPaymentDeposits (TransactionId, DepositDate, RecordedBy, BankDepositId)
                         VALUES ($1, $2, $3, $4) ON CONFLICT (TransactionId) DO NOTHING RETURNING TransactionId`,
                        [parsed.transactionId, depositDate, viewer.employeeemail, deposit]);
                if (inserted.rows.length === 0) throw fail(409, `Not saved: ${itemLabel(i)} was already dropped off. Refresh the list.`);
            }
            const others = [...new Set(list.filter(i => !sameEmail(i.holder, viewer.employeeemail)).map(i => i.holdername || i.holder))];
            return { deposit, total, others, lines: list.map(i => `${itemLabel(i)} ${money(i.amount)}`) };
        });
        await logAction(viewer.employeeemail, 'Bank Deposit Made',
            `Bank deposit ${result.deposit}${slip ? ` (slip ${slip})` : ''}: ${money(result.total)} dropped off at the bank on ${depositDate} by ${viewer.displayname || viewer.employeeemail}`
            + `${result.others.length ? `, including money held by ${result.others.join(', ')}` : ''}: ${result.lines.join('; ')}.`, 'Audit');
        res.json({ bankDepositId: result.deposit, total: result.total });
    } catch (err) {
        sendError(res, err);
    }
});

// Loads a deposit for a change, locked for the rest of the transaction
const lockedDeposit = async (db, id) => (await db.query(`${DEPOSIT_SQL} WHERE b.BankDepositId = $1 FOR UPDATE OF b`, [id])).rows[0];

// Adds or fixes the slip number (the person who dropped it off, or a Business Administrator) until it is checked
router.put('/api/money-on-hand/deposits/:id/slip', async (req, res) => {
    try {
        const viewer = req.user;
        const id = Number(req.params.id);
        const slip = String(req.body?.slipNumber ?? '').trim();
        if (slip.length > SLIP_MAX) throw fail(400, `The slip number can be up to ${SLIP_MAX} characters.`);
        const before = await inTransaction(async (db) => {
            const d = await lockedDeposit(db, id);
            if (!d) throw fail(404, 'That deposit was not found.');
            if (!isBusinessAdmin(viewer) && !sameEmail(d.droppedoffby, viewer.employeeemail)) throw fail(403, 'Only the person who dropped off this deposit, or a Business Administrator, can change its slip number.');
            if (d.voidedon || d.verifiedon) throw fail(409, `This deposit was already ${d.voidedon ? 'voided' : 'checked against the bank'}, so its slip number can't change.`);
            await db.query('UPDATE BankDeposits SET SlipNumber = $1 WHERE BankDepositId = $2', [slip || null, id]);
            return d.slipnumber;
        });
        await logAction(viewer.employeeemail, 'Bank Deposit Slip Changed', `Bank deposit ${id}: slip number ${before || '(none)'} changed to ${slip || '(none)'}.`, 'Audit');
        res.json({ bankDepositId: id, slipNumber: slip || null });
    } catch (err) {
        sendError(res, err);
    }
});

// Checks a deposit against the bank (Business Administrators): { bankAmount, notes }, or { clear: true } to undo it
router.put('/api/money-on-hand/deposits/:id/verify', async (req, res) => {
    try {
        const viewer = req.user;
        const id = Number(req.params.id);
        const { bankAmount, notes, clear } = req.body || {};
        const result = await inTransaction(async (db) => {
            const d = await lockedDeposit(db, id);
            if (clear) {
                if (!isBusinessAdmin(viewer)) throw fail(403, 'Only Business Administrators can check deposits against the bank.');
                if (!d) throw fail(404, 'That deposit was not found.');
                if (!d.verifiedon) throw fail(409, 'This deposit has not been checked against the bank.');
                await db.query('UPDATE BankDeposits SET BankAmount = NULL, VerifiedBy = NULL, VerifiedOn = NULL, VerifyNotes = NULL WHERE BankDepositId = $1', [id]);
                return { d, cleared: true };
            }
            throwIf(verifyProblem({ viewer, deposit: d, bankAmount, notes }));
            const amount = Number(bankAmount);
            await db.query('UPDATE BankDeposits SET BankAmount = $1, VerifiedBy = $2, VerifiedOn = CURRENT_TIMESTAMP, VerifyNotes = $3 WHERE BankDepositId = $4',
                [amount.toFixed(2), viewer.employeeemail, String(notes ?? '').trim() || null, id]);
            return { d, amount };
        });
        const d = result.d;
        const label = `Bank deposit ${id}${d.slipnumber ? ` (slip ${d.slipnumber})` : ''}`;
        if (result.cleared) {
            await logAction(viewer.employeeemail, 'Bank Deposit Check Cleared', `${label}: cleared the bank check (bank amount was ${money(d.bankamount)}).`, 'Audit');
        } else {
            const diff = Math.round((result.amount - Number(d.total)) * 100) / 100;
            await logAction(viewer.employeeemail, 'Bank Deposit Checked',
                `${label}: bank credited ${money(result.amount)} against ${money(d.total)} dropped off`
                + (diff === 0 ? ' (balanced).' : ` (${diff > 0 ? 'over' : 'short'} ${money(Math.abs(diff))}).`), 'Audit');
        }
        res.json({ bankDepositId: id });
    } catch (err) {
        sendError(res, err);
    }
});

// Voids a deposit not yet checked against the bank (Business Administrators, with a reason). Its money is back on hand
// with whoever held it. The deposit and its list are kept for the record.
router.post('/api/money-on-hand/deposits/:id/void', async (req, res) => {
    try {
        const viewer = req.user;
        const id = Number(req.params.id);
        const reason = String(req.body?.reason ?? '').trim();
        if (reason.length > NOTES_MAX) throw fail(400, `The reason can be up to ${NOTES_MAX} characters.`);
        const d = await inTransaction(async (db) => {
            const keys = (await db.query('SELECT ItemKey FROM BankDepositItems WHERE BankDepositId = $1', [id])).rows.map(r => r.itemkey);
            await lockItems(db, keys);
            const deposit = await lockedDeposit(db, id);
            throwIf(voidProblem({ viewer, deposit, reason }));
            await db.query('DELETE FROM GroupDeposits WHERE BankDepositId = $1', [id]);
            await db.query('DELETE FROM CashPaymentDeposits WHERE BankDepositId = $1', [id]);
            await db.query('UPDATE BankDeposits SET VoidedBy = $1, VoidedOn = CURRENT_TIMESTAMP, VoidReason = $2 WHERE BankDepositId = $3', [viewer.employeeemail, reason, id]);
            return deposit;
        });
        await logAction(viewer.employeeemail, 'Bank Deposit Voided',
            `Bank deposit ${id}${d.slipnumber ? ` (slip ${d.slipnumber})` : ''}: ${money(d.total)} dropped off on ${d.depositdate} by ${await nameOf(pool, d.droppedoffby)} was voided; the money shows as on hand again. Reason: ${reason}`, 'Audit');
        res.json({ bankDepositId: id });
    } catch (err) {
        sendError(res, err);
    }
});

module.exports = router;
