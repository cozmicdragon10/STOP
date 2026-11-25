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
`npm start` runs locally with `APP_ENV=dev`: it uses the developer database (`DEV_DATABASE_URL`, `stop_dev`), never the
live one, and listens on `https://localhost:5100` (the site on 5180). The live API on 5000 can keep running beside it.
Startup logs `Using database stop_dev (APP_ENV dev)`. The deployed server runs `node server.js` without `APP_ENV`
(see `deploy/run-server.ps1`), so it always uses `DATABASE_URL`, the live `stop_db`.

#### Start the Frontend Development Server
In a new terminal:
```bash
cd frontend
npm run dev
```
The dev server runs on `https://localhost:5174`. It calls the local backend on port 5100 (`VITE_API_PORT` in
`frontend/.env.development`), so its data is the `stop_dev` database, not the live one.

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
│       │   └── admin/, agents/, callin/, groups/, reports/, settings/  #   the other tabs
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
- **Group check-in comments** (`backend/lib/attendanceNotes.js`): a comment typed for a client on the Review &
  Comments screen is not saved on the attendance. When the group closes it goes on the client's case notes as a
  Therapist note labeled "Attendance" (BIP clients: their BIP week) with the group and the date the group took place.
  It is written as the covering counselor, else the group's usual counselor, else whoever closed the group. An
  approved make-up is still marked on the attendance. The note is linked to the attendance (Notes.AttendanceId), so
  Update Attendance Notes on a closed group can add, change, or remove it later.
- **Reopening a closed group** (`backend/lib/reopenGroup.js`, Business Administrators and DEV): every check-in in the
  session is undone like deleting it (`backend/lib/undoAttendance.js`: fee, payment, BIP week, poly voucher, Federal SO
  units, Last Date Attended) and the clients go back on an open sheet with the same fees, Cash/Other payments, vouchers,
  make-ups, durations and comments (their Therapist notes come off and are written again on close). The sheet keeps the
  session's opener and covering counselor. Closing it again records everything fresh under today's fee rules. Refused
  when the session's cash is on a deposit or a waiting hand-off, a payment was refunded or disputed, or a client is in
  the session twice (old-system data). A reason is required and goes on each client's change log.
- **BIP weeks** (`backend/lib/bipWeeks.js`): a BIP client's week (stored in Phase) is the number of group attendances
  on or after their last BIP intake (a completed BIP Intake or DV Assessment here, or one recorded from another
  provider; a reinstate doesn't restart it). A check-in adds one and deleting a check-in takes one off, only when it is
  dated on or after the last intake. Completing, recording, or removing an intake counts the week again. A check-in
  added for an earlier date is labeled with the week it fell in. Edit Info only accepts a whole number.
- **Poly fee payment corrections** (`backend/lib/poly.js`): adjusting, refunding, or disputing a poly fee payment
  moves poly fee paid, which never goes below $0. Booking a polygraph spends the poly fee (paid resets to $0), so
  taking money back after that is owed on the account balance instead.
- **Assessments** (`backend/lib/assessmentWork.js`, `frontend/src/utils/assessmentWork.ts`): booked on the
  Assessment Calendar (Scheduled), then begun once the client pays the fee plus any past due balance (cash only, no
  refund after). Beginning records the attendance that day, In Progress. The counselor adds notes (also saved as
  Assessment case notes) for as long as it takes, then completes it; a BIP intake or reinstate clears the client for
  group only when completed. Counselors work on their own assessments; Office Admins and Business Administrators on
  all. Only a Business Administrator can change an assessment's price, or begin one on a DHS invoice or voucher: the
  client isn't charged (the price is kept on the attendance for billing), a past due balance is still paid first, and
  the required note goes on the client's case notes.
- **Max Debt Override** (`backend/routes/clientDebtLimits.js`, set on the client's account by Business Administrators,
  through an expiration date): the client may owe up to its amount and still attend. It raises the $0.00 needed at the
  first group check-in of the month (every check-in for Chaperon clients) and at the first individual session of the
  month, and lets an assessment begin with up to that much owed after its fee.
- **Forgive Debt** (`backend/lib/debtForgiveness.js`, `POST /api/clients/:id/forgive-debt`, the Financial Ledger tab's
  Forgive Debt button, Business Administrators and DEV only): writes off some or all of what a client owes, with a
  required reason. It is an Adjustment ledger row (fee type Debt Forgiven), so it lowers the balance without counting
  as a payment on any cash or income report, and goes on the change log and system log. It can't put the account in
  credit, and is refused if the balance changed while the form was open. A forgiven row's **Change** fixes a wrong
  amount and **Undo** sets it to $0.00 so the client owes it again (wrong client: undo it, then forgive on the right
  one); `PUT /api/financials/:id/forgiveness`. Like a cash payment adjustment, the row keeps its first amount and who
  corrected it and why, and later ledger and attendance balances move by the difference.
- **New accounts**: New User refuses an email that already has an account; existing accounts are changed with Edit,
  which signs the person out when their password changes or the account is deactivated.
- **Payment blocks** (Business Administrators, on the client's Ledger tab, with a reason): **Block Card Payments**
  (e.g. after a disputed card payment; `backend/lib/cardBlock.js`) and **Block Check Payments** (e.g. after a bounced
  check; `backend/lib/checkBlock.js`). Only personal checks are blocked; money orders and cashier's checks are still
  taken. The account shows a "Cash Only" or "No Checks" badge, payment screens don't offer the blocked method, and the
  server refuses it on every payment path. Each change goes on the change log and case notes.

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
messages, call-in reasons, assessment rules). `backend/test/sharedRules.test.js` fails if the two copies drift apart.

## API Endpoints

The backend provides REST API endpoints for:
- Authentication (`/api/auth/`)
- Client management (`/api/clients/`)
- Groups (`/api/groups/`)
- Attendance tracking (`/api/attendance/`)
- Financial transactions (`/api/financials/`)
- Call-in logs (`/api/callin/`)
- Polygraph scheduling (`/api/polygraphs/`)
- Reports (`/api/reports/`)
- Admin functions (`/api/admin/`)

## Security

- **Approved devices:** only a browser approved in the DEV tab can reach the login or the API (`backend/lib/devices.js`,
  `docs/device-approval-plan.md`, setup and recovery in `deploy/README.md`).
- **Logins:** `POST /api/auth/login` returns a session token that the frontend sends as `Authorization: Bearer <token>`
  on every other request. The browser saves it, so refreshing keeps you logged in and every window of that browser
  shares the login; logging out in one window logs out all of them. A session ends `SESSION_HOURS` (default 12) after
  login or after `SESSION_IDLE_MINUTES` (default 120) without activity, whichever is first; the Polygraphs tab's timed
  refresh is sent with `X-Background: 1` and doesn't count as activity. Only a hash of the token is stored (`Sessions`
  table, with the device it came from). Logging out, changing an employee's password, deactivating them, or removing
  their device ends their sessions.
