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
  processedBy: string;
  date: string;
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
}

const money = (n: number) => `$${n.toFixed(2)}`;
const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) : ymd;
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
    hr{border:0;border-top:1px dashed #000;margin:2mm 0}
    table{width:100%;border-collapse:collapse}
    td{padding:.6mm 0;vertical-align:top}
    td.r{text-align:right;padding-left:2mm;white-space:nowrap}
    tr.total td{border-top:2px solid #000;padding-top:1.2mm;font-weight:bold;font-size:12pt}
    p{margin:1.5mm 0}
  </style>`;

const receiptHeader = (title: string) => `<div class="center"><div class="biz">Chandler &amp; Associates</div><h2>${title}</h2>
    <div class="small">${escapeHtml(new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))}</div></div><hr>`;
// The client's name with their DOC number to the right, e.g. "Sanchez, Jason      #581422"
const clientLine = (name: string, docNumber: string) =>
  `<table><tr><td><b>${escapeHtml(name)}</b></td><td class="r"><b>${docNumber ? `#${escapeHtml(docNumber)}` : ''}</b></td></tr></table>`;
const RECEIPT_FOOTER ='<hr><p class="center">Thank you.</p>';

// Writes the receipt into a small window sized like the paper and opens the print dialog. The window is opened right
// away (while still handling the click, so pop-up blockers allow it); a body still loading is filled in when ready.
// Pop-ups must be allowed for this site.
const printReceiptPage = (title: string, body: string | Promise<string>, onError: (message: string) => void) => {
  const win = window.open('', '_blank', 'width=360,height=640');
  if (!win) {
    onError('Allow pop-ups for this site to print receipts.');
    return;
  }
  const write = (html: string) => {
    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${RECEIPT_STYLE}</head><body>${receiptHeader(title)}${html}${RECEIPT_FOOTER}</body></html>`);
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
    const next = p.next
      ? `<p><span class="small">Next polygraph</span><br><b>${escapeHtml(longDate(p.next.date))}${p.next.time ? ` at ${escapeHtml(formatDisplayTime(p.next.time))}` : ''}</b>${
        p.next.location ? `<br>${escapeHtml(p.next.location)}` : ''}</p>`
      : '<table><tr><td>Next polygraph</td><td class="r">Not scheduled</td></tr></table>';
    const last = p.lastTaken && p.lastTaken <= ymdToday() ? escapeHtml(longDate(p.lastTaken)) : 'None yet';
    return `<hr><table><tr><td>Last polygraph</td><td class="r">${last}</td></tr></table>${next}`;
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

// Prints a receipt for one attendance: what it was, its fee, its payment(s), the balance before and after, and the
// client's last and next polygraph
export const printAttendanceReceipt = (r: AttendanceReceipt, onError: (message: string) => void) => {
  const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="r">${value}</td></tr>`;
  const paid = r.payments.filter(p => p.amount > 0);
  const paymentRows = paid.map(p => row(`${p.label}${p.method ? ` (${p.method})` : ''}`, money(p.amount))).join('');
  const totalPaid = paid.reduce((t, p) => t + p.amount, 0);
  // Payments already in the balance are added back (stored sign: positive = owes), so the lines add up
  const applied = paid.filter(p => p.alreadyApplied).reduce((t, p) => t + p.amount, 0);
  const balanceBefore = r.balanceBefore === undefined ? undefined : r.balanceBefore + applied;
  const counselor = r.provider?.trim() ? counselorWithCredentials(r.provider.trim()) : Promise.resolve('');
  printReceiptPage('Attendance Receipt', Promise.all([polygraphSection(r.clientId), counselor]).then(([poly, counselorName]) => `
    ${clientLine(r.clientName, r.docNumber)}
    <p><b>${escapeHtml(r.sessionKind)}:</b> ${escapeHtml(r.sessionName)}</p>
    <table>
      ${row('Date attended', escapeHtml(longDate(r.sessionDate)))}
    </table>
    ${counselorName ? `<p><b>Counselor:</b> ${escapeHtml(counselorName)}</p>` : ''}
    <hr>
    <table>
      ${balanceBefore !== undefined ? row('Balance before', escapeHtml(formatBalance(balanceBefore))) : ''}
      ${row(`${r.sessionKind} fee`, money(r.fee))}
      ${paymentRows || row('Payment', 'None')}
      ${paid.length > 1 ? row('Total paid', money(totalPaid)) : ''}
      ${r.balanceAfter !== undefined ? row('Balance after', escapeHtml(formatBalance(r.balanceAfter)), 'total') : ''}
    </table>
    ${poly}
  `), onError);
};

// A payment receipt (account payments, card payments, payments at check-in)
export const printReceipt = (r: Receipt, onError: (message: string) => void) => {
  const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="r">${value}</td></tr>`;
  printReceiptPage('Payment Receipt', `
    ${clientLine(r.clientName, r.docNumber)}
    <table>
      ${row('Paid on', escapeHtml(r.date))}
    </table>
    <hr>
    <table>
      ${row('Payment method', escapeHtml(r.method))}
      ${row('Amount paid', money(r.amount))}
      ${r.polyApplied ? `${row('To poly fee', money(r.polyApplied))}${row('To account', money(r.amount - r.polyApplied))}
        ${row('Poly fee paid', `${money(r.polyFeePaid ?? 0)} / ${money(r.polyFee ?? 0)}`)}` : ''}
      ${row('Balance after', escapeHtml(formatBalance(r.newBalance)), 'total')}
    </table>
    ${r.notes?.trim() ? `<p class="small">Notes: ${escapeHtml(r.notes.trim())}</p>` : ''}
  `, onError);
};
