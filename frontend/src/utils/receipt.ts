import type { PaymentMethod } from '../hooks/useGroupCheckIn';
import { formatBalance } from './balance';
import { formatDisplayTime } from './dates';
import { getEmployees, getPolySummary } from '../api';

// A saved payment, as shown on a printed receipt. newBalance uses the stored sign (positive = owes).
export interface Receipt {
  clientName: string;
  docNumber: string;
  amount: number;
  method: PaymentMethod;
  newBalance: number;
  // The balance just before this payment (stored sign). Left out, it's worked out from newBalance: the part of the
  // payment that went to the account (not the poly fee) is added back.
  balanceBefore?: number;
  // The ledger row ID(s) of the payment, printed beside "Thank you." and looked up in Admin > Transaction Lookup
  transactionIds?: number[];
  processedBy: string;
  date: string;
  // What the payment went to (the ledger row's fee type, e.g. "Group Fee" or "Poly Fee"); printed when set
  appliedTo?: string;
  // Reprinted later from the client's ledger rather than printed when the payment was taken
  reprint?: Reprint;
  // Portion of the payment applied to the poly fee, and the poly fee standing afterwards
  polyApplied?: number;
  polyFeePaid?: number;
  polyFee?: number;
  // Notes typed with the payment, printed at the bottom
  notes?: string;
}

export const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// A group, assessment, or individual session, as shown on a printed attendance receipt. Balances use the stored sign
// (positive = owes).
export interface AttendanceReceipt {
  clientName: string;
  docNumber: string;
  // 'Group', 'Assessment', or 'Individual'
  sessionKind: string;
  // The group's name, or the assessment / session type
  sessionName: string;
  // YYYY-MM-DD
  sessionDate: string;
  provider?: string | null;
  fee: number;
  // Payments for this session. alreadyApplied: already in balanceBefore (e.g. paid when an individual session was
  // opened, or a card at check-in); the receipt adds it back so balance before + fee - payments = balance after.
  payments: { label: string; amount: number; method?: string | null; alreadyApplied?: boolean }[];
  balanceBefore?: number;
  balanceAfter?: number;
  // The client, for the polygraph dates printed at the bottom
  clientId: number;
  // Reprint of a past session (see Reprint below)
  reprint?: Reprint;
}

