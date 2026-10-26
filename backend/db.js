const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Connects lazily on the first query; server.js confirms the connection at startup by running migrations
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Helper for Logging
const logAction = async (userEmail, action, details, type = 'Audit') => {
    try {
        await pool.query(
            'INSERT INTO SystemLogs (UserEmail, Action, Details, Type) VALUES ($1, $2, $3, $4)',
            [userEmail, action, details, type]
        );
    } catch (err) {
        console.error('Failed to log action:', err);
    }
};

module.exports = { pool, logAction };
