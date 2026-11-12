# End-to-end tests: two people at once

These tests use the real site the way two staff members would. **Person A** works in the site in Microsoft Edge
(run headless, so no window opens). **Person B** is a second login making changes at the same time. They check that
overlapping work is never silently lost: payments while someone edits a client, two people editing the same record,
accounts, groups, agents, the price list, case notes, and the open account refreshing.

> **Only run these against a TEST COPY of the database.** They create records named "Concurrency Test", take small
> test payments, and edit test notes. They refuse to run without `--test-database`.

## Setup (once)

1. `npm install` in this folder. It uses the Edge already on the PC; nothing else to download.
2. Give it a login for a Business Administrator account on the test database, either as `e2e/login.json`:
   `{ "email": "...", "password": "..." }` (ignored by git, so it stays on this PC), or by pointing the
   `STOP_E2E_LOGIN` environment variable at a file in that format.
3. The site and API must be running (see `deploy/README.md`). Defaults: `https://localhost:5173` and
   `https://localhost:5000/api`. Point elsewhere with `STOP_E2E_SITE` and `STOP_E2E_API`.
4. The group test needs at least two active counselors in the database.

## Running

```
node run.js --test-database           # everything (about 3 minutes)
node run.js --test-database notes     # only scenarios whose name contains "notes"
```

Each check prints PASS or FAIL, then a total, and the exit code is non-zero when anything failed. A scenario that
stops partway saves a screenshot in `e2e/screenshots/`.

Run them after changes to saving, editing, or payments, before putting the changes live with `deploy/update.ps1`.