// A receipt reprinted later from the client's account. It is marked as a copy, the balances from back then are labeled
// as of that payment or session, and the client's balance today is printed as the total so the old one isn't taken for it.
export interface Reprint {
  // Stored sign: positive = owes
  currentBalance: number;
  // YYYY-MM-DD of the payment or session, for labeling the balance from back then
  asOf: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;
// A balance with whether it is owed or a credit, e.g. "(Owed) -$150.00" or "(Credit) $20.00"; stored sign: positive = owes
const balanceText = (stored: number) => {
  const cents = Math.round(stored * 100);
  const tag = cents > 0 ? '<span class="tag">(Owed)</span> ' : cents < 0 ? '<span class="tag">(Credit)</span> ' : '';
  return `${tag}${escapeHtml(formatBalance(stored))}`;
};
// Receipt dates are YYYY-MM-DD shown as MM/DD/YY
const shortDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y.slice(-2)}` : ymd;
};

// Receipts are laid out for an 80 mm thermal receipt printer (Star TSP100III): 72 mm printable width, solid black
// only (thermal printers can't print gray), and no page margins so the browser has no room for its date/URL headers.
// In the printer's settings, choose the "72mm x Receipt" paper size so the page is cut right after the receipt.
const RECEIPT_STYLE = `<style>
    @page{margin:0}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#fff}
    body{width:72mm;padding:0 3mm 4mm;font-family:Arial,Helvetica,sans-serif;color:#000;font-size:11pt;line-height:1.25;
      -webkit-print-color-adjust:exact;print-color-adjust:exact}
    .center{text-align:center}
    .biz{font-size:13pt;font-weight:bold;line-height:1.1}
    h2{font-size:12pt;margin:0;text-transform:uppercase;letter-spacing:.5px}
    .small{font-size:9pt}
    .tag{font-size:9pt;font-weight:normal}
    hr{border:0;border-top:1px dashed #000;margin:2mm 0}
    table{width:100%;border-collapse:collapse}
    td{padding:.6mm 0;vertical-align:top}
    td.r{text-align:right;padding-left:2mm;white-space:nowrap}
    td.wrap{white-space:normal}
    table.poly td:first-child{white-space:nowrap}
    tr.total td{border-top:2px solid #000;padding-top:1.2mm;font-weight:bold;font-size:12pt}
    p{margin:1.5mm 0}
  </style>`;

const receiptHeader = (title: string) => `<div class="center"><div class="biz">Chandler &amp; Associates</div><h2>${title}</h2>
    <div class="small">${escapeHtml(new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))}</div></div><hr>`;
// The client's name with their ID # (and its type) to the right, e.g. "Sanchez, Jason      DOC 581422"
const clientLine = (name: string, docNumber: string) =>
  `<table><tr><td><b>${escapeHtml(name)}</b></td><td class="r"><b>${docNumber ? escapeHtml(docNumber) : ''}</b></td></tr></table>`;
// "Thank you." with the transaction ID number(s) beside it, when the receipt is for a saved payment
const receiptFooter = (ids: number[] = []) =>
  `<hr><p class="center">Thank you.${ids.length > 0 ? ` &nbsp; ${ids.map(id => escapeHtml(String(id))).join(', ')}` : ''}</p>`;

// Writes the receipt into a small window sized like the paper and opens the print dialog. The window is opened right
// away (while still handling the click, so pop-up blockers allow it); a body still loading is filled in when ready.
// Pop-ups must be allowed for this site.
const printReceiptPage = (title: string, body: string | Promise<string>, onError: (message: string) => void, transactionIds?: number[]) => {
  const win = window.open('', '_blank', 'width=360,height=640');
  if (!win) {
    onError('Allow pop-ups for this site to print receipts.');
    return;
  }
  const write = (html: string) => {
    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${RECEIPT_STYLE}</head><body>${receiptHeader(title)}${html}${receiptFooter(transactionIds)}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };
  if (typeof body === 'string') {
    write(body);
    return;
  }
  win.document.write('<p style="font-family:Arial,sans-serif">Preparing receipt…</p>');
  body.then(write);
};

const ymdToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The polygraph lines at the bottom of an attendance receipt; empty for clients who don't take polygraphs, or if the
// dates can't be loaded (the receipt still prints)
const polygraphSection = async (clientId: number) => {
  try {
    const p = await getPolySummary(clientId);
    if (!p.takesPolygraphs) return '';
    // Same size and layout as the Last polygraph line: "Next polygraph    12/03/26 10:00 AM", then where it is: the
    // slot's street address followed by its location (the city), e.g. "800 E 6th Ste C, Stillwater", wrapping onto
    // more lines if long. The location isn't repeated when the address already includes it.
    const street = (p.next?.address || '').replace(/\s*[\r\n]+\s*/g, ', ').trim();
    const city = p.next?.location?.trim() || '';
    const where = street && city && !street.toLowerCase().includes(city.toLowerCase()) ? `${street}, ${city}` : street || city;
    const next = p.next
      ? `<tr><td>Next polygraph</td><td class="r">${escapeHtml(shortDate(p.next.date))}${p.next.time ? ` ${escapeHtml(formatDisplayTime(p.next.time))}` : ''}</td></tr>${
        where ? `<tr><td>Poly address</td><td class="r wrap">${escapeHtml(where)}</td></tr>` : ''}`
      : '<tr><td>Next polygraph</td><td class="r">Not scheduled</td></tr>';
    const last = p.lastTaken && p.lastTaken <= ymdToday() ? escapeHtml(shortDate(p.lastTaken)) : 'None yet';
    return `<hr><table class="poly"><tr><td>Last polygraph</td><td class="r">${last}</td></tr>${next}</table>`;
  } catch {
    return '';
  }
};

// The counselor's name followed by their credentials, e.g. "Belinda Harris, LPC, LADC-MH". Takes a display name or an
// account email (a covering counselor is saved by email) and always prints the name, never an email.
const counselorWithCredentials = async (nameOrEmail: string) => {
  const key = nameOrEmail.trim().toLowerCase();
  const fallback = key.includes('@') ? '' : nameOrEmail.trim();
  try {
    const match = (await getEmployees()).find(e => (e.displayname || '').trim().toLowerCase() === key || e.employeeemail.toLowerCase() === key);
    if (!match) return fallback;
    const name = match.displayname?.trim() || fallback;
    return name && match.credentials?.trim() ? `${name}, ${match.credentials.trim()}` : name;
  } catch {
    return fallback;
  }
};

// A reprint is marked as a copy at the top
const copyBanner = (reprint?: Reprint) => (reprint ? '<p class="center"><b>** COPY **</b></p>' : '');
// The balance after the payment or session: the receipt's total, or on a reprint a plain line dated to back then
// followed by the client's balance today as the total
const closingBalanceRows = (row: (label: string, value: string, cls?: string) => string, after: number | undefined, reprint?: Reprint) => {
  if (!reprint) return after !== undefined ? row('Balance after', balanceText(after), 'total') : '';
  // The date goes on a small line under the label, so it fits beside the amount on the 72 mm paper
  const dated = (label: string, ymd: string, value: string, cls = '') =>
    `<tr class="${cls}"><td>${label}<br><span class="tag">as of ${escapeHtml(shortDate(ymd))}</span></td><td class="r">${value}</td></tr>`;
  return `${after !== undefined ? dated('Balance then', reprint.asOf, balanceText(after)) : ''}
    ${dated('Balance today', ymdToday(), balanceText(reprint.currentBalance), 'total')}`;
};

// Prints a receipt for one attendance: what it was, its fee, its payment(s), the balance before and after, and the
// client's last and next polygraph
export const printAttendanceReceipt = (r: AttendanceReceipt, onError: (message: string) => void) => {
  const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="r">${value}</td></tr>`;
  const paid = r.payments.filter(p => p.amount > 0);
  // Each payment prints as "Paid (Cash)" or "Paid (CC)"
  const paymentRows = paid.map(p => row(`Paid${p.method ? ` (${p.method === 'Credit Card' ? 'CC' : p.method})` : ''}`, `+${money(p.amount)}`)).join('');
  const totalPaid = paid.reduce((t, p) => t + p.amount, 0);
  // Payments already in the balance are added back (stored sign: positive = owes), so the lines add up
  const applied = paid.filter(p => p.alreadyApplied).reduce((t, p) => t + p.amount, 0);
  const balanceBefore = r.balanceBefore === undefined ? undefined : r.balanceBefore + applied;
  const counselor = r.provider?.trim() ? counselorWithCredentials(r.provider.trim()) : Promise.resolve('');
  printReceiptPage('Attendance Receipt', Promise.all([polygraphSection(r.clientId), counselor]).then(([poly, counselorName]) => `
    ${copyBanner(r.reprint)}
    ${clientLine(r.clientName, r.docNumber)}
    <p><b>${escapeHtml(r.sessionKind)}:</b> ${escapeHtml(r.sessionName)}</p>
    ${counselorName ? `<p><b>Counselor:</b> ${escapeHtml(counselorName)}</p>` : ''}
    <p><b>Date attended:</b> ${escapeHtml(shortDate(r.sessionDate))}</p>
    <hr>
    <table>
      ${balanceBefore !== undefined ? row('Balance before', balanceText(balanceBefore)) : ''}
      ${row(`${r.sessionKind} fee`, r.fee > 0 ? `-${money(r.fee)}` : money(r.fee))}
      ${paymentRows || row('Payment', 'None')}
      ${paid.length > 1 ? row('Total paid', `+${money(totalPaid)}`) : ''}
      ${closingBalanceRows(row, r.balanceAfter, r.reprint)}
    </table>
    ${poly}
  `), onError);
};

