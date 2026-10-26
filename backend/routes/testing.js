const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/api/testing/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        const result = await pool.query('SELECT * FROM Testing WHERE Client = $1 ORDER BY Date DESC', [clientId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/api/testing', async (req, res) => {
    try {
        const { client, testType, score, notes, date } = req.body;
        const result = await pool.query(
            'INSERT INTO Testing (Client, TestType, Score, Notes, Date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [client, testType, score, notes, date || new Date()]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
