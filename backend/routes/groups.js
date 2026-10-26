const express = require('express');
const { pool } = require('../db');
const { groupNameFor, logClientChange } = require('../lib/changeLog');
const { ACTIVE_FEE_OVERRIDE, ATTENDED_THIS_MONTH, BIP_CHECKIN_BLOCK, GROUP_ATTENDANCE } = require('../lib/sql');

const router = express.Router();

router.get('/api/groups', async (req, res) => {
    try {
        const query = `
            SELECT g.*, 
            (SELECT COUNT(*) FROM Clients WHERE GroupId = g.GroupId) AS ClientCount
            FROM Groups g ORDER BY g.GroupName ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/groups/:id/clients', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT c.*, ${ATTENDED_THIS_MONTH} AS AttendedThisMonth, ${ACTIVE_FEE_OVERRIDE} AS ActiveFeeOverride,
                    (SELECT Date FROM Attendance WHERE Client = c.ClientId ORDER BY Date DESC LIMIT 1) AS LastAttended,
                    (SELECT Date FROM Attendance WHERE Client = c.ClientId AND ${GROUP_ATTENDANCE} ORDER BY Date DESC LIMIT 1) AS LastGroupAttended,
                    ${BIP_CHECKIN_BLOCK} AS BipCheckInBlock
             FROM Clients c WHERE c.GroupId = $1`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/api/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { groupName, location, counselor, programType, schedule, address, active } = req.body;
        const required = { 'Group name': groupName, Location: location, Counselor: counselor, 'Program type': programType, Schedule: schedule };
        const missing = Object.entries(required).filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
        if (missing.length > 0) {
            return res.status(400).json({ error: `Required: ${missing.join(', ')}.` });
        }
        const result = await pool.query(
            `UPDATE Groups SET GroupName = $1, Location = $2, Counselor = $3, ProgramType = $4,
                Schedule = $5, Address = $6, Active = $7
             WHERE GroupId = $8 RETURNING GroupId`,
            [groupName.trim(), location.trim(), counselor.trim(), programType.trim(), schedule.trim(), (address || '').trim(), active !== false, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found.' });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/groups', async (req, res) => {
    try {
        const { groupName, location, counselor, programType, schedule, address } = req.body;
        const required = { 'Group name': groupName, Location: location, Counselor: counselor, 'Program type': programType, Schedule: schedule };
        const missing = Object.entries(required).filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
        if (missing.length > 0) {
            return res.status(400).json({ error: `Required: ${missing.join(', ')}.` });
        }
        const result = await pool.query(
            `INSERT INTO Groups (GroupName, Location, Counselor, ProgramType, Schedule, Address, Active)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING GroupId`,
            [groupName.trim(), location.trim(), counselor.trim(), programType.trim(), schedule.trim(), (address || '').trim()]
        );
        res.status(201).json({ success: true, groupId: result.rows[0].groupid, message: 'Group created successfully.' });
    } catch (err) {
        console.error('Error creating group:', err);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/api/groups/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const assigned = await pool.query('SELECT COUNT(*) AS count FROM Clients WHERE GroupId = $1', [id]);
        if (Number(assigned.rows[0].count) > 0) {
            return res.status(409).json({ error: 'This group still has assigned clients. Reassign them to another group before deleting it.' });
        }
        const result = await pool.query('DELETE FROM Groups WHERE GroupId = $1 RETURNING GroupId', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Group not found.' });
        }
        res.json({ success: true, message: 'Group deleted successfully.' });
    } catch (err) {
        // 23503 = foreign_key_violation: attendance or call-in history still references this group
        if (err.code === '23503') {
            return res.status(409).json({ error: 'This group has attendance or call-in history and cannot be deleted. Deactivate it instead: open Manage Group, uncheck Active on the Schedule & Counselor tab, and save.' });
        }
        console.error('Error deleting group:', err);
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/groups/:id/assign', async (req, res) => {
    try {
        const { id } = req.params;
        const { clientId, assignedBy } = req.body;
        const beforeRes = await pool.query('SELECT GroupId FROM Clients WHERE ClientId = $1', [clientId]);
        await pool.query('UPDATE Clients SET GroupId = $1 WHERE ClientId = $2', [id, clientId]);
        const oldGroupId = beforeRes.rows[0]?.groupid || null;
        if (beforeRes.rows.length > 0 && oldGroupId !== Number(id)) {
            await logClientChange(pool, {
                clientId, changedBy: assignedBy, changeType: 'Group',
                oldValue: await groupNameFor(oldGroupId), newValue: await groupNameFor(Number(id)),
                details: 'Reassigned from Manage Group.',
            });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
