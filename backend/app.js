// The Express app with every API route mounted. server.js runs migrations and starts HTTPS; tests use the app directly.
const express = require('express');
const cors = require('cors');
const { requireSession } = require('./lib/auth');
const { polygrapherAccess } = require('./lib/polygrapherAccess');

// Browser pages allowed to call the API, comma-separated in CORS_ORIGINS (.env): the production site (5173) and the
// Vite dev server (5174)
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'https://192.168.1.133:5173,https://localhost:5173,https://192.168.1.133:5174,https://localhost:5174')
    .split(',').map(o => o.trim()).filter(Boolean);

const app = express();
// API responses hold client records and depend on who is logged in, so browsers must not cache them.
// (Cached copies from before logins existed came back as bare 304s with no data.)
app.set('etag', false);
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(cors({ origin: CORS_ORIGINS }));
app.use(express.json());
// Everything below needs a logged-in session, except POST /api/auth/login
app.use(requireSession);
// Polygrapher accounts reach only their own part of the app (lib/polygrapherAccess.js)
app.use(polygrapherAccess);

// Mounted in the order the routes were originally declared, so matching is unchanged
app.use(require('./routes/auth'));
app.use(require('./routes/clients'));
app.use(require('./routes/clientOverrides'));
app.use(require('./routes/groups'));
app.use(require('./routes/attendance'));
app.use(require('./routes/openGroups'));
app.use(require('./routes/sessions'));
app.use(require('./routes/programFees'));
app.use(require('./routes/federalUnits'));
app.use(require('./routes/financials'));
app.use(require('./routes/callins'));
app.use(require('./routes/polygraphs'));
app.use(require('./routes/reports'));
app.use(require('./routes/agentReports'));
app.use(require('./routes/admin'));
app.use(require('./routes/agents'));
app.use(require('./routes/documents'));

module.exports = app;
