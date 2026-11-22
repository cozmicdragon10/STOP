// The Express app with every API route mounted. server.js runs migrations and starts HTTPS; tests use the app directly.
const express = require('express');
const cors = require('cors');
const { requireSession } = require('./lib/auth');
const { polygrapherAccess } = require('./lib/polygrapherAccess');
const { counselorAccess } = require('./lib/counselorAccess');
const { deviceGate } = require('./lib/devices');

// Browser pages allowed to call the API, comma-separated in CORS_ORIGINS (.env): the production site (5173) and the
// Vite dev server (5174)
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'https://192.168.1.133:5173,https://localhost:5173,https://192.168.1.133:5174,https://localhost:5174')
    .split(',').map(o => o.trim()).filter(Boolean);

const app = express();
// API responses hold client records and depend on who is logged in, so browsers must not cache them.
// (Cached copies from before logins existed came back as bare 304s with no data.)
app.set('etag', false);
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// credentials: the device cookie is sent with API calls from the dev server (5174) to the local backend (5100)
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());
// Only an approved device gets past this (lib/devices.js). Device requests themselves are the exception.
app.use(deviceGate);
// Everything below needs a logged-in session, except POST /api/auth/login and the device requests
app.use(requireSession);
// Polygrapher accounts reach only their own part of the app (lib/polygrapherAccess.js)
app.use(polygrapherAccess);
// Counselor accounts reach only their part of the app (lib/counselorAccess.js)
app.use(counselorAccess);

// Mounted in the order the routes were originally declared, so matching is unchanged
app.use(require('./routes/auth'));
app.use(require('./routes/clients'));
app.use(require('./routes/clientOverrides'));
app.use(require('./routes/clientDebtLimits'));
app.use(require('./routes/groups'));
app.use(require('./routes/attendance'));
app.use(require('./routes/openGroups'));
app.use(require('./routes/mySessions'));
app.use(require('./routes/groupScheduleChanges'));
app.use(require('./routes/sessions'));
app.use(require('./routes/assessmentAppointments'));
app.use(require('./routes/programFees'));
app.use(require('./routes/federalUnits'));
app.use(require('./routes/financials'));
app.use(require('./routes/callins'));
app.use(require('./routes/polygraphs'));
app.use(require('./routes/reports'));
app.use(require('./routes/moneyOnHand'));
app.use(require('./routes/directorReports'));
app.use(require('./routes/agentReports'));
app.use(require('./routes/admin'));
app.use(require('./routes/agents'));
app.use(require('./routes/documents'));
app.use(require('./routes/dev'));
app.use(require('./routes/devices'));

module.exports = app;
