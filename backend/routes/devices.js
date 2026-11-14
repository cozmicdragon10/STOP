// Device approval: the public steps a new browser takes (status, request access, enter a setup code) and the DEV tab's
// approve, deny, revoke and rename actions. See lib/devices.js and docs/device-approval-plan.md.
const express = require('express');
const { pool, logAction } = require('../db');
const { requireDev } = require('../lib/auth');
const devices = require('../lib/devices');

const router = express.Router();

const stateOf = (device) => device?.status ?? 'none';

// What this browser is: none, pending, approved, denied, revoked or expired
router.get('/api/devices/status', async (req, res) => {
    try {
        if (!devices.deviceToken(req)) return res.json({ state: 'none' });
        await devices.expirePending();
        const device = await devices.deviceByToken(devices.deviceToken(req));
        res.json({ state: stateOf(device) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A browser asks for access. The email must belong to an active STOP account; wrong emails count toward a timed lockout.
router.post('/api/devices/request', async (req, res) => {
    const ip = devices.clientAddress(req);
    try {
        await devices.expirePending();
        // A browser that already has a request, approval or denial gets that state back
        const existing = await devices.deviceByToken(devices.deviceToken(req));
        if (existing && ['pending', 'approved', 'denied', 'revoked'].includes(existing.status)) {
            return res.json({ state: existing.status });
        }
        const key = devices.lockKey('email', ip);
        if (devices.locked(key)) return res.status(429).json({ error: devices.lockMessage });

        const checked = devices.validateRequest(req.body);
        if (checked.error) return res.status(400).json({ error: checked.error });
        const { email, name, note } = checked.value;

        const account = await pool.query(
            'SELECT EmployeeEmail, Role FROM EmployeeRoles WHERE LOWER(EmployeeEmail) = $1 AND Active = TRUE',
            [email]
        );
        if (account.rows.length === 0) {
            devices.recordFailure(key);
            if (devices.locked(key)) return res.status(429).json({ error: devices.lockMessage });
            return res.status(400).json({ error: 'No active STOP account has that email. Check the spelling and try again.' });
        }
        devices.clearFailures(key);

        const counts = await pool.query(
            `SELECT COUNT(*) FILTER (WHERE LOWER(RequestEmail) = $1)::int AS foremail,
                    COUNT(*)::int AS total
             FROM Devices WHERE Status = 'pending'`,
            [email]
        );
        const reason = devices.capReason({
            pendingForEmail: counts.rows[0].foremail,
            pendingTotal: counts.rows[0].total,
        });
        if (reason) {
            return res.status(429).json({
                error: 'There are already requests waiting for review. Try again after they are reviewed, or contact the office.',
            });
        }

        const token = devices.newToken();
        const userAgent = String(req.get('User-Agent') || '').slice(0, 300);
        await pool.query(
            `INSERT INTO Devices (TokenHash, Status, Name, RequestName, RequestEmail, RequestRole, RequestNote, UserAgent,
                                  LastSeenOn, RequestedOn, ExpiresOn)
             VALUES ($1, 'pending', $2, $2, $3, $4, $5, $6, NOW(), NOW(), NOW() + make_interval(hours => $7))`,
            [devices.hashToken(token), name, email, account.rows[0].role, note || null, userAgent, devices.PENDING_HOURS]
        );
        devices.setDeviceCookie(res, token);
        await logAction(email, 'Device Requested', `Access requested by ${name}${note ? `: ${note}` : ''}`, 'Login');
        res.json({ state: 'pending' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A browser enters a one-time setup code (from the server console) to become the approved device
router.post('/api/devices/redeem', async (req, res) => {
    const ip = devices.clientAddress(req);
    const key = devices.lockKey('setup', ip);
    try {
        if (devices.locked(key)) return res.status(429).json({ error: devices.lockMessage });
        const code = devices.normalizeSetupCode(req.body?.code);
        const token = devices.newToken();
        const userAgent = String(req.get('User-Agent') || '').slice(0, 300);
        const result = code.length === 10
            ? await pool.query(
                `UPDATE Devices SET TokenHash = $2, SetupCodeHash = NULL, SetupCodeExpiresOn = NULL, LastSeenOn = NOW(), UserAgent = $3
                 WHERE SetupCodeHash = $1 AND SetupCodeExpiresOn > NOW() AND Status = 'approved'
                 RETURNING DeviceId`,
                [devices.hashToken(code), devices.hashToken(token), userAgent]
            )
            : { rowCount: 0 };
        if (!result.rowCount) {
            devices.recordFailure(key);
            return res.status(400).json({ error: 'That setup code is not valid or has expired.' });
        }
        devices.clearFailures(key);
        devices.setDeviceCookie(res, token);
        await logAction('device setup', 'Device Setup', `Device ${result.rows[0].deviceid} set up with a setup code`, 'Login');
        res.json({ state: 'approved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// The DEV tab's list: pending requests first, then approved, then the rest. Token hashes are never sent.
router.get('/api/devices', requireDev, async (req, res) => {
    try {
        await devices.expirePending();
        const result = await pool.query(
            `SELECT DeviceId, Status, Name, RequestName, RequestEmail, RequestRole, RequestNote, UserAgent,
                    LastSeenOn, RequestedOn, ExpiresOn, DecidedOn, DecidedBy, ApprovalMemo, TokenHash
             FROM Devices
             ORDER BY CASE Status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, RequestedOn DESC
             LIMIT 300`
        );
        const current = devices.hashToken(devices.deviceToken(req));
        res.json(result.rows.map(r => ({
            deviceId: r.deviceid,
            status: r.status,
            name: r.name,
            requestName: r.requestname,
            requestEmail: r.requestemail,
            requestRole: r.requestrole,
            requestNote: r.requestnote,
            userAgent: r.useragent,
            lastSeenOn: r.lastseenon,
            requestedOn: r.requestedon,
            expiresOn: r.expireson,
            decidedOn: r.decidedon,
            decidedBy: r.decidedby,
            approvalMemo: r.approvalmemo,
            current: r.tokenhash?.trim() === current,
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Approve or deny a pending request. The owner's memo is saved with the decision.
const decide = (status, verb) => async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'That is not a device.' });
    const memo = devices.cleanText(req.body?.memo, devices.MEMO_MAX);
    if (memo.error) return res.status(400).json({ error: memo.error });
    const name = status === 'approved' ? devices.cleanText(req.body?.name, devices.NAME_MAX) : { value: null };
    if (name.error) return res.status(400).json({ error: name.error });
    try {
        const result = await pool.query(
            `UPDATE Devices
             SET Status = $2, DecidedOn = NOW(), DecidedBy = $3, ApprovalMemo = $4, Name = COALESCE($5, Name), ExpiresOn = NULL
             WHERE DeviceId = $1 AND Status = 'pending'
             RETURNING Name, RequestEmail`,
            [id, status, req.user.employeeemail, memo.value, name.value]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'That request is no longer waiting for review.' });
        const d = result.rows[0];
        await logAction(req.user.employeeemail, `Device ${verb}`,
            `${d.name} (${d.requestemail})${memo.value ? `. Memo: ${memo.value}` : ''}`, 'Admin');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
router.post('/api/devices/:id/approve', requireDev, decide('approved', 'Approved'));
router.post('/api/devices/:id/deny', requireDev, decide('denied', 'Denied'));

// Removes an approved device. The device being used can't revoke itself, so the owner can't lock out the only device
// they are on.
router.post('/api/devices/:id/revoke', requireDev, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'That is not a device.' });
    try {
        const device = await pool.query('SELECT Status, Name, TokenHash FROM Devices WHERE DeviceId = $1', [id]);
        const row = device.rows[0];
        if (!row) return res.status(404).json({ error: 'That device no longer exists.' });
        if (row.status !== 'approved') return res.status(400).json({ error: 'Only an approved device can be removed.' });
        if (row.tokenhash?.trim() === devices.hashToken(devices.deviceToken(req))) {
            return res.status(400).json({ error: 'That is the device you are using. Remove it from another approved device.' });
        }
        await pool.query("UPDATE Devices SET Status = 'revoked' WHERE DeviceId = $1", [id]);
        await logAction(req.user.employeeemail, 'Device Removed', `${row.name} can no longer use STOP.`, 'Admin');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Renames any device so the DEV tab shows who or what it is
router.post('/api/devices/:id/rename', requireDev, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'That is not a device.' });
    const name = devices.cleanText(req.body?.name, devices.NAME_MAX, { required: true });
    if (name.error) return res.status(400).json({ error: name.error });
    try {
        const result = await pool.query('UPDATE Devices SET Name = $2 WHERE DeviceId = $1 RETURNING Name', [id, name.value]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'That device no longer exists.' });
        await logAction(req.user.employeeemail, 'Device Renamed', `Device ${id} is now named ${name.value}.`, 'Admin');
        res.json({ success: true, name: name.value });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
