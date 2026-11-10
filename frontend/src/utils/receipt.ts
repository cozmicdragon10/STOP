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
  printedBy: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const longDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) : ymd;
};

const openPrintWindow = (onError: (message: string) => void) => {
  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) onError('Allow pop-ups for this site to print receipts.');
  return win;
};

const RECEIPT_STYLE = `<style>body{font-family:Arial,sans-serif;color:#000;padding:24px;font-size:14px}h2{margin:0 0 4px}
    table{width:100%;border-collapse:collapse;margin-top:12px}td{padding:6px 0;border-bottom:1px solid #ddd}
    td.r{text-align:right}.muted{color:#555;font-size:12px}tr.total td{border-top:2px solid #000;border-bottom:none}</style>`;

// Prints a receipt for one attendance: what it was, its fee, its payment(s), and the balance before and after
export const printAttendanceReceipt = (r: AttendanceReceipt, onError: (message: string) => void) => {
  const win = openPrintWindow(onError);
  if (!win) return;
  const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="r">${value}</td></tr>`;
  const paymentRows = r.payments.filter(p => p.amount > 0).map(p => row(
    `${p.label}${p.method ? ` (${p.method})` : ''}${p.alreadyApplied ? ' *' : ''}`, money(p.amount),
  )).join('');
  const anyApplied = r.payments.some(p => p.amount > 0 && p.alreadyApplied);
  const totalPaid = r.payments.reduce((t, p) => t + (p.amount > 0 ? p.amount : 0), 0);
  win.document.write(`<!doctype html><html><head><title>Attendance Receipt</title>${RECEIPT_STYLE}</head><body>
    <h2>Attendance Receipt</h2><p class="muted">Chandler &amp; Associates · Printed ${escapeHtml(new Date().toLocaleString())}</p>
    <table>
      ${row('Client', `<b>${escapeHtml(r.clientName)}</b>`)}
      ${r.docNumber ? row('DOC #', escapeHtml(r.docNumber)) : ''}
      ${row(r.sessionKind === 'Group' ? 'Group' : r.sessionKind, escapeHtml(r.sessionName))}
      ${row('Date attended', escapeHtml(longDate(r.sessionDate)))}
      ${r.provider ? row(r.sessionKind === 'Group' ? 'Counselor' : 'Counselor / Therapist', escapeHtml(r.provider)) : ''}
    </table>
    <table>
      ${r.balanceBefore !== undefined ? row('Balance before', escapeHtml(formatBalance(r.balanceBefore))) : ''}
      ${row(`${r.sessionKind} fee`, `<b>${money(r.fee)}</b>`)}
      ${paymentRows || row('Payment', 'No payment')}
      ${r.payments.filter(p => p.amount > 0).length > 1 ? row('Total paid', `<b>${money(totalPaid)}</b>`) : ''}
      ${r.balanceAfter !== undefined ? row(r.pending ? 'Balance after this session' : 'Balance after', `<b>${escapeHtml(formatBalance(r.balanceAfter))}</b>`, 'total') : ''}
    </table>
    ${anyApplied ? '<p class="muted">* Paid before this attendance was recorded; already included in the balance before.</p>' : ''}
    ${r.pending ? `<p class="muted">This session has not been closed yet. The fee and ${anyApplied ? 'any payment not marked *' : 'the payment'} are recorded when it closes.</p>` : ''}
    <p class="muted">Printed by ${escapeHtml(r.printedBy)}</p>
    <p class="muted" style="text-align:center;margin-top:16px">Thank you.</p>
    </body></html>`);
  win.document.close();
  win.focus();
  win.print();
};

// Opens a small receipt window and prints it. Pop-ups must be allowed for this site.
export const printReceipt = (r: Receipt, onError: (message: string) => void) => {
  const win = openPrintWindow(onError);
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>Payment Receipt</title>
    <style>body{font-family:Arial,sans-serif;color:#000;padding:24px;font-size:14px}h2{margin:0 0 4px}
    table{width:100%;border-collapse:collapse;margin-top:12px}td{padding:6px 0;border-bottom:1px solid #ddd}
    td.r{text-align:right}.muted{color:#555;font-size:12px}</style></head><body>
    <h2>Payment Receipt</h2><p class="muted">${escapeHtml(r.date)}</p>
    <table>
      <tr><td>Client</td><td class="r"><b>${escapeHtml(r.clientName)}</b></td></tr>
      ${r.docNumber ? `<tr><td>DOC #</td><td class="r">${escapeHtml(r.docNumber)}</td></tr>` : ''}
      <tr><td>Payment method</td><td class="r">${escapeHtml(r.method)}</td></tr>
      <tr><td>Amount paid</td><td class="r"><b>$${r.amount.toFixed(2)}</b></td></tr>
      ${r.polyApplied ? `<tr><td>Applied to poly fee</td><td class="r">$${r.polyApplied.toFixed(2)}</td></tr>
      <tr><td>Applied to account</td><td class="r">$${(r.amount - r.polyApplied).toFixed(2)}</td></tr>
      <tr><td>Poly fee paid</td><td class="r">$${(r.polyFeePaid ?? 0).toFixed(2)} / $${(r.polyFee ?? 0).toFixed(2)}</td></tr>` : ''}
      <tr><td>Balance after payment</td><td class="r">${escapeHtml(formatBalance(r.newBalance))}</td></tr>
    </table>
    <p class="muted">Processed by ${escapeHtml(r.processedBy)}</p>
    <p class="muted" style="text-align:center;margin-top:16px">Thank you.</p>
    </body></html>`);
  win.document.close();
  win.focus();
  win.print();
};
