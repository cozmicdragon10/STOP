// The Express app with every API route mounted. server.js runs migrations and starts HTTPS; tests use the app directly.
const express = require('express');
const cors = require('cors');
const { requireSession } = require('./lib/auth');

// Browser pages allowed to call the API, comma-separated in CORS_ORIGINS (.env)
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'https://192.168.1.133:5173,https://localhost:5173')
    .split(',').map(o => o.trim()).filter(Boolean);

const app = express();
app.use(cors({ origin: CORS_ORIGINS }));
app.use(express.json());
// Everything below needs a logged-in session, except POST /api/auth/login
app.use(requireSession);

// Mounted in the order the routes were originally declared, so matching is unchanged
app.use(require('./routes/auth'));
app.use(require('./routes/clients'));
app.use(require('./routes/clientOverrides'));
app.use(require('./routes/groups'));
app.use(require('./routes/attendance'));
app.use(require('./routes/openGroups'));
app.use(require('./routes/sessions'));
app.use(require('./routes/financials'));
app.use(require('./routes/callins'));
app.use(require('./routes/polygraphs'));
app.use(require('./routes/testing'));
app.use(require('./routes/reports'));
app.use(require('./routes/admin'));
app.use(require('./routes/agents'));

module.exports = app;
