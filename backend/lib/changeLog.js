const { pool } = require('../db');

const logClientChange = (db, { clientId, changedBy, changeType, oldValue = null, newValue = null, details = null, expiresOn = null }) =>
    db.query(
        `INSERT INTO ClientChangeLog (ClientId, ChangedBy, ChangeType, OldValue, NewValue, Details, ExpiresOn)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [clientId, changedBy || 'Unknown', changeType, oldValue, newValue, details, expiresOn]
    );

const groupNameFor = async (groupId) => {
    if (!groupId) return 'None';
    const res = await pool.query('SELECT GroupName FROM Groups WHERE GroupId = $1', [groupId]);
    return res.rows[0]?.groupname || `Group ${groupId}`;
};

module.exports = { logClientChange, groupNameFor };
