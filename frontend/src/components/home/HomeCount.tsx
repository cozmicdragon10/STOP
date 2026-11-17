interface Props {
  label: string;
  value: number;
  detail?: string;
  // Amber when the number needs attention
  warn?: boolean;
  // Opens the list behind the number; without it the card is not clickable
  onClick?: () => void;
  title?: string;
}

// One count card on the Home page
export default function HomeCount({ label, value, detail, warn = false, onClick, title }: Props) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
      <p className={`text-3xl font-bold mt-2 ${warn ? 'text-amber-400' : 'text-white'}`}>{value}</p>
      {detail && <p className="text-xs text-slate-500 mt-1">{detail}</p>}
    </>
  );
  if (!onClick) return <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="text-left bg-slate-900 hover:bg-slate-800/70 border border-slate-800 hover:border-slate-700 rounded-xl p-5 transition"
    >
      {body}
    </button>
  );
}
