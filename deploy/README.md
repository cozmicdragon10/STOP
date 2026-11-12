# Running STOP on the office server

The backend serves both the API (`https://<server>:5000`) and the built site (`https://<server>:5173`, the address
staff use). A watchdog keeps it running, and Windows starts the watchdog automatically.

Code changes never reach staff on their own. They go live only when `update.ps1` runs, so a half-finished edit can't
break the site people are using.

## One-time setup

1. Stop anything already using ports 5000 or 5173, such as a `node server.js` left running.
2. Install the startup task, from PowerShell in this folder:
   - `.\install-startup.ps1 -AtBoot` (recommended): starts at boot, before anyone logs on. Open PowerShell with
     **Run as administrator** for this one.
   - `.\install-startup.ps1`: starts when this Windows user logs on. No admin needed, but after a restart (Windows
     Update, power cut) the app stays down until someone logs on.
3. Build and start the site: `.\update.ps1`.

## Day to day

| To... | Run (in this folder) |
|---|---|
| Put code changes live | `.\update.ps1`: runs the tests, builds the site into a new folder, switches to it, restarts. If the tests or the build fail, the live site is left as it was. |
| Undo the last update's screens | `.\rollback.ps1` (or `.\rollback.ps1 -List`, then `.\rollback.ps1 -To <name>`). Database changes stay. |
| Restart the server | `.\restart.ps1` |
| Stop for maintenance | `Stop-ScheduledTask 'STOP Server'`, then stop the `node` process on port 5000. Start again with `Start-ScheduledTask 'STOP Server'`. |

A restart takes about 10 seconds. Anyone saving at that moment gets a "can't reach the server" message, and trying
again works. When the task was installed with `-AtBoot`, run these as administrator.

**Where things are:**
- `logs\server.log` at the top of the project: everything the server prints, plus each start and stop. It's set aside
  as `server.log.old` once it passes 10 MB.
- `site\builds\` holds the last 5 builds, and `site\current.txt` names the live one.

## Developing

`npm run dev` in `frontend/` runs on **5174** (`https://localhost:5174`), beside the live site. It talks to the same
API and database as the live site, so anything saved there is saved for real. Backend changes need `.\restart.ps1`
(or `.\update.ps1`) to take effect.

## Testing two people at once

`e2e/` at the top of the project has the end-to-end tests. See `e2e/README.md`. Only run them against a test copy
of the database: they create test records and take test payments.
