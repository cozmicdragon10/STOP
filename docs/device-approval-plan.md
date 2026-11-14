# Device approval: plan

Status: built and tested on the dev server and `stop_dev` (2026-11-14). Not deployed to the live server yet.

## As built (differences from the draft below)

- **First device:** set up from the server console with `npm run devices:bootstrap -- "<device name>"`, which prints a
  one-time setup code (valid 30 minutes). On that device, choose "I have a setup code" and enter it. The script refuses
  once any device is approved, so every later device uses the request flow.
- **Wrong emails:** the request form accepts only the email of an active STOP account and says so when the email is
  wrong (the owner's choice, so typos are clear). Five wrong emails from one address lock it out for 15 minutes. Wrong
  setup codes have the same lockout. Lockouts are kept in memory, like the login lockout, so a server restart clears them.
- **Approval memo:** the owner writes a memo when approving or denying, and can rename the device at the same time.
- **Cookie renewal:** approval never expires. Browsers drop a cookie after 400 days at most, so the cookie is renewed
  whenever the device is used (at most hourly).
- **Removing a device** blocks it on its very next request, even mid-session. The device you are using can't remove
  itself.
- **No IP addresses (2026-11-14, migration 068):** the owner doesn't need them, so they are not stored or shown, and the
  per-address request cap is gone. The caps are 2 pending per employee email and 20 overall. The wrong-attempt lockouts
  still key on the connection's address, in memory only. Where the draft below mentions IPs, this replaces it.
- **Recovery:** `npm run devices:bootstrap -- --recover "<name>"` at the server issues a setup code even when other
  devices are approved, for when no approved device can get in. It is logged as "Device Recovery". Keep at least two
  approved devices so this is rarely needed.
- **Not built yet:** the email alert for new requests (no email sending exists in the app) and the 60-day inactivity flag.

## Goal

Let councilors and staff reach STOP from home, the field and other offices, while making sure only approved devices can
even see the login screen. Approval is per device, not per person. Each device is approved once and stays approved until
someone removes it.

## Who it is for

About 11 to 13 people, using the same devices day to day and week to week. Requests are rare, and the owner reviews them
directly.

## User flow

1. A browser with no approved-device token opens the site. It sees only **Request access**, not the login form.
2. The person fills in a name, an email, a role, and an optional note (up to 300 characters), then submits.
3. The request appears in the DEV tab, with name, email, note, role, IP, browser, and time. The owner also gets an email
   alert (see Open questions).
4. The owner approves or denies it. Approval gives that browser a device token, and the normal login screen appears.
5. The person logs in with their password as before. Logins from approved devices are unchanged.
6. The owner can rename, deny, or revoke any device in the DEV tab. Revoking signs the device out at once and clears its
   token.

## Data

New table `Devices` (new numbered file in `backend/migrations/`, after the current last number):

- `Id`, `TokenHash` (SHA-256 of the device token, same approach as `Sessions`; the raw token is never stored)
- `Status`: `pending`, `approved`, `denied`, `revoked`
- `Name` (owner-editable; defaults from the request name and browser details)
- `RequestName`, `RequestEmail`, `RequestRole`, `RequestNote` (text only, max 300 characters)
- `UserAgent` (browser and OS, from the request)
- `FirstIp`, `LastIp`, `LastSeenOn`
- `RequestedOn`, `DecidedOn`, `DecidedBy`
- `ExpiresOn` is **not** used for approvals (approved devices do not expire). It is used only for pending requests (see Limits).

## Gate

- Runs before `requireSession` for every `/api` route except the device-request and device-status routes.
- A request without an approved device token gets a generic response, and the login route is not reached.
- Device token: random, stored by the browser as an HTTP-only, Secure, SameSite=Strict cookie. Scripts can't read it.
- An approved device's token is checked on each request, and `LastSeenOn` and `LastIp` are updated.
- Login itself is unchanged. It still needs a valid password, the per-account lockout still applies, and the session
  logic in `backend/lib/auth.js` is untouched.

## Endpoints

Public (no device token needed):
- `POST /api/devices/request`: creates a pending request. Validates the note length and fields. Returns the same message
  whether or not a limit was hit.
- `GET /api/devices/status`: tells the browser whether its device is pending, approved, denied or unknown, so the right
  screen shows.

DEV only (`requireDev`):
- `GET /api/devices`: list all devices with their status and details.
- `POST /api/devices/:id/approve`, `/deny`, `/revoke`, `/rename`.

Each action writes an audit log entry through the existing `logAction`.

## Limits

- **Pending cap:** at most 2 pending requests per device-request source (IP) and 2 per requested email. Overall pending
  cap of 20 as a backstop.
- **Approved devices are exempt** from the pending cap. The exemption checks the device token, not the IP address.
- **Pending requests expire after 24 hours** if nobody acts on them. Expired requests are cleared, not approved.
- **Request rate limit:** a short per-IP limit on the request route, so a script can't flood it. Temporary, not a permanent
  block.
- **No permanent IP blocking** in this version. The DEV tab shows IPs for you to review by hand.

## Owner tools in the DEV tab

- Pending list at the top, with approve and deny buttons, the note and details shown as plain text.
- Approved devices list with name, IP, last seen, and a rename button.
- Revoke button for each device, with a confirmation.
- Optional flag for devices not seen in 60 days. It only marks them; nothing is removed automatically.

## Frontend

- Request-access screen (form and confirmation message), shown when the device isn't approved.
- Waiting screen for pending devices.
- DEV tab section for devices, reusing the existing sessions list layout.
- Form validation (length and required fields) goes in `frontend/src/utils/` with a `*.test.ts` file.

## Tests

- Backend (`npm test`): request creation, caps, generic responses, the gate on each route, approve/deny/revoke/rename,
  expiry of pending requests, IP and last-seen updates, and the DEV-only checks.
- Frontend (`npx vitest run`): note validation and the status-to-screen mapping.
- Run the e2e suite only against a test copy of the database.

## Privacy and retention

- IP addresses and request details are personal information. Confirm with IT or the policy owner how long to keep them,
  and whether revoked or denied devices should be deleted after a set period.

## Things that need a decision

1. **Email alert:** how should the owner get the new-request email? Options: an SMTP account, Microsoft Graph, or simply
   checking the DEV tab. Note that the PO report currently saves an `.eml` file rather than sending mail, so no sending
   setup exists yet.
2. **IP and detail retention** (see Privacy above).
3. **Cookie or local storage:** the plan uses an HTTP-only cookie. That blocks scripts from reading it, but it means the
   cookie setting must work with how staff reach the site.

Decided: no reverse proxy and no Cloudflare. The owner will approve and manage devices personally, so `trust proxy` is not
needed and the IP shown is the connection's own address.

## Rollout

1. Build and test on the dev server (port 5174, local database 5100) and the test database copy.
2. Review the changes together.
3. Only then deploy with `deploy/update.ps1`, which is a live change and needs your approval.
4. Approve the existing devices (the owner's own first, then each councilor's, one at a time).

## Estimate

About 1 to 2 days of focused work, including tests. Most of the time is the DEV tab screens and the test cases.

## Outside this plan

This plan covers device approval only. It does not replace HTTPS, the password rules, or the data-access rules already in
`backend/lib/auth.js` and `polygrapherAccess.js`. How devices reach the app from outside the office is a separate decision
and is not covered here. Without a VPN or proxy, the site's port must be open to the internet, which this plan does not
change.
