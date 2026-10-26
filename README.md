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

### Development Mode

#### Start the Backend Server
```bash
cd backend
npm start
```
The backend applies any pending migrations, then starts on `https://localhost:5000` (or the `PORT` in `.env`).

#### Start the Frontend Development Server
In a new terminal:
```bash
cd frontend
npm run dev
```
The frontend will be available at `http://localhost:5173` (or the URL shown in your terminal)

### Production Build

#### Build the Frontend
```bash
cd frontend
npm run build
```
This generates an optimized production build in the `dist` folder.

#### Run Backend in Production
```bash
cd backend
npm start
```

## Available Scripts

### Backend
- `npm start` - Apply pending migrations and start the HTTPS server
- `npm test` - Run the backend tests (Node's built-in test runner; no database needed)
- `npm run migrate` - Apply pending migrations without starting the server
- `npm run migrate:status` - List migrations that have not been applied yet

### Frontend
- `npm run dev` - Start development server with Vite
- `npm run build` - Build for production
- `npm test` - Run the unit tests (Vitest)
- `npm run lint` - Run ESLint to check code quality
- `npm run preview` - Preview the production build locally

## Project Structure

```
STOP/
├── backend/              # Express.js backend server
│   ├── server.js         # Startup: runs migrations, then serves app.js over HTTPS
│   ├── app.js            # Express app; mounts every router in routes/
│   ├── db.js             # PostgreSQL pool and the system log helper (logAction)
│   ├── migrate.js        # Migration runner
│   ├── routes/           # One router per API area (clients, groups, polygraphs, reports, ...)
│   ├── lib/              # Logic shared between routers (attendance, poly vouchers, access, SQL fragments)
│   ├── migrations/       # Numbered SQL migrations, applied in order
│   ├── test/             # Backend tests
│   ├── passwords.js      # Password hashing
│   ├── dischargeSummary.js  # Discharge summary PDF
│   └── certs/            # SSL certificate
├── frontend/             # React frontend with Vite
│   ├── src/App.tsx       # Main app shell and tabs
│   ├── src/components/   # Tab and dialog components
│   ├── src/utils/        # Business rules and formatting helpers (with *.test.ts tests)
│   └── src/api.ts        # Calls to the backend
└── README.md
```

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
  `createdBy`, `updatedBy`, `?user=` and the `X-User` header are overwritten with the session's email
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

- **Database Connection Error**: Verify the `DATABASE_URL` in `.env` is correct and PostgreSQL is running
- **Port Already in Use**: Change the `PORT` variable in `.env` or stop other services using that port
- **SSL Certificate Error**: Ensure the certificate file exists at `backend/certs/stop-server.pfx` and the `SSL_PFX_PASSWORD` is correct