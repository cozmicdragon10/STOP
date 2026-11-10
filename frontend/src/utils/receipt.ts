import type { PaymentMethod } from '../hooks/useGroupCheckIn';
import { formatBalance } from './balance';

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
  // Payments for this session. alreadyApplied: paid before the attendance was recorded (e.g. when an individual
  // session was opened, or a card at check-in), so it is part of the balance before rather than taken off it here.
  payments: { label: string; amount: number; method?: string | null; alreadyApplied?: boolean }[];
  balanceBefore?: number;
  balanceAfter?: number;
  // Not recorded yet: the group or session is still open, so the fee and payment are what closing will record
  pending?: boolean;
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
    body{width:72mm;padding:2mm 3mm 6mm;font-family:Arial,Helvetica,sans-serif;color:#000;font-size:11pt;line-height:1.25;
      -webkit-print-color-adjust:exact;print-color-adjust:exact}
    .center{text-align:center}
    .biz{font-size:13pt;font-weight:bold}
    h2{font-size:12pt;margin:1mm 0 0;text-transform:uppercase;letter-spacing:.5px}
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
const RECEIPT_FOOTER = '<hr><p class="center">Thank you.</p>';

// Writes the receipt into a small window sized like the paper and opens the print dialog.
// Pop-ups must be allowed for this site.
const printReceiptPage = (title: string, body: string, onError: (message: string) => void) => {
  const win = window.open('', '_blank', 'width=360,height=640');
  if (!win) {
    onError('Allow pop-ups for this site to print receipts.');
    return;
  }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${RECEIPT_STYLE}</head><body>${receiptHeader(title)}${body}${RECEIPT_FOOTER}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
};

// Prints a receipt for one attendance: what it was, its fee, its payment(s), and the balance before and after
export const printAttendanceReceipt = (r: AttendanceReceipt, onError: (message: string) => void) => {
  const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="r">${value}</td></tr>`;
  const paymentRows = r.payments.filter(p => p.amount > 0).map(p => row(
    `${p.label}${p.method ? ` (${p.method})` : ''}${p.alreadyApplied ? ' *' : ''}`, money(p.amount),
  )).join('');
  const anyApplied = r.payments.some(p => p.amount > 0 && p.alreadyApplied);
  const totalPaid = r.payments.reduce((t, p) => t + (p.amount > 0 ? p.amount : 0), 0);
  // Long names and group names get their own line so the amounts column stays readable on narrow paper
  const block = (label: string, value: string) => `<p><span class="small">${escapeHtml(label)}</span><br><b>${value}</b></p>`;
  printReceiptPage('Attendance Receipt', `
    ${block('Client', escapeHtml(r.clientName))}
    ${r.docNumber ? `<table>${row('DOC #', escapeHtml(r.docNumber))}</table>` : ''}
    ${block(r.sessionKind === 'Group' ? 'Group' : r.sessionKind, escapeHtml(r.sessionName))}
    <table>
      ${row('Date attended', escapeHtml(longDate(r.sessionDate)))}
      ${r.provider ? row('Counselor', escapeHtml(r.provider)) : ''}
    </table>
    <hr>
    <table>
      ${r.balanceBefore !== undefined ? row('Balance before', escapeHtml(formatBalance(r.balanceBefore))) : ''}
      ${row(`${r.sessionKind} fee`, money(r.fee))}
      ${paymentRows || row('Payment', 'None')}
      ${r.payments.filter(p => p.amount > 0).length > 1 ? row('Total paid', money(totalPaid)) : ''}
      ${r.balanceAfter !== undefined ? row('Balance after', escapeHtml(formatBalance(r.balanceAfter)), 'total') : ''}
    </table>
    ${anyApplied ? '<p class="small">* Paid earlier; already included in the balance before.</p>' : ''}
    ${r.pending ? `<p class="small">Session not closed yet. The fee and ${anyApplied ? 'any payment not marked *' : 'the payment'} are recorded when it closes.</p>` : ''}
  `, onError);
};

// A payment receipt (account payments, card payments, payments at check-in)
export const printReceipt = (r: Receipt, onError: (message: string) => void) => {
  const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="r">${value}</td></tr>`;
  printReceiptPage('Payment Receipt', `
    <p><span class="small">Client</span><br><b>${escapeHtml(r.clientName)}</b></p>
    <table>
      ${r.docNumber ? row('DOC #', escapeHtml(r.docNumber)) : ''}
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
