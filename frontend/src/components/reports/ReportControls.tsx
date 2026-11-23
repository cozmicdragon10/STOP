import { useState } from 'react';
import type { ReactNode } from 'react';
import { Download, Printer } from 'lucide-react';
import { todayLocal } from '../../hooks/useGroupCheckIn';
import { downloadCsv, monthsAgo, printTables } from '../../utils/directorReports';
import type { ReportTable } from '../../utils/directorReports';
import { sortRows, valueFromText } from '../../utils/tableSort';
import type { SortValue } from '../../utils/tableSort';
import { useTableSort } from '../../hooks/useTableSort';
import SortableTh from '../SortableTh';

// Shared pieces of the director's reports: a date range with quick picks, and Print / CSV buttons.

export const fieldClass = 'block mt-1 h-9 bg-slate-950 border border-slate-700 rounded px-2 text-white text-xs';
export const buttonClass = 'h-9 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-slate-200 px-3 rounded text-xs font-semibold';
export const th = 'py-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 whitespace-nowrap';
export const td = 'py-2 px-3';
export const num = 'text-right tabular-nums';

const presets = () => {
  const today = todayLocal();
  const y = Number(today.slice(0, 4));
  return [
    { label: 'Last 12 Months', from: monthsAgo(11), to: today },
    { label: 'This Year', from: `${y}-01-01`, to: today },
    { label: 'Last Year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
};

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <>
      <label className="text-xs text-slate-400">From
        <input type="date" value={from} max={to} onChange={(e) => onChange(e.target.value, to)} className={fieldClass} />
      </label>
      <label className="text-xs text-slate-400">To
        <input type="date" value={to} min={from} onChange={(e) => onChange(from, e.target.value)} className={fieldClass} />
      </label>
      {presets().map(p => (
        <button key={p.label} type="button" className={buttonClass} onClick={() => onChange(p.from, p.to)}>{p.label}</button>
      ))}
    </>
  );
}

// Print and CSV for the report's tables; tables() is only built when a button is clicked
export function ExportButtons({ title, subtitle, fileName, disabled, tables }: {
  title: string; subtitle: string; fileName: string; disabled: boolean; tables: () => ReportTable[];
}) {
  const [error, setError] = useState('');
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button type="button" disabled={disabled} className={`${buttonClass} flex items-center gap-1.5`}
          onClick={() => setError(printTables(title, subtitle, tables()) ? '' : 'Allow pop-ups for this site to print the report.')}>
          <Printer size={14} /> Print
        </button>
        <button type="button" disabled={disabled} title="Download for Excel" className={`${buttonClass} flex items-center gap-1.5`}
          onClick={() => downloadCsv(`${fileName}.csv`, title, subtitle, tables())}>
          <Download size={14} /> CSV
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function StatCards({ cards }: { cards: { label: string; value: string; tone?: string; note?: string }[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-center">
      {cards.map(card => (
        <div key={card.label} className="bg-slate-950 p-4 rounded-xl border border-slate-800">
          <p className="text-xs text-slate-400">{card.label}</p>
          <p className={`text-xl font-bold mt-1 ${card.tone ?? 'text-white'}`}>{card.value}</p>
          {card.note && <p className="text-xs mt-1 text-slate-500">{card.note}</p>}
        </div>
      ))}
    </div>
  );
}

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
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

// A plain table: the first column is a label, the rest line up on the right. Click a header to sort by that column.
// Text and number cells sort by what they show ("$1,234.00" as an amount); values gives the sort value of any other
// cell (an entry left undefined falls back to the cell).
export function SimpleTable({ head, rows, values, foot, empty = 'Nothing to show.' }: {
  head: string[]; rows: ReactNode[][]; values?: SortValue[][]; foot?: ReactNode[]; empty?: string;
}) {
  const table = useTableSort<string>();
  const valueOf = (ri: number, col: string) => {
    const i = Number(col);
    const given = values?.[ri]?.[i];
    if (given !== undefined) return given;
    const cell = rows[ri][i];
    return typeof cell === 'string' || typeof cell === 'number' ? valueFromText(cell) : null;
  };
  const order = sortRows(rows.map((_, ri) => ri), table.sort, valueOf);
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left border-b border-slate-800">{head.map((h, i) => (
        <SortableTh key={i} k={String(i)} table={table} className={`${th} ${i > 0 ? num : ''}`}>{h}</SortableTh>
      ))}</tr></thead>
      <tbody className="divide-y divide-slate-800/60 text-slate-200">
        {rows.length === 0 && <tr><td colSpan={head.length} className={`${td} text-slate-500`}>{empty}</td></tr>}
        {order.map(ri => <tr key={ri}>{rows[ri].map((v, i) => <td key={i} className={`${td} ${i > 0 ? num : ''}`}>{v}</td>)}</tr>)}
      </tbody>
      {foot && <tfoot><tr className="border-t border-slate-700 font-semibold text-white">{foot.map((v, i) => <td key={i} className={`${td} ${i > 0 ? num : ''}`}>{v}</td>)}</tr></tfoot>}
    </table>
  );
}