// A payment receipt (account payments, card payments, payments at check-in)
// newBalance may be left out when reprinting an old ledger row that has no balance saved with it
export const printReceipt = (r: Omit<Receipt, 'newBalance'> & { newBalance?: number }, onError: (message: string) => void) => {
  const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="r">${value}</td></tr>`;
  const balanceBefore = r.balanceBefore ?? (r.newBalance === undefined ? undefined
    : Math.round((r.newBalance + r.amount - (r.polyApplied ?? 0)) * 100) / 100);
  printReceiptPage('Payment Receipt', `
    ${copyBanner(r.reprint)}
    ${clientLine(r.clientName, r.docNumber)}
    <table>
      ${row('Paid on', escapeHtml(r.date))}
    </table>
    <hr>
    <table>
      ${row('Payment method', escapeHtml(r.method))}
      ${r.appliedTo ? row('Applied to', escapeHtml(r.appliedTo)) : ''}
      ${balanceBefore !== undefined ? row('Balance before', balanceText(balanceBefore)) : ''}
      ${row('Amount paid', `+${money(r.amount)}`)}
      ${r.polyApplied ? `${row('To poly fee', money(r.polyApplied))}${row('To account', money(r.amount - r.polyApplied))}
        ${row('Poly fee paid', `${money(r.polyFeePaid ?? 0)} / ${money(r.polyFee ?? 0)}`)}` : ''}
      ${closingBalanceRows(row, r.newBalance, r.reprint)}
    </table>
    ${r.notes?.trim() ? `<p class="small">Notes: ${escapeHtml(r.notes.trim())}</p>` : ''}
  `, onError, r.transactionIds);
};
