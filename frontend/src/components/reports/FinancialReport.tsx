import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, Printer } from 'lucide-react';
import { getFinancialSummary } from '../../api';
import type { FinancialSummaryData } from '../../api';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { escapeHtml } from '../../utils/receipt';
import { errorMessage } from '../../utils/errors';
import { financialCsv, OLD_SYSTEM_LABEL, summarizeFinancials } from '../../utils/financialReport';
import type { AmountLine, FinancialSummary } from '../../utils/financialReport';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (month: string) =>
  new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).toLocaleDateString([], { month: 'short', year: 'numeric' });
const formatDate = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString();
const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (y: number, m: number) => new Date(y, m, 0).getDate();

// Quick date ranges, from today
const presets = (): { label: string; from: string; to: string }[] => {
  const today = todayLocal();
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const [ly, lm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return [
    { label: 'This Month', from: `${today.slice(0, 8)}01`, to: today },
    { label: 'Last Month', from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${lastDayOf(ly, lm)}` },
    { label: 'This Year', from: `${y}-01-01`, to: today },
    { label: 'Last Year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
};

const th = 'py-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400';
const td = 'py-2 px-3';
const r = 'text-right tabular-nums';

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h4 className="font-semibold text-white text-sm">{title}</h4>
        {note && <p className="text-xs text-slate-400 mt-0.5">{note}</p>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function AmountTable({ lines, total, empty, totalLabel = 'Total' }: { lines: AmountLine[]; total: number; empty: string; totalLabel?: string }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left border-b border-slate-800"><th className={th}>Item</th><th className={`${th} ${r}`}>Count</th><th className={`${th} ${r}`}>Amount</th></tr></thead>
      <tbody className="divide-y divide-slate-800/60 text-slate-200">
        {lines.length === 0 && <tr><td colSpan={3} className={`${td} text-slate-500`}>{empty}</td></tr>}
        {lines.map(l => (
          <tr key={l.label}><td className={td}>{l.label}</td><td className={`${td} ${r}`}>{l.count}</td><td className={`${td} ${r}`}>{money(l.amount)}</td></tr>
        ))}
      </tbody>
      <tfoot><tr className="border-t border-slate-700 font-semibold text-white"><td className={td}>{totalLabel}</td><td /><td className={`${td} ${r}`}>{money(total)}</td></tr></tfoot>
    </table>
  );
}

// Printable copy of the report, black on white
const printHtml = (s: FinancialSummary, range: string) => {
  const amountRows = (lines: AmountLine[], total: number) =>
    `${lines.map(l => `<tr><td>${escapeHtml(l.label)}</td><td class="r">${l.count}</td><td class="r">${money(l.amount)}</td></tr>`).join('')
    || '<tr><td colspan="3">None</td></tr>'}<tr class="tot"><td>Total</td><td></td><td class="r">${money(total)}</td></tr>`;
  return `<!doctype html><html><head><title>Financial Summary ${escapeHtml(range)}</title>
    <style>
      body{font-family:Arial,sans-serif;color:#000;padding:24px;font-size:12px}h1{font-size:18px;margin:0}.muted{color:#555;margin:2px 0}
      h2{font-size:14px;margin:18px 0 4px}table{width:100%;border-collapse:collapse}th,td{padding:4px 6px;text-align:left}
      th{border-bottom:2px solid #000;font-size:11px;text-transform:uppercase}td{border-bottom:1px solid #e3e3e3}.r{text-align:right}
      tr.tot td{border-top:1px solid #000;font-weight:bold}.summary{display:flex;gap:8px;margin:14px 0}
      .summary div{flex:1;border:1px solid #bbb;border-radius:4px;padding:8px;text-align:center}.summary b{display:block;font-size:15px;margin-top:2px}
      tr{page-break-inside:avoid}
    </style></head><body>
    <h1>Financial Summary</h1><p class="muted">${escapeHtml(range)}</p><p class="muted">Printed ${escapeHtml(new Date().toLocaleString())}</p>
    <div class="summary">
      <div>Net Collected<b>${money(s.netCollected)}</b></div><div>Charged to Accounts<b>${money(s.chargeTotal)}</b></div>
      <div>Credits &amp; Forgiven<b>${money(s.creditTotal)}</b></div><div>Cash Not Deposited<b>${money(s.cashTotals.held)}</b></div>
      <div>Owed by Clients Today<b>${money(s.balanceTotals.owed)}</b></div>
    </div>
    <h2>Money Collected</h2>
    <table><thead><tr><th>Fee Type</th><th class="r">Count</th><th class="r">Cash</th><th class="r">Credit Card</th><th class="r">Not Recorded</th><th class="r">Total</th></tr></thead><tbody>
    ${[...s.payments, s.paymentTotals].map((p, i, all) => `<tr${i === all.length - 1 ? ' class="tot"' : ''}><td>${escapeHtml(p.label)}</td><td class="r">${p.count || ''}</td>
      <td class="r">${money(p.cash)}</td><td class="r">${money(p.card)}</td><td class="r">${money(p.unrecorded)}</td><td class="r">${money(p.total)}</td></tr>`).join('')}
    <tr><td>Less refunds</td><td class="r">${s.refunds.count}</td><td></td><td></td><td></td><td class="r">${money(-s.refunds.amount)}</td></tr>
    <tr><td>Less chargebacks</td><td class="r">${s.disputes.count}</td><td></td><td></td><td></td><td class="r">${money(-s.disputes.amount)}</td></tr>
    <tr><td>Plus disputes won back</td><td class="r">${s.disputesWon.count}</td><td></td><td></td><td></td><td class="r">${money(s.disputesWon.amount)}</td></tr>
    <tr class="tot"><td>Net collected</td><td></td><td></td><td></td><td></td><td class="r">${money(s.netCollected)}</td></tr>
    </tbody></table>
    <h2>Charged to Client Accounts</h2><table><thead><tr><th>Item</th><th class="r">Count</th><th class="r">Amount</th></tr></thead><tbody>${amountRows(s.charges, s.chargeTotal)}</tbody></table>
    <h2>Credits and Debt Forgiven</h2><table><thead><tr><th>Item</th><th class="r">Count</th><th class="r">Amount</th></tr></thead><tbody>${amountRows(s.credits, s.creditTotal)}</tbody></table>
    ${s.funded.length ? `<h2>Billed to Funders</h2><table><thead><tr><th>Item</th><th class="r">Count</th><th class="r">Amount</th></tr></thead><tbody>${amountRows(s.funded, s.fundedTotal)}</tbody></table>` : ''}
    <h2>Cash Deposits</h2><table><thead><tr><th>Where Taken</th><th class="r">Cash Taken</th><th class="r">Deposited</th><th class="r">Not Deposited</th></tr></thead><tbody>
    ${[...s.cash, s.cashTotals].map((c, i, all) => `<tr${i === all.length - 1 ? ' class="tot"' : ''}><td>${escapeHtml(c.label)}</td><td class="r">${money(c.cash)}</td><td class="r">${money(c.deposited)}</td><td class="r">${money(c.held)}${c.heldCount ? ` (${c.heldCount})` : ''}</td></tr>`).join('')}
    </tbody></table>
    <h2>By Month</h2><table><thead><tr><th>Month</th><th class="r">Charged</th><th class="r">Credits</th><th class="r">Collected</th><th class="r">Refunds &amp; Disputes</th><th class="r">Net Collected</th></tr></thead><tbody>
    ${s.months.map(m => `<tr><td>${escapeHtml(monthLabel(m.month))}</td><td class="r">${money(m.charged)}</td><td class="r">${money(m.credits)}</td><td class="r">${money(m.collected)}</td><td class="r">${money(m.refunded)}</td><td class="r">${money(m.net)}</td></tr>`).join('')}
    </tbody></table>
    <h2>Client Balances Today</h2><table><thead><tr><th>Program Status</th><th class="r">Clients</th><th class="r">Owing</th><th class="r">Owed</th><th class="r">In Credit</th><th class="r">Credit</th></tr></thead><tbody>
    ${[...s.balances, s.balanceTotals].map((b, i, all) => `<tr${i === all.length - 1 ? ' class="tot"' : ''}><td>${escapeHtml(b.status)}</td><td class="r">${b.clients}</td><td class="r">${b.owing}</td><td class="r">${money(b.owed)}</td><td class="r">${b.inCredit}</td><td class="r">${money(b.credit)}</td></tr>`).join('')}
    </tbody></table></body></html>`;
};

// Business Administrators only (the server checks too): every money total for the company over a date range
export default function FinancialReport() {
  const [from, setFrom] = useState(() => `${todayLocal().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(todayLocal);
  const [data, setData] = useState<FinancialSummaryData | null>(null);
  // The range the data (or the error) was loaded for; an invalid range keeps showing the last one
  const [loaded, setLoaded] = useState<{ key: string; error: string } | null>(null);
  const [printError, setPrintError] = useState('');

  const rangeKey = from && to && from <= to ? `${from}|${to}` : null;
  useEffect(() => {
    if (!rangeKey) return;
    let cancelled = false;
    getFinancialSummary(from, to)
      .then(d => { if (!cancelled) { setData(d); setLoaded({ key: rangeKey, error: '' }); } })
      .catch(err => { if (!cancelled) setLoaded({ key: rangeKey, error: errorMessage(err, 'Failed to load the financial summary.') }); });
    return () => { cancelled = true; };
  }, [rangeKey, from, to]);
  const status = !loaded || (rangeKey && loaded.key !== rangeKey) ? 'loading' : loaded.error ? 'error' : 'ready';
  const [shownFrom, shownTo] = (loaded?.key ?? `${from}|${to}`).split('|');
  const s = useMemo(() => (data ? summarizeFinancials(data, shownFrom, shownTo) : null), [data, shownFrom, shownTo]);
  const range = shownFrom === shownTo ? formatDate(shownFrom) : `${formatDate(shownFrom)} – ${formatDate(shownTo)}`;

  const print = () => {
    if (!s) return;
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) { setPrintError('Allow pop-ups for this site to print the report.'); return; }
    setPrintError('');
    win.document.write(printHtml(s, range));
    win.document.close();
    win.focus();
    win.print();
  };

  const download = () => {
    if (!s) return;
    const url = URL.createObjectURL(new Blob([financialCsv(s, shownFrom, shownTo)], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `Financial Summary ${shownFrom} to ${shownTo}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const button = 'h-9 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 px-3 rounded text-xs font-semibold';
  const hasOldSystem = s?.payments.some(p => p.label === OLD_SYSTEM_LABEL);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div>
          <h3 className="font-semibold text-white">Financial Summary</h3>
          <p className="text-xs text-slate-400 mt-0.5">All money in and out for the company: payments, refunds, charges, credits, cash deposits, and what clients owe.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-400">From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs" />
          </label>
          <label className="text-xs text-slate-400">To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs" />
          </label>
          {presets().map(p => (
            <button key={p.label} type="button" className={button} onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</button>
          ))}
          <button type="button" onClick={print} disabled={status !== 'ready'} className={`${button} flex items-center gap-1.5`}><Printer size={14} /> Print</button>
          <button type="button" onClick={download} disabled={status !== 'ready'} title="Download for Excel" className={`${button} flex items-center gap-1.5`}><Download size={14} /> CSV</button>
        </div>
      </div>
      {printError && <p className="text-xs text-red-400">{printError}</p>}
      {status === 'error' && <p className="text-sm text-red-400">{loaded?.error}</p>}
      {status === 'loading' && !s && <p className="text-sm text-slate-400">Loading…</p>}

      {s && (
        <div className={`space-y-5 ${status === 'loading' ? 'opacity-60' : ''}`}>
          <p className="text-xs text-slate-400">{range}</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-center">
            {[
              { label: 'Net Collected', value: s.netCollected, tone: 'text-emerald-400', note: `${money(s.paymentTotals.total)} in, ${money(s.refunds.amount + s.disputes.amount - s.disputesWon.amount)} back out` },
              { label: 'Charged to Accounts', value: s.chargeTotal, tone: 'text-amber-400' },
              { label: 'Credits & Forgiven', value: s.creditTotal, tone: 'text-sky-400' },
              { label: 'Cash Not Deposited', value: s.cashTotals.held, tone: s.cashTotals.held > 0 ? 'text-red-400' : 'text-white', note: s.cashTotals.heldCount ? `${s.cashTotals.heldCount} session(s) or payment(s)` : 'All deposited' },
              { label: 'Owed by Clients Today', value: s.balanceTotals.owed, tone: 'text-white', note: `${s.balanceTotals.owing} client(s) owe` },
            ].map(card => (
              <div key={card.label} className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <p className="text-xs text-slate-400">{card.label}</p>
                <p className={`text-xl font-bold mt-1 ${card.tone}`}>{money(card.value)}</p>
                {card.note && <p className="text-xs mt-1 text-slate-500">{card.note}</p>}
              </div>
            ))}
          </div>

          <Section title="Money Collected" note={`Payments by fee type and method, less refunds and chargebacks.${hasOldSystem ? ' Old system check-ins are payments imported from the previous system, which did not record the method.' : ''}`}>
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-800">
                <th className={th}>Fee Type</th><th className={`${th} ${r}`}>Count</th><th className={`${th} ${r}`}>Cash</th>
                <th className={`${th} ${r}`}>Credit Card</th><th className={`${th} ${r}`}>Not Recorded</th><th className={`${th} ${r}`}>Total</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {s.payments.length === 0 && <tr><td colSpan={6} className={`${td} text-slate-500`}>No payments in this range.</td></tr>}
                {s.payments.map(p => (
                  <tr key={p.label}>
                    <td className={td}>{p.label}</td><td className={`${td} ${r}`}>{p.count || ''}</td><td className={`${td} ${r}`}>{money(p.cash)}</td>
                    <td className={`${td} ${r}`}>{money(p.card)}</td><td className={`${td} ${r}`}>{money(p.unrecorded)}</td><td className={`${td} ${r}`}>{money(p.total)}</td>
                  </tr>
                ))}
                <tr className="font-semibold text-white">
                  <td className={td}>Total payments</td><td className={`${td} ${r}`}>{s.paymentTotals.count}</td><td className={`${td} ${r}`}>{money(s.paymentTotals.cash)}</td>
                  <td className={`${td} ${r}`}>{money(s.paymentTotals.card)}</td><td className={`${td} ${r}`}>{money(s.paymentTotals.unrecorded)}</td><td className={`${td} ${r}`}>{money(s.paymentTotals.total)}</td>
                </tr>
                {[
                  { label: 'Less refunds', line: s.refunds, sign: -1 },
                  { label: 'Less chargebacks (disputes opened)', line: s.disputes, sign: -1 },
                  { label: 'Plus disputes won back', line: s.disputesWon, sign: 1 },
                ].map(x => (
                  <tr key={x.label} className="text-slate-300">
                    <td className={td}>{x.label}</td><td className={`${td} ${r}`}>{x.line.count}</td><td colSpan={3} /><td className={`${td} ${r}`}>{money(x.sign * x.line.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-slate-700 font-semibold text-emerald-400"><td className={td}>Net collected</td><td colSpan={4} /><td className={`${td} ${r}`}>{money(s.netCollected)}</td></tr></tfoot>
            </table>
          </Section>

          <div className="grid lg:grid-cols-2 gap-5">
            <Section title="Charged to Client Accounts" note="Session fees by check-in type, plus custom fees and polygraph copays.">
              <AmountTable lines={s.charges} total={s.chargeTotal} empty="Nothing charged in this range." />
            </Section>
            <Section title="Credits and Debt Forgiven" note="Lowered what clients owe without money coming in.">
              <AmountTable lines={s.credits} total={s.creditTotal} empty="No credits in this range." />
            </Section>
          </div>

          {s.funded.length > 0 && (
            <Section title="Billed to Funders" note="Assessments a DHS invoice or voucher covers; not charged to the client.">
              <AmountTable lines={s.funded} total={s.fundedTotal} empty="" />
            </Section>
          )}

          <Section title="Cash Deposits" note="Cash taken in this range and how much is checked off as dropped off at the bank.">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-800">
                <th className={th}>Where Taken</th><th className={`${th} ${r}`}>Cash Taken</th><th className={`${th} ${r}`}>Deposited</th><th className={`${th} ${r}`}>Not Deposited</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {[...s.cash, s.cashTotals].map((c, i) => (
                  <tr key={c.label} className={i === s.cash.length ? 'font-semibold text-white border-t border-slate-700' : ''}>
                    <td className={td}>{c.label}</td><td className={`${td} ${r}`}>{money(c.cash)}</td><td className={`${td} ${r}`}>{money(c.deposited)}</td>
                    <td className={`${td} ${r} ${c.held > 0 ? 'text-red-400' : ''}`}>{money(c.held)}{c.heldCount ? ` (${c.heldCount})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="By Month">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-800">
                <th className={th}>Month</th><th className={`${th} ${r}`}>Charged</th><th className={`${th} ${r}`}>Credits</th>
                <th className={`${th} ${r}`}>Collected</th><th className={`${th} ${r}`}>Refunds &amp; Disputes</th><th className={`${th} ${r}`}>Net Collected</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {s.months.map(m => (
                  <tr key={m.month}>
                    <td className={td}>{monthLabel(m.month)}</td><td className={`${td} ${r}`}>{money(m.charged)}</td><td className={`${td} ${r}`}>{money(m.credits)}</td>
                    <td className={`${td} ${r}`}>{money(m.collected)}</td><td className={`${td} ${r}`}>{money(m.refunded)}</td><td className={`${td} ${r} font-semibold`}>{money(m.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-slate-700 font-semibold text-white">
                <td className={td}>Total</td><td className={`${td} ${r}`}>{money(s.chargeTotal)}</td><td className={`${td} ${r}`}>{money(s.creditTotal)}</td>
                <td className={`${td} ${r}`}>{money(s.paymentTotals.total)}</td><td className={`${td} ${r}`}>{money(s.refunds.amount + s.disputes.amount - s.disputesWon.amount)}</td>
                <td className={`${td} ${r}`}>{money(s.netCollected)}</td>
              </tr></tfoot>
            </table>
          </Section>

          <Section title="Client Balances Today" note="What every client owes (or has in credit) right now, by program status. Not limited to the dates above.">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-slate-800">
                <th className={th}>Program Status</th><th className={`${th} ${r}`}>Clients</th><th className={`${th} ${r}`}>Owing</th>
                <th className={`${th} ${r}`}>Owed</th><th className={`${th} ${r}`}>In Credit</th><th className={`${th} ${r}`}>Credit</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-200">
                {s.balances.map(b => (
                  <tr key={b.status}>
                    <td className={td}>{b.status}</td><td className={`${td} ${r}`}>{b.clients}</td><td className={`${td} ${r}`}>{b.owing}</td>
                    <td className={`${td} ${r}`}>{money(b.owed)}</td><td className={`${td} ${r}`}>{b.inCredit}</td><td className={`${td} ${r}`}>{money(b.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-slate-700 font-semibold text-white">
                <td className={td}>All clients</td><td className={`${td} ${r}`}>{s.balanceTotals.clients}</td><td className={`${td} ${r}`}>{s.balanceTotals.owing}</td>
                <td className={`${td} ${r}`}>{money(s.balanceTotals.owed)}</td><td className={`${td} ${r}`}>{s.balanceTotals.inCredit}</td><td className={`${td} ${r}`}>{money(s.balanceTotals.credit)}</td>
              </tr></tfoot>
            </table>
          </Section>
        </div>
      )}
    </div>
  );
}
