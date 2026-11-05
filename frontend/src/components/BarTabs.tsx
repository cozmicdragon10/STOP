import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';

export interface NavItem {
  tab: string;
  label: string;
  // Fits the bar on a narrow phone; the full label is the button's tooltip and is used in the phone menu
  shortLabel?: string;
  icon: ComponentType<{ size?: number }>;
}

interface Props {
  items: NavItem[];
  activeTab: string;
  onSelect: (tab: string) => void;
  // Added to the scrolling row, e.g. to show or hide its scrollbar
  className?: string;
}

// The row of icon tabs in a tab bar. On phones it swipes sideways; from md up every tab fits across the bar.
export default function BarTabs({ items, activeTab, onSelect, className = '' }: Props) {
  const row = useRef<HTMLDivElement>(null);

  // Keeps the open tab in view, including when it was opened from somewhere other than this bar
  useEffect(() => {
    const scroller = row.current;
    const current = scroller?.querySelector<HTMLElement>('[aria-current="page"]');
    if (scroller && current) {
      scroller.scrollTo({ left: current.offsetLeft - (scroller.clientWidth - current.offsetWidth) / 2, behavior: 'smooth' });
    }
  }, [activeTab]);

  return (
    // On phones buttons are a fixed width so the last one showing is cut off, which shows the bar swipes
    <div ref={row} className={`relative flex-1 min-w-0 flex overflow-x-auto ${className}`}>
      {items.map(item => (
        <button
          key={item.tab}
          type="button"
          onClick={() => onSelect(item.tab)}
          aria-current={activeTab === item.tab ? 'page' : undefined}
          title={item.label}
          className={`shrink-0 w-[4.75rem] md:w-auto md:flex-1 md:min-w-0 flex flex-col items-center gap-1 py-2 text-[0.6875rem] md:text-[0.625rem] lg:text-xs font-medium transition ${activeTab === item.tab ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'}`}
        >
          <item.icon size={20} />
          <span className="truncate max-w-full px-1 md:px-0">{item.shortLabel ?? item.label}</span>
        </button>
      ))}
    </div>
  );
}
