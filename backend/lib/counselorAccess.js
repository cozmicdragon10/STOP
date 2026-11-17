// What a Counselor can do. Counselors cover each other's groups and take money in the field, so they see every client,
// check people in, take payments, and keep the account's notes, attachments and polygraph results. What they can't do is
// correct money (adjust a cash payment, refund or dispute a card payment, add a manual charge), set card or fee overrides,
// book or change polygraph slots, edit agents, change groups, or see the change log, reports and system pages.
// Anything not on this list is refused here, on the server, whatever the screen shows.
// Case notes: a counselor can only write Therapist notes (routes/clients.js); notes they write for a client who hasn't
// attended this month wait for a Business Administrator's approval.
const ALLOWED = [
    ['GET', /^\/api\/auth\/me$/],
    ['POST', /^\/api\/auth\/logout$/],
    // Shared lists the app loads at sign-in
    ['GET', /^\/api\/admin\/employees$/],
    ['GET', /^\/api\/agents$/],
    ['GET', /^\/api\/program-fees$/],
    ['GET', /^\/api\/federal-units$/],
    ['GET', /^\/api\/session-types$/],
    ['GET', /^\/api\/documents(\/\d+)?$/],
    // Client Roster and account: every client, with edit-info, check-in and payment history
    ['GET', /^\/api\/clients$/],
    ['GET', /^\/api\/clients\/covered-by-me$/],
    ['POST', /^\/api\/clients$/],
    ['GET', /^\/api\/clients\/\d+$/],
    ['PATCH', /^\/api\/clients\/\d+$/],
    ['PUT', /^\/api\/clients\/\d+$/],
    ['PUT', /^\/api\/clients\/\d+\/no-poly-required$/],
    ['POST', /^\/api\/clients\/\d+\/bus-pass$/],
    ['POST', /^\/api\/clients\/\d+\/activate$/],
    ['GET', /^\/api\/clients\/\d+\/(attendance|group-cancellations|financials|notes|polygraphs|poly-summary|discharges|progress|bip-intake|fee-override|poly-fee-override|debt-limit)$/],
    ['POST', /^\/api\/clients\/\d+\/outside-bip-assessments$/],
    ['DELETE', /^\/api\/outside-bip-assessments\/\d+$/],
    ['GET', /^\/api\/transactions\/\d+$/],
    // Case notes (Therapist only for counselors; own notes can be edited or deleted)
    ['POST', /^\/api\/clients\/\d+\/notes$/],
    ['PUT', /^\/api\/notes\/\d+$/],
    ['DELETE', /^\/api\/notes\/\d+$/],
    // Attachments: view and upload (no rename or delete)
    ['GET', /^\/api\/clients\/\d+\/attachments$/],
    ['POST', /^\/api\/clients\/\d+\/attachments$/],
    ['GET', /^\/api\/attachments\/\d+$/],
    // Groups: see them and their rosters; the groups themselves are edited by office roles
    ['GET', /^\/api\/groups$/],
    ['GET', /^\/api\/groups\/\d+\/(clients|sessions)$/],
    ['POST', /^\/api\/groups\/\d+\/assign$/],
    // My Day: cancel or reschedule one upcoming meeting of a group they lead, or undo that (routes/groupScheduleChanges.js
    // checks they lead the group)
    ['GET', /^\/api\/group-schedule-changes$/],
    ['POST', /^\/api\/groups\/\d+\/schedule-changes$/],
    ['DELETE', /^\/api\/group-schedule-changes\/\d+$/],
    // Check-in, sessions and payments taken in the field
    ['GET', /^\/api\/open-groups$/],
    ['PUT', /^\/api\/open-groups$/],
    ['DELETE', /^\/api\/open-groups\/\d+$/],
    ['GET', /^\/api\/closed-groups$/],
    ['GET', /^\/api\/my-sessions$/],
    ['POST', /^\/api\/attendance\/batch$/],
    ['GET', /^\/api\/individual-sessions\/(open|closed)$/],
    ['PUT', /^\/api\/individual-sessions\/open$/],
    ['DELETE', /^\/api\/individual-sessions\/open\/\d+$/],
    ['POST', /^\/api\/individual-sessions\/close$/],
    // Assessments they're the counselor on: begin (with the payment), see, add notes, complete (routes/sessions.js keeps a
    // counselor to their own, lib/assessmentWork.js)
    ['POST', /^\/api\/assessments\/begin$/],
    ['GET', /^\/api\/assessments\/(in-progress|\d+)$/],
    ['POST', /^\/api\/assessments\/\d+\/(notes|complete)$/],
    // Assessment calendar: open their own times and schedule clients in them (routes/assessmentAppointments.js keeps a
    // counselor to their own times)
    ['GET', /^\/api\/assessment-appointments$/],
    // (Cancelling all of a counselor's open times is for Business Administrators only)
    ['POST', /^\/api\/assessment-appointments(\/slots)?$/],
    ['POST', /^\/api\/assessment-appointments\/\d+\/(assign|unassign|cancel|move)$/],
    ['PUT', /^\/api\/assessment-appointments\/\d+$/],
    ['POST', /^\/api\/financials\/payment$/],
    ['POST', /^\/api\/callin\/(client|group)$/],
    // Polygraphs: the schedule only (booking, rescheduling and results are the Polygrapher's and office's)
    ['GET', /^\/api\/polygraphs\/slots$/],
    // Cash Deposits: the group cash they're holding and marking dropped off
    ['GET', /^\/api\/reports\/(user|group)-cash-deposits$/],
    ['PUT', /^\/api\/reports\/(user|group)-cash-deposits$/],
];

const isCounselorAllowed = (method, path) => ALLOWED.some(([m, re]) => m === method && re.test(path));

// Express middleware, after requireSession
const counselorAccess = (req, res, next) => {
    if (req.user?.role !== 'Counselor') return next();
    if (!isCounselorAllowed(req.method, req.path)) {
        return res.status(403).json({ error: 'Counselor accounts can\'t do that. Ask the office if you need it.' });
    }
    next();
};

module.exports = { counselorAccess, isCounselorAllowed };
