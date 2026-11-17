# End-to-end tests: two people at once

These tests use the real site the way two staff members would. **Person A** works in the site in Microsoft Edge
(run headless, so no window opens). **Person B** is a second login making changes at the same time. They check that
overlapping work is never silently lost: payments while someone edits a client, two people editing the same record,
accounts, groups, agents, the price list, case notes, and the open account refreshing.

> **They run only against the DEV database (`stop_dev`).** They create records named "Concurrency Test", take small
> test payments, and edit test notes. They refuse to run without `--test-database`.

The tests start **their own copy of STOP** and stop it when they finish (or fail, or you press Ctrl+C): the backend
on port 5120 and the site from the current `frontend/` source on 5122, both on `stop_dev`. They never use the live
site (5000/5173) or your own dev servers (5100/5174), and they stop if the copy reports any database other than
`stop_dev`. See `servers.js`.

The copy's device gate is passed the way a new office PC would be: the first run approves a device named
"E2E test runner (stop_dev)" from the server console, on `stop_dev` only, and keeps its cookie in
`e2e/.device-token` (ignored by git). Later runs reuse it; if it is ever removed in the DEV tab, the next run approves
a new one.

## Setup (once)

1. `npm install` in this folder. It uses the Edge already on the PC; nothing else to download.
2. Give it a login for a Business Administrator (or DEV) account on `stop_dev`, either as `e2e/login.json`:
   `{ "email": "...", "password": "..." }` (ignored by git, so it stays on this PC), or by pointing the
   `STOP_E2E_LOGIN` environment variable at a file in that format.
3. `backend/` and `frontend/` need their packages installed (`npm install` in each), and `backend/.env` as usual.
   Nothing needs to be running.
4. The group test needs at least two active counselors in `stop_dev`.

## Running

```
node run.js --test-database           # everything (about 3 minutes)
node run.js --test-database notes     # only scenarios whose name contains "notes"
```

Each check prints PASS or FAIL, then a total, and the exit code is non-zero when anything failed. A scenario that
stops partway saves a screenshot in `e2e/screenshots/`. If a run says a port is already in use, another run (or a
stuck copy from one) is still going: stop it and run again.

Run them after changes to saving, editing, or payments, before putting the changes live with `deploy/update.ps1`.
