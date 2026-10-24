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

// Opens a small receipt window and prints it. Pop-ups must be allowed for this site.
export const printReceipt = (r: Receipt, onError: (message: string) => void) => {
  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) {
    onError('Allow pop-ups for this site to print receipts.');
    return;
  }
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
