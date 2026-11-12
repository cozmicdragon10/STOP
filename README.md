# STOP

A full-stack application for managing clients, groups, attendance, and related administrative tasks.

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm
- PostgreSQL database
- Git

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd STOP
```

2. Install dependencies for both backend and frontend:
```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

3. Set up environment variables and the certificate:
Copy `backend/.env.example` to `backend/.env` and fill in the database URL and certificate password. Put the HTTPS
certificate at `backend/certs/stop-server.pfx`. Neither `.env` nor the `.pfx` is committed to git; keep them only on
the server. `backend/certs/stop-server.cer` is the public half of the certificate and can be installed on office PCs
so browsers trust the site.

4. Set up the database:
Make sure PostgreSQL is running and `DATABASE_URL` points at the STOP database. Schema changes in `backend/migrations/` are applied automatically when the server starts (see [Database](#database)).

## Running the Application

### On the office server (production)

The backend serves the API on port 5000 and the built site on port 5173. A watchdog restarts it if it stops, and a
Windows scheduled task starts it automatically. Code changes go live only when `deploy/update.ps1` runs. Setup,
updates, rollback, and logs are covered in [deploy/README.md](deploy/README.md).

### Development

#### Start the Backend Server
```bash
cd backend
npm start
```
The backend applies any pending migrations, then starts on `https://localhost:5000` (or the `PORT` in `.env`). On the
office server it's already running under the watchdog; use `deploy/restart.ps1` there instead.

#### Start the Frontend Development Server
In a new terminal:
```bash
cd frontend
npm run dev
```
The dev server runs on `https://localhost:5174`, beside the live site on 5173. It uses the same API and database.

### Tests
- `npm test` in `backend/` and `npx vitest run` in `frontend/` (run vitest from PowerShell on Windows).
- End-to-end tests of two people working at once, against a test copy of the database only: [e2e/README.md](e2e/README.md).

## Available Scripts

### Backend
- `npm start` - Apply pending migrations and start the HTTPS server
- `npm test` - Run the backend tests (Node's built-in test runner; no database needed)
- `npm run migrate` - Apply pending migrations without starting the server
- `npm run migrate:status` - List migrations that have not been applied yet

### Frontend
- `npm run dev` - Start the Vite development server on port 5174
- `npm run build` - Check types and build into `frontend/dist` (on the office server, use `deploy/update.ps1` instead;
  it builds into `site/builds/` and switches the live site over)
- `npm test` - Run the unit tests (Vitest)
- `npm run lint` - Run ESLint to check code quality

### Office server (`deploy/`, PowerShell)
- `update.ps1` - Run the tests, build the site, switch to the new build, and restart
- `rollback.ps1` - Switch the site back to an earlier build (`-List` shows them)
- `restart.ps1` - Restart the server
- `install-startup.ps1` - Register the scheduled task that keeps the server running (`-AtBoot` as administrator)

### End-to-end tests (`e2e/`)
- `node run.js --test-database` - Two people working at once, in the real site (test copy of the database only)

## Project Structure

```
STOP/
├── backend/              # Express.js backend server
│   ├── server.js         # Startup: runs migrations, then serves app.js (API, 5000) and the built site (5173) over HTTPS
│   ├── frontendServer.js # Serves the build named in site/current.txt
│   ├── app.js            # Express app; mounts every router in routes/
│   ├── db.js             # PostgreSQL pool and the system log helper (logAction)
│   ├── migrate.js        # Migration runner
│   ├── routes/           # One router per API area (clients, groups, polygraphs, reports, ...)
│   ├── lib/              # Logic shared between routers:
│   │   ├── auth.js               #   login sessions, identity stamping, role checks, login lockout
│   │   ├── access.js             #   who may see open and closed group check-ins
│   │   ├── attendance.js         #   recording a check-in (fees, payments, BIP week, SO monthly fee)
│   │   ├── cashResponsibility.js #   who holds a closed group session's cash
│   │   ├── poly.js               #   poly fee vouchers, overrides, and poly fee payment changes
│   │   ├── editConflicts.js      #   catching two people editing the same record (see below)
│   │   └── changeLog.js, sql.js  #   client change log, shared SQL fragments
│   ├── migrations/       # Numbered SQL migrations, applied in order
│   ├── test/             # Backend tests
│   ├── passwords.js      # Password hashing
│   ├── dischargeSummary.js  # Discharge summary PDF
│   └── certs/            # SSL certificate
├── frontend/             # React frontend with Vite
│   └── src/
│       ├── App.tsx       # App shell: login, header and tabs, Home, the client account drawer's frame, and
│       │                 #   loading the shared data (clients, groups, slots, employees, the open account)
│       ├── api.ts        # Calls to the backend
│       ├── hooks/        # useGroupCheckIn (group check-in workflow), usePolyAssignment (booking polygraph slots)
│       ├── components/   # One folder per area; each tab is its own component:
│       │   ├── attendance/   #   group check-in steps, covering counselor picker
│       │   ├── payments/     #   account-only payment, custom charge, payment dialog, card fields
│       │   ├── clients/      #   roster and New Client, and each section of the client account drawer
│       │   │                 #   (info and Edit Info, fee overrides, status dialog, ledger, attendance,
│       │   │                 #   notes, polygraphs, attachments, change log)
│       │   ├── polygraph/    #   Poly Admin, Poly Schedule, Poly Results, and the booking/cancel dialogs
│       │   ├── sessions/     #   Assessments & Individuals, BIP intake and reinstate
│       │   └── admin/, agents/, callin/, groups/, reports/, testing/  #   the other tabs
│       └── utils/        # Business rules and formatting helpers (with *.test.ts tests)
├── deploy/               # Office server: watchdog, startup task, update / rollback / restart (see deploy/README.md)
├── e2e/                  # End-to-end tests of two people working at once (see e2e/README.md)
├── site/                 # Not in git: builds/ (the last 5 site builds) and current.txt (the live one)
├── logs/                 # Not in git: server.log
└── README.md
```

The client account drawer's data (the open client, their ledger, attendance, notes, polygraphs, and fee overrides)
is loaded and kept in `App.tsx`, because several sections change it; each section component gets it as props and
reports changes back. Saves that finish after another client was opened don't overwrite the newly opened one.

## Business rules worth knowing

- **Group cash responsibility** (`backend/lib/cashResponsibility.js`): a closed group session's cash belongs to the
  covering counselor if the office picked one at check-in; otherwise to the group's usual counselor when an Office
  Admin or Business Administrator opened it; otherwise to whoever opened it. The Group Cash Deposits report and its
  drop-off check-off follow this.
- **Poly fee payment corrections** (`backend/lib/poly.js`): adjusting, refunding, or disputing a poly fee payment
  moves poly fee paid, which never goes below $0. Booking a polygraph spends the poly fee (paid resets to $0), so
  taking money back after that is owed on the account balance instead.
- **New accounts**: New User refuses an email that already has an account; existing accounts are changed with Edit,
  which signs the person out when their password changes or the account is deactivated.

- **Two people at once** (`backend/lib/editConflicts.js`, `frontend/src/utils/clientEdits.ts`):
  - Payments, check-ins, adjustments, and other money changes lock the client's row while they save, so overlapping
    ones wait their turn instead of losing each other's changes.
  - Edit Info sends only the fields that were changed (`PATCH /api/clients/:id`), with each one's value from when it
    was first changed. If someone else changed one of those fields meanwhile, the save is refused, the current values
    are shown, and saving again replaces them on purpose. A payment made while the form is open is never undone.
  - Forms that save every field (employee accounts, groups, the price list, supervising agents) send the record as
    they loaded it. If anything changed since, the save is refused and the form reloads with the current values, so a
    stale form can't, for example, reactivate an account someone just deactivated.
  - Case notes: an edit or delete is refused if the note was edited since it was shown.
  - The open client account reloads when you come back to the app from another window.

Some rules exist in both the backend and the frontend (the monthly fee rule, the first check-in limit, BIP check-in
messages, call-in reasons). `backend/test/sharedRules.test.js` fails if the two copies drift apart.

## API Endpoints

The backend provides REST API endpoints for:
- Authentication (`/api/auth/`)
- Client management (`/api/clients/`)
- Groups (`/api/groups/`)
- Attendance tracking (`/api/attendance/`)
- Financial transactions (`/api/financials/`)
- Call-in logs (`/api/callin/`)
- Polygraph scheduling (`/api/polygraphs/`)
- Testing (`/api/testing/`)
- Reports (`/api/reports/`)
- Admin functions (`/api/admin/`)

## Security

- **Logins:** `POST /api/auth/login` returns a session token that the frontend sends as `Authorization: Bearer <token>`
  on every other request. Sessions last `SESSION_HOURS` (default 12), and only a hash of the token is stored
  (`Sessions` table). Logging out, changing an employee's password, or deactivating them ends their sessions.
- **Identity:** the server takes the acting employee from the session, never from the request. Fields such as `user`,
  `createdBy`, `updatedBy`, `assignedBy`, `removedBy`, `?user=` and the `X-User` header are overwritten with the session's email
  (`backend/lib/auth.js`).
- **Admin-only routes:** account changes and the system log need an Office Admin or Business Administrator session;
  deleting a group needs a Business Administrator.
- **Login attempts:** 5 failed attempts for an email locks that email for 15 minutes.
- **CORS:** only the addresses in `CORS_ORIGINS` can call the API from a browser.

## Database

The application uses PostgreSQL. Schema changes live in `backend/migrations/` as numbered files (`038_add_something.sql`).
On startup the server applies every file not yet recorded in the `SchemaMigrations` table, in order, each in its own
transaction; if one fails, the server does not start.

To change the schema, add a new file with the next number. Never edit a migration that has already been applied.

Migrations 001–027 were run by hand before migrations were tracked. The first time the runner sees an existing
database, it records those as applied without running them again (several are not safe to repeat).

Note: the migrations assume the original tables (Clients, Groups, Attendance, and so on) already exist; there is no
migration that creates them from scratch yet.

## Troubleshooting

- **Site or API not responding**: look at `logs/server.log`. The watchdog logs each start and stop, and waits longer
  between attempts (up to 5 minutes) when the server keeps failing at startup. `Get-ScheduledTask 'STOP Server'` shows
  whether the task is running.
- **Database Connection Error**: Verify the `DATABASE_URL` in `.env` is correct and PostgreSQL is running
- **Port Already in Use**: Stop whatever else is using 5000 or 5173 (a `node server.js` or dev server started by
  hand), or change `PORT` / `FRONTEND_PORT` in `.env`. The site on 5173 failing to start is logged; the API keeps running.
- **Old screens after an update**: the site is checked on every load, so a reload picks up the new version.
- **SSL Certificate Error**: Ensure the certificate file exists at `backend/certs/stop-server.pfx` and the `SSL_PFX_PASSWORD` is correct