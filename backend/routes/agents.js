const express = require('express');
const { logAction, pool } = require('../db');
const { activeRoleFor } = require('../lib/access');
const { logClientChange } = require('../lib/changeLog');

const router = express.Router();

const AGENT_EDIT_ROLES = ['Business Administrator', 'Office Admin'];

router.get('/api/agents', async (req, res) => {
    try {
        const result = await pool.query('SELECT AgentId, Name, Phone, Email FROM SupervisingAgents ORDER BY Name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/agents', async (req, res) => {
    try {
        const { name, phone, email, user } = req.body;
        if (!AGENT_EDIT_ROLES.includes(await activeRoleFor(user))) {
            return res.status(403).json({ error: 'Only Business Administrators and Office Admins can add supervising agents.' });
        }
        if (!String(name || '').trim()) {
            return res.status(400).json({ error: 'A name is required.' });
        }
        const result = await pool.query(
            `INSERT INTO SupervisingAgents (Name, Phone, Email, CreatedBy) VALUES ($1, $2, $3, $4)
             RETURNING AgentId, Name, Phone, Email`,
            [name.trim(), phone?.trim() || null, email?.trim() || null, user]
        );
        await logAction(user, 'Agent Added', `Added supervising agent ${name.trim()}.`, 'Admin');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'A supervising agent with that name already exists.' });
        res.status(500).json({ error: err.message });
    }
});

// A name change is carried to every client assigned under the old name, so they stay linked to the agent
router.put('/api/agents/:id', async (req, res) => {
    const db = await pool.connect();
    try {
        const { id } = req.params;
        const { name, phone, email, user } = req.body;
        if (!AGENT_EDIT_ROLES.includes(await activeRoleFor(user))) {
            return res.status(403).json({ error: 'Only Business Administrators and Office Admins can edit supervising agents.' });
        }
        if (!String(name || '').trim()) {
            return res.status(400).json({ error: 'A name is required.' });
        }
        const newName = name.trim();

        await db.query('BEGIN');
        const before = await db.query('SELECT Name FROM SupervisingAgents WHERE AgentId = $1 FOR UPDATE', [id]);
        if (before.rows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ error: 'Supervising agent not found.' });
        }
        const oldName = before.rows[0].name;
        const result = await db.query(
            `UPDATE SupervisingAgents SET Name = $1, Phone = $2, Email = $3 WHERE AgentId = $4
             RETURNING AgentId, Name, Phone, Email`,
            [newName, phone?.trim() || null, email?.trim() || null, id]
        );

        let clientsRenamed = 0;
        if (oldName !== newName) {
            const moved = await db.query(
                `UPDATE Clients SET SupervisingAgent = $1
                 WHERE LOWER(TRIM(SupervisingAgent)) = LOWER(TRIM($2)) AND SupervisingAgent <> $1
                 RETURNING ClientId`,
                [newName, oldName]
            );
            for (const row of moved.rows) {
                await logClientChange(db, {
                    clientId: row.clientid, changedBy: user, changeType: 'Supervising Agent',
                    oldValue: oldName, newValue: newName, details: 'Agent renamed in the Supervising Agents directory.',
                });
            }
            clientsRenamed = moved.rows.length;
        }
        await db.query('COMMIT');

        await logAction(user, 'Agent Updated',
            `Updated supervising agent ${oldName}${oldName !== newName ? ` → ${newName} (${clientsRenamed} client(s) updated)` : ''}.`, 'Admin');
        res.json({ agent: result.rows[0], clientsRenamed });
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') return res.status(409).json({ error: 'A supervising agent with that name already exists.' });
        res.status(500).json({ error: err.message });
    } finally {
        db.release();
    }
});

// Clients keep the agent's name on their record; only the directory entry is removed
router.delete('/api/agents/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req.body;
        if (await activeRoleFor(user) !== 'Business Administrator') {
            return res.status(403).json({ error: 'Only Business Administrators can delete supervising agents.' });
        }
        const removed = await pool.query('DELETE FROM SupervisingAgents WHERE AgentId = $1 RETURNING Name', [id]);
        if (removed.rows.length === 0) {
            return res.status(404).json({ error: 'Supervising agent not found.' });
        }
        await logAction(user, 'Agent Deleted', `Deleted supervising agent ${removed.rows[0].name}.`, 'Admin');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
