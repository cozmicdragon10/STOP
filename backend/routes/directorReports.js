// The director's reports on the Reports tab, for Business Administrators only: accounts receivable aging, census,
// and discharge outcomes. The SQL and how each number is worked out are in lib/directorReports.js.
const express = require('express');
const { pool } = require('../db');
const { requireRole } = require('../lib/auth');
const { DISCHARGE_STATUSES, YMD } = require('../lib/sql');
const { AGING_BUCKETS, AGING_SQL, CENSUS_SQL, OUTCOMES_SQL } = require('../lib/directorReports');

const router = express.Router();
const businessOnly = requireRole('Business Administrator');

// The census works a month at a time; ten years is plenty and keeps the query quick
const MAX_CENSUS_MONTHS = 120;
const monthsIn = (from, to) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;

const validRange = (from, to) => YMD.test(String(from || '')) && YMD.test(String(to || '')) && from <= to;

// Every client who owes money today, with the balance split by how old the charges behind it are
router.get('/api/reports/ar-aging', businessOnly, async (req, res) => {
    try {
        const result = await pool.query(AGING_SQL);
        res.json({ buckets: AGING_BUCKETS.map(([key, label]) => ({ key, label })), clients: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Month by month and program: enrolled at month end, intakes, discharges, went inactive, and clients seen
router.get('/api/reports/census', businessOnly, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!validRange(from, to)) return res.status(400).json({ error: 'A start and end date (YYYY-MM-DD) are required.' });
        if (monthsIn(from, to) > MAX_CENSUS_MONTHS) {
            return res.status(400).json({ error: `Pick ${MAX_CENSUS_MONTHS / 12} years or less for the census.` });
        }
        const result = await pool.query(CENSUS_SQL, [from, to]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Discharges in the date range by month, program, type, and subcategory, with days in the program
router.get('/api/reports/discharge-outcomes', businessOnly, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!validRange(from, to)) return res.status(400).json({ error: 'A start and end date (YYYY-MM-DD) are required.' });
        const result = await pool.query(OUTCOMES_SQL, [from, to, DISCHARGE_STATUSES]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