- **Identity:** the server takes the acting employee from the session, never from the request. Fields such as `user`,
  `createdBy`, `updatedBy`, `assignedBy`, `removedBy`, `?user=` and the `X-User` header are overwritten with the session's email
  (`backend/lib/auth.js`).
- **Admin-only routes:** the system log needs an Office Admin or Business Administrator session; creating or changing
  an employee account, and deleting a group, need a Business Administrator. Nobody can change their own role, and the
  last active Business Administrator can't be demoted or deactivated (`backend/lib/accounts.js`).
- **Roles** (checked by the server, not just hidden on screen):
  - **DEV:** a developer account. Everything a Business Administrator can do (the server reads the role as Business
    Administrator, `backend/lib/roles.js`), plus the **DEV** menu (server and database information, `/api/dev/*`). Only a
    DEV account can give out the DEV role or change a DEV account.
    The DEV menu's **Database Sync** (`backend/lib/dbSync.js`) copies the whole database (schema, data, views) between
    the app database and a local copy on the same PostgreSQL server (`stop_dev`, or `DEV_DATABASE_NAME` in `.env`).
    *Pull* replaces the local copy. *Push* replaces the live database after backing it up to `backups/` (git-ignored),
    must be confirmed by typing the database name, and logs out anyone who logged in after the last pull. pg_dump/psql come from `PG_BIN` or the newest
    `C:\Program Files\PostgreSQL\<version>\bin`.
  - **Business Administrator:** everything. Only role that creates or changes employee accounts, discharges clients,
    and changes a client's balance, treatment fee, vouchers or poly fee by hand on the Information tab (every such
    change goes on the client's change log; `backend/lib/moneyFields.js`). Anyone may save the price list's treatment
    fee for a client's program and phase.
  - **Office Admin:** every tab; edits group details and creates groups (with Business Administrators).
  - **Counselor:** every client (with a "My clients" toggle that starts on), check-in and payments taken in the field,
    edit client information, Therapist case notes only (Admin notes are the office's), attachments (view and upload),
    polygraph schedule and results on the account (view only), groups (read-only details), agents (read-only), Cash
    Deposits (their own cash, and marking it dropped off), and a My Day home screen: a month calendar (closed, open and upcoming scheduled groups, with a month selector) and the
    sessions they opened, closed or covered that month (`GET /api/my-sessions`). No client or money figures there. The roster's
    "My clients" view also lists clients they covered in the last 30 days in their own "Covered recently" section
    (`GET /api/clients/covered-by-me`, from `Attendance.CoveredBy`). They can't adjust or refund
    payments, add manual charges, set overrides, book or cancel polygraphs, or see the change log. A server allowlist
    enforces this (`backend/lib/counselorAccess.js`). A counselor's note for a client with no attendance this month
    waits for a Business Administrator's approval.
  - **Polygrapher:** the Polygraphs tab (open, cancel and reschedule slots, record results), Forms (read-only), and a
    limited Client Roster: a client's personal, contact and program information, polygraph history, and documents
    (view and upload). No balances, fees, notes, payments or edits; enforced in `backend/lib/polygrapherAccess.js`.
  - Everyone has a **Settings** tab for their own colors, fonts and layout, and anyone but a Polygrapher can activate
    a discharged client.
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