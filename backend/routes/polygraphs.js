const express = require('express');
const { logAction, pool } = require('../db');
const { logClientChange } = require('../lib/changeLog');
const { LAST_POLY_RESULT_SQL, POLY_INCENTIVE_OVERRIDE_RESULTS, POLY_NDI_WAIT, POLY_VOUCHER_MAX, activePolyFeeOverride, endPolyFeeOverride, polyOverrideText } = require('../lib/poly');

const router = express.Router();

router.get('/api/polygraphs/slots', async (req, res) => {
    try {
        await deletePastOpenSlots();
        const query = `
            SELECT 
                s.*,
                a.appointmentid,
                a.client AS "assignedClientId",
                CASE 
                    WHEN a.appointmentid IS NOT NULL AND a.status = 'Scheduled' THEN 'Assigned'
                    -- Filled with no scheduled appointment: the reservation was cancelled after the appointment time
                    WHEN s.isfilled = TRUE THEN 'Closed'
                    ELSE 'Open'
                END AS status,
                CASE
                    WHEN c.clientid IS NOT NULL THEN CONCAT(c.lastname, ', ', c.firstname)
                    ELSE NULL
                END AS "assignedClientName"
            FROM PolygraphSlots s
            LEFT JOIN PolygraphAppointments a ON s.slotid = a.slotid AND a.status = 'Scheduled'
            LEFT JOIN Clients c ON a.client = c.clientid
            ORDER BY s.Date ASC, s.Time ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/polygraphs/slots', async (req, res) => {
    try {
        const { location, address, date, time, polygrapher, type, comments, slots } = req.body;

        // The examiner must be an active Polygrapher
        const examinerRes = await pool.query(
            "SELECT 1 FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Role = 'Polygrapher' AND Active = TRUE", [polygrapher]
        );
        if (examinerRes.rows.length === 0) {
            return res.status(400).json({ error: 'Choose an active polygrapher as the examiner.' });
        }

        if (date && time) {
            const todayStr = new Date().toLocaleDateString('en-CA');
            const now = new Date();
            const curHours = String(now.getHours()).padStart(2, '0');
            const curMinutes = String(now.getMinutes()).padStart(2, '0');
            const currentTimeStr = `${curHours}:${curMinutes}`;

            const dateOnly = date.includes('T') ? date.split('T')[0] : date;

            let timeOnly = time;
            if (/am|pm/i.test(time)) {
                const match = time.match(/(\d+):(\d+)\s*(am|pm)/i);
                if (match) {
                    let h = parseInt(match[1], 10);
                    const m = match[2];
                    const isPm = match[3].toLowerCase() === 'pm';
                    if (isPm && h < 12) h += 12;
                    if (!isPm && h === 12) h = 0;
                    timeOnly = `${String(h).padStart(2, '0')}:${m}`;
                }
            } else if (time.includes(':')) {
                const [h, m] = time.split(':');
                timeOnly = `${String(parseInt(h, 10)).padStart(2, '0')}:${m.slice(0, 2)}`;
            }

            if (dateOnly < todayStr || (dateOnly === todayStr && timeOnly < currentTimeStr)) {
                return res.status(400).json({ error: 'Appointment date and time must be in the future.' });
            }
        }

        const result = await pool.query(
            `INSERT INTO PolygraphSlots (Location, Address, Date, Time, Polygrapher, Type, Comments, SlotsAvailable)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING SlotId`,
            [location, address, date, time, polygrapher, type, comments, slots || 1]
        );
        res.status(201).json({ success: true, slotId: result.rows[0].slotid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/polygraphs/results', async (req, res) => {
    try {
        const { client, date, type, results, polygrapher, notes, slotId, incentiveContinued, user } = req.body;
        // A result without a client would never appear on any account
        if (!(Number(client) > 0)) {
            return res.status(400).json({ error: 'The polygraph result has no client. Select an assigned slot and try again.' });
        }
        // Continuing the incentive is off unless a Business Administrator overrides it on an Inconclusive or No Opinion result
        const continueIncentive = incentiveContinued === true;
        if (continueIncentive) {
            if (!POLY_INCENTIVE_OVERRIDE_RESULTS.includes(results)) {
                return res.status(400).json({ error: 'Incentive program continuation only applies to Inconclusive or No Opinion results.' });
            }
            const roleRes = await pool.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
            if (roleRes.rows[0]?.role !== 'Business Administrator') {
                return res.status(403).json({ error: 'Only Business Administrators can continue the incentive program.' });
            }
        }
        // When the polygraph took place comes from its slot, built the same way as the appointment's ScheduledDateTime
        let polygraphDateTime = null;
        if (slotId) {
            const slotRes = await pool.query('SELECT Date, Time FROM PolygraphSlots WHERE SlotId = $1', [slotId]);
            const slot = slotRes.rows[0];
            if (slot) {
                const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : String(slot.date).split('T')[0];
                polygraphDateTime = `${dateStr} ${slot.time}`;
            }
        }
        await pool.query(
            `INSERT INTO PolygraphResults (Client, Date, Type, Results, Polygrapher, Notes, PolygraphDateTime, IncentiveContinued)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [client, date, type, results, polygrapher, notes, polygraphDateTime, continueIncentive]
        );
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Slot times are stored as "HH:MM" or "h:mm AM"; the case note reads like "9:00 AM"
const formatSlotTime = (value) => {
    const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*$/i.exec(String(value || ''));
    if (!match) return String(value || '');
    const h = parseInt(match[1], 10);
    if (match[3]) return `${h}:${match[2]} ${match[3].toUpperCase()}`;
    return `${h % 12 || 12}:${match[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

// Describes a slot for case notes: "at <location> on 10/19/2026 @ 9:00 AM with examiner <name>"
const slotNoteContext = async (slot) => {
    const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : String(slot.date).split('T')[0];
    const [year, month, day] = dateStr.split('-');
    const examinerRes = await pool.query('SELECT DisplayName FROM EmployeeRoles WHERE EmployeeEmail = $1', [slot.polygrapher]);
    const examiner = examinerRes.rows[0]?.displayname || slot.polygrapher || 'Unassigned';
    return `at ${slot.location} on ${Number(month)}/${Number(day)}/${year} @ ${formatSlotTime(slot.time)} with examiner ${examiner}`;
};

// Assign Client to Polygraph Slot. The client needs a full set of poly fee vouchers (POLY_VOUCHER_MAX) and an
// account balance of $0.00 or better. Otherwise the request is refused with what is owed, so the front end can take
// that payment. Scheduling uses all of the vouchers.
router.post('/api/polygraphs/slots/:slotId/assign', async (req, res) => {
    const db = await pool.connect();
    try {
        const { slotId } = req.params;
        const { clientId, type, user, comments, bypassWaitPeriod } = req.body;

        if (!clientId) {
            return res.status(400).json({ error: 'Client ID is required.' });
        }
        // Only active clients are booked, and BIP clients don't take polygraphs
        const programRes = await db.query('SELECT ProgramType, ProgramStatus, FirstName, LastName FROM Clients WHERE ClientId = $1', [clientId]);
        const bookedClient = programRes.rows[0];
        if (bookedClient?.programtype === 'BIP') {
            return res.status(400).json({ error: `${bookedClient.lastname}, ${bookedClient.firstname} is a BIP client. BIP clients don't take polygraphs.` });
        }
        if (bookedClient && bookedClient.programstatus !== 'Active') {
            return res.status(400).json({ error: `${bookedClient.lastname}, ${bookedClient.firstname} is ${bookedClient.programstatus || 'not active'}. Only active clients can be scheduled for a polygraph.` });
        }

        const slotRes = await db.query('SELECT * FROM PolygraphSlots WHERE SlotId = $1', [slotId]);
        if (slotRes.rows.length === 0) {
            return res.status(404).json({ error: 'Slot not found.' });
        }

        const slot = slotRes.rows[0];
        if (slot.isfilled) {
            const bookedRes = await db.query("SELECT 1 FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);
            if (bookedRes.rows.length === 0) {
                return res.status(409).json({ error: 'This slot is closed: its reservation was cancelled after the appointment time.' });
            }
        }
        const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : String(slot.date).split('T')[0];
        const scheduledDateTime = `${dateStr} ${slot.time}`;
        const slotType = type || slot.type || 'Maintenance';
        const noteContext = await slotNoteContext(slot);

        // After a No Deception Indicated result, the next polygraph must be at least POLY_NDI_WAIT after the day it took place
        const waitRes = await db.query(
            `SELECT r.Results,
                    to_char(r.Taken, 'MM/DD/YYYY') AS lastTaken,
                    to_char(r.Taken::date + INTERVAL '${POLY_NDI_WAIT}', 'MM/DD/YYYY') AS earliest,
                    s.Date < (r.Taken::date + INTERVAL '${POLY_NDI_WAIT}')::date AS tooSoon
             FROM PolygraphSlots s
             CROSS JOIN LATERAL (${LAST_POLY_RESULT_SQL('$2')}) r
             WHERE s.SlotId = $1`,
            [slotId, clientId]
        );
        const lastPoly = waitRes.rows[0];
        // Set when a Business Administrator chose to schedule inside the waiting period; recorded on the case note and system log
        let waitBypassed = null;
        if (lastPoly && lastPoly.results === 'No Deception Indicated' && lastPoly.toosoon) {
            if (!bypassWaitPeriod) {
                return res.status(409).json({
                    code: 'POLY_TOO_SOON',
                    error: `This client's last polygraph (${lastPoly.lasttaken}) was No Deception Indicated, so the next one must be at least 5 months and 2 weeks later: on or after ${lastPoly.earliest}. Choose a later slot.`,
                    lastPolyDate: lastPoly.lasttaken, earliestDate: lastPoly.earliest
                });
            }
            const roleRes = await db.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
            if (roleRes.rows[0]?.role !== 'Business Administrator') {
                return res.status(403).json({ error: 'Only Business Administrators can bypass the polygraph waiting period.' });
            }
            waitBypassed = lastPoly;
        }

        await db.query('BEGIN');
        const clientRes = await db.query('SELECT PolyFeeVoucher, PolyFeePaid, PolyFee, AccountBalance FROM Clients WHERE ClientId = $1 FOR UPDATE', [clientId]);
        if (clientRes.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Client not found.' });
        }

        // One scheduled polygraph per client at a time. Checked after locking the client so two bookings can't race past it.
        const existingRes = await db.query(
            `SELECT s.SlotId FROM PolygraphAppointments a JOIN PolygraphSlots s ON s.SlotId = a.SlotId
             WHERE a.Client = $1 AND a.Status = 'Scheduled' AND a.SlotId <> $2 LIMIT 1`,
            [clientId, slotId]
        );
        if (existingRes.rows.length > 0) {
            await db.query('ROLLBACK');
            const existing = (await db.query('SELECT * FROM PolygraphSlots WHERE SlotId = $1', [existingRes.rows[0].slotid])).rows[0];
            return res.status(409).json({
                code: 'POLY_ALREADY_SCHEDULED',
                slotId: existing.slotid,
                error: `This client already has a polygraph scheduled ${await slotNoteContext(existing)}. Cancel that reservation before scheduling another.`,
            });
        }
        const vouchers = Number(clientRes.rows[0].polyfeevoucher || 0);
        // Stored sign: positive = owes
        const accountBalance = Number(clientRes.rows[0].accountbalance || 0);
        if (vouchers < POLY_VOUCHER_MAX || accountBalance > 0) {
            await db.query('ROLLBACK');
            const polyFeePaid = Number(clientRes.rows[0].polyfeepaid || 0);
            const polyFee = Number(clientRes.rows[0].polyfee || 0);
            // Paying off the poly fee is what fills the vouchers, so it is only owed while they are short
            const amountDue = vouchers < POLY_VOUCHER_MAX ? Math.max(0, polyFee - polyFeePaid) : 0;
            const balanceDue = Math.max(0, accountBalance);
            const problems = [];
            if (vouchers < POLY_VOUCHER_MAX) problems.push(`has ${vouchers}/${POLY_VOUCHER_MAX} poly fee vouchers`);
            if (balanceDue > 0) problems.push(`owes $${balanceDue.toFixed(2)} on the account`);
            return res.status(409).json({
                code: 'POLY_SCHEDULING_REQUIREMENTS',
                error: `Scheduling a polygraph needs ${POLY_VOUCHER_MAX} poly fee vouchers and an account balance of $0.00 or better; this client ${problems.join(' and ')}.`,
                vouchers, polyFeePaid, polyFee, accountBalance, amountDue, balanceDue
            });
        }

        // Delete any existing scheduled appointment on this slot
        await db.query("DELETE FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);

        // Insert new scheduled appointment
        await db.query(
            `INSERT INTO PolygraphAppointments (SlotId, Client, ScheduledDateTime, Polygrapher, Type, Status, PolyVouchersUsed)
             VALUES ($1, $2, $3, $4, $5, 'Scheduled', $6)`,
            [slotId, clientId, scheduledDateTime, slot.polygrapher, slotType, POLY_VOUCHER_MAX]
        );

        // Mark slot as filled
        await db.query('UPDATE PolygraphSlots SET IsFilled = TRUE, Type = $1 WHERE SlotId = $2', [slotType, slotId]);

        // Use the vouchers. The paid-in-full poly fee they came from is spent too, so the next polygraph starts a new poly fee.
        await db.query(
            `UPDATE Clients SET
                PolyFeeVoucher = PolyFeeVoucher - $1,
                PolyFeePaid = CASE WHEN PolyFeePaid >= PolyFee THEN PolyFeePaid - PolyFee ELSE PolyFeePaid END,
                PolyVouchersBeforeFill = NULL
             WHERE ClientId = $2`,
            [POLY_VOUCHER_MAX, clientId]
        );
        // The vouchers used go on the account's change log, not the case note
        await logClientChange(db, {
            clientId, changedBy: user, changeType: 'Poly Fee Vouchers',
            oldValue: String(vouchers), newValue: String(vouchers - POLY_VOUCHER_MAX),
            details: `${POLY_VOUCHER_MAX} poly fee vouchers used to schedule the polygraph ${noteContext}.`,
        });

        // Spending the last fill a poly fee override allows ends it and puts the regular poly fee back
        let overrideText = '';
        const polyOverride = await activePolyFeeOverride(db, clientId);
        if (polyOverride && Number(polyOverride.fillsused) >= Number(polyOverride.fillsallowed)) {
            const { override } = await endPolyFeeOverride(db, clientId);
            overrideText = ` Temporary poly fee override (${polyOverrideText(override)}) used up; poly fee back to $${Number(override.regularfee).toFixed(2)}.`;
            await logClientChange(db, {
                clientId, changedBy: user, changeType: 'Poly Fee Override',
                oldValue: polyOverrideText(override), newValue: 'Ended',
                details: `All ${override.fillsallowed} fill(s) used; poly fee back to $${Number(override.regularfee).toFixed(2)}.`,
            });
        }

        // Record the appointment in the client's case notes
        const bypassText = waitBypassed
            ? `Scheduled inside the waiting period after the No Deception Indicated polygraph on ${waitBypassed.lasttaken} (earliest normal date ${waitBypassed.earliest}) by Business Administrator override.`
            : '';
        const noteText = `Polygraph scheduled ${noteContext}.${overrideText}`
            + (bypassText ? ` ${bypassText}` : '')
            + (String(comments || '').trim() ? ` Notes: ${String(comments).trim()}` : '');
        await db.query(
            `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, 'Polygraph')`,
            [clientId, user || 'Unknown', noteText]
        );

        await db.query('COMMIT');
        if (waitBypassed) {
            await logAction(user, 'Polygraph Wait Bypassed', `Client ID ${clientId} scheduled in slot ${slotId}. ${bypassText}`);
        }
        res.json({ success: true, message: 'Client assigned to polygraph slot successfully.' });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        console.error('Error assigning client to slot:', err);
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Hours of notice a client must give for a requested cancellation to get their poly fee vouchers back
const POLY_CANCEL_NOTICE_HOURS = 48;

// When a slot starts, in server local time. Times may be stored as "14:30:00" or "2:30 PM".
const slotStart = (slot) => {
    const dateStr = slot.date instanceof Date ? slot.date.toISOString().split('T')[0] : String(slot.date || '').split('T')[0];
    const [year, month, day] = dateStr.split('-').map(Number);
    const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?\s*$/i.exec(String(slot.time || ''));
    if (!year || !month || !day || !match) return null;
    let hours = parseInt(match[1], 10) % (match[3] ? 12 : 24);
    if (match[3] && match[3].toLowerCase() === 'pm') hours += 12;
    return new Date(year, month - 1, day, hours, Number(match[2]));
};

// Deletes open slots (nobody booked) whose start time has passed. Runs before slots are listed and every few minutes.
const deletePastOpenSlots = async () => {
    const openRes = await pool.query(
        `SELECT s.* FROM PolygraphSlots s
         WHERE s.IsFilled = FALSE
           AND NOT EXISTS (SELECT 1 FROM PolygraphAppointments a WHERE a.SlotId = s.SlotId)`
    );
    const pastIds = openRes.rows
        .filter(slot => { const start = slotStart(slot); return start !== null && start.getTime() <= Date.now(); })
        .map(slot => slot.slotid);
    if (pastIds.length > 0) {
        await pool.query('DELETE FROM PolygraphSlots WHERE SlotId = ANY($1::int[]) AND IsFilled = FALSE', [pastIds]);
        console.log(`Deleted ${pastIds.length} past open polygraph slot(s): ${pastIds.join(', ')}`);
    }
};
// unref: the timer alone doesn't keep the process running (the HTTPS server does), so tests can exit
setInterval(() => deletePastOpenSlots().catch(err => console.error('Error deleting past open slots:', err)), 5 * 60 * 1000).unref();

// Whether a cancellation returns the booking's poly fee vouchers: true/false is fixed by the reason, null leaves it to staff
const polyVoucherReturnRule = (reason, slot) => {
    switch (reason) {
        case 'Weather':
        case 'Examiner rescheduled':
            return true;
        case 'Client late / did not show':
            return false;
        case 'Client requested cancellation': {
            const start = slotStart(slot);
            return start ? start.getTime() - Date.now() > POLY_CANCEL_NOTICE_HOURS * 60 * 60 * 1000 : null;
        }
        default:
            return null;
    }
};

// Reopen Polygraph Slot (Cancel reservation and make slot available again).
// The poly fee vouchers the booking used go back to the client as the cancellation reason dictates (polyVoucherReturnRule),
// or, where the reason leaves it open, unless returnVouchers is false. A Business Administrator can override the reason's
// rule (overrideVoucherRule), in which case returnVouchers decides. Money paid toward the poly fee is not refunded.
router.post('/api/polygraphs/slots/:slotId/open', async (req, res) => {
    const db = await pool.connect();
    try {
        const { slotId } = req.params;
        const { reason, notes, user, returnVouchers, overrideVoucherRule } = req.body;
        if (!String(reason || '').trim()) {
            return res.status(400).json({ error: 'A cancellation reason is required.' });
        }
        if (overrideVoucherRule) {
            const roleRes = await db.query('SELECT Role FROM EmployeeRoles WHERE EmployeeEmail = $1 AND Active = TRUE', [user]);
            if (roleRes.rows[0]?.role !== 'Business Administrator') {
                return res.status(403).json({ error: 'Only Business Administrators can override the poly voucher return.' });
            }
        }

        const slotRes = await db.query('SELECT * FROM PolygraphSlots WHERE SlotId = $1', [slotId]);
        if (slotRes.rows.length === 0) {
            return res.status(404).json({ error: 'Slot not found.' });
        }
        const slot = slotRes.rows[0];
        const noteContext = await slotNoteContext(slot);
        // A reservation cancelled after its appointment time leaves the slot closed instead of reopening it
        const start = slotStart(slot);
        const appointmentPassed = start !== null && start.getTime() <= Date.now();

        await db.query('BEGIN');

        // Remember who was booked so the cancellation can be logged on their account
        const apptRes = await db.query("SELECT Client, PolyVouchersUsed FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);

        // Remove the scheduled appointment
        await db.query("DELETE FROM PolygraphAppointments WHERE SlotId = $1 AND Status = 'Scheduled'", [slotId]);

        if (apptRes.rows.length > 0) {
            const { client, polyvouchersused } = apptRes.rows[0];
            const rule = overrideVoucherRule ? null : polyVoucherReturnRule(String(reason).trim(), slot);
            const ruleOverridden = overrideVoucherRule && polyVoucherReturnRule(String(reason).trim(), slot) !== null;
            const refunded = (rule ?? returnVouchers !== false) ? Number(polyvouchersused || 0) : 0;
            // Whether the vouchers went back goes on the account's change log, not the case note
            const overrideText = ruleOverridden ? ` Set to ${refunded > 0 ? 'returned' : 'not returned'} by Business Administrator override.` : '';
            if (refunded > 0) {
                const voucherRes = await db.query(
                    `UPDATE Clients c SET PolyFeeVoucher = LEAST(c.PolyFeeVoucher + $1, $2)
                     FROM (SELECT PolyFeeVoucher FROM Clients WHERE ClientId = $3) before
                     WHERE c.ClientId = $3 RETURNING before.PolyFeeVoucher AS before, c.PolyFeeVoucher AS after`,
                    [refunded, POLY_VOUCHER_MAX, client]
                );
                const { before, after } = voucherRes.rows[0];
                await logClientChange(db, {
                    clientId: client, changedBy: user, changeType: 'Poly Fee Vouchers',
                    oldValue: String(before), newValue: String(after),
                    details: `${refunded} poly fee vouchers returned: polygraph reservation canceled ${noteContext} (${String(reason).trim()}).${overrideText}`,
                });
            } else if (Number(polyvouchersused || 0) > 0) {
                await logClientChange(db, {
                    clientId: client, changedBy: user, changeType: 'Poly Fee Vouchers',
                    details: `${polyvouchersused} poly fee vouchers not returned: polygraph reservation canceled ${noteContext} (${String(reason).trim()}).${overrideText}`,
                });
            }
            const noteText = `Polygraph reservation canceled ${noteContext}. Reason: ${String(reason).trim()}.`
                + (appointmentPassed ? ' The slot was not reopened because the appointment time had passed.' : '')
                + (String(notes || '').trim() ? ` Notes: ${String(notes).trim()}` : '');
            await db.query(
                `INSERT INTO Notes (Client, Date, "User", Comments, Category) VALUES ($1, NOW(), $2, $3, 'Polygraph')`,
                [client, user || 'Unknown', noteText]
            );
        }

        if (appointmentPassed && apptRes.rows.length > 0) {
            await db.query('COMMIT');
            return res.json({ success: true, reopened: false, message: 'Reservation cancelled. The appointment time has passed, so the slot was closed instead of reopened.' });
        }

        // Mark slot as not filled (Open)
        await db.query('UPDATE PolygraphSlots SET IsFilled = FALSE WHERE SlotId = $1', [slotId]);

        await db.query('COMMIT');
        res.json({ success: true, reopened: true, message: 'Reservation removed. Slot is now open for scheduling.' });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        console.error('Error reopening slot:', err);
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Delete Polygraph Slot (and any associated appointments)
router.delete('/api/polygraphs/slots/:slotId', async (req, res) => {
    try {
        const { slotId } = req.params;
        await pool.query('DELETE FROM PolygraphAppointments WHERE SlotId = $1', [slotId]);
        await pool.query('DELETE FROM PolygraphSlots WHERE SlotId = $1', [slotId]);
        res.json({ success: true, message: 'Polygraph slot deleted successfully.' });
    } catch (err) {
        console.error('Error deleting slot:', err);
        res.status(500).json({ error: 'Failed to delete slot.' });
    }
});

module.exports = router;
