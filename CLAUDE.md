# CLAUDE.md

Guidance for Claude Code in this repository. The full project overview is in [README.md](README.md); read it for
structure, business rules, roles and security.

## What this is

STOP: a full-stack office app (clients, groups, attendance, payments, polygraphs, reports).
- `backend/`: Node.js + Express (CommonJS), PostgreSQL, HTTPS. API on port 5000, built site served on 5173.
- `frontend/`: React 19 + TypeScript + Vite + Tailwind. Dev server on 5174.
- `deploy/`: PowerShell scripts for the office server. `e2e/`: two-people-at-once tests.

## Commands

- Backend tests: `cd backend && npm test` (Node's test runner, no database needed)
- Frontend tests: `cd frontend && npx vitest run` (run from PowerShell on Windows)
- Frontend type check + build: `cd frontend && npm run build`
- Lint: `cd frontend && npm run lint`
- Dev: `cd backend && npm start` (local: APP_ENV=dev, stop_dev database, API on 5100), then `cd frontend && npm run dev`
- Migrations: `cd backend && npm run migrate:status`

## Rules to follow

- **This machine may be the live office server.** Do not run `deploy/update.ps1`, `rollback.ps1`, `restart.ps1`, or
  stop the server on ports 5000/5173 unless asked. Do not touch `site/` or `logs/` by hand.
- **Never commit** `backend/.env` or `backend/certs/*.pfx`.
- **Database changes**: add a new numbered file in `backend/migrations/` (next number). Never edit an applied migration.
  Migrations run automatically on server start.
- **e2e tests** run only against a test copy of the database (`node run.js --test-database`), never production.
- **Shared rules** exist in both backend and frontend (monthly fee, first check-in limit, BIP messages, call-in
  reasons). Change both; `backend/test/sharedRules.test.js` checks they match.
- **Identity and roles are enforced on the server** (`backend/lib/auth.js`, `polygrapherAccess.js`, `moneyFields.js`).
  Never trust user identity from the request body/headers; never rely on hiding UI alone.
- **Concurrent edits**: money changes lock the client row; Edit Info sends only changed fields with their original
  values (`backend/lib/editConflicts.js`, `frontend/src/utils/clientEdits.ts`). Keep that behavior when touching saves.
- Business logic shared between routers belongs in `backend/lib/`; frontend business rules go in `frontend/src/utils/`
  with `*.test.ts` tests.
- Run the backend and frontend tests before saying a change is done.
