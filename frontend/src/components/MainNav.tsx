import { useEffect, useRef, useState } from 'react';
import { Lock, LogOut, Menu, MoreHorizontal, X } from 'lucide-react';
import BarTabs from './BarTabs';
import type { NavItem } from './BarTabs';
import ScrollLock from './ScrollLock';

interface Props {
  // Every section the user can open, in order
  items: NavItem[];
  activeTab: string;
  onSelect: (tab: string) => void;
  user: { displayname: string; role: string };
  onLogout: () => void;
}

// The app's navigation at every screen size: a bar with every section (some roles have a few under a More menu instead), pinned to the bottom of the screen or, with the Layout
// setting, the top. On phones it swipes sideways, and a Menu sheet lists them all at once with the account and Log Out. From
// md up there may be no touch screen to swipe, so every section fits across the bar, and the account is in the header.
export default function MainNav({ items, activeTab, onSelect, user, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  // The Menu sheet is phone-only (md:hidden): widening the window closes it, so its scroll lock doesn't outlive it
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia('(min-width: 48rem)');
    const close = () => { if (wide.matches) setOpen(false); };
    close();
    wide.addEventListener('change', close);
    return () => wide.removeEventListener('change', close);
  }, [open]);

  // From md up, the More menu: a dropdown of the tabs marked `more`, which stay off the bar
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  const barItems = items.filter(item => !item.more);
  const moreItems = items.filter(item => item.more);
  const activeMoreItem = moreItems.find(item => item.tab === activeTab);

  const select = (tab: string) => {
    setOpen(false);
    setMoreOpen(false);
    onSelect(tab);
  };

  return (
    <>
      {/* data-zone="banner": the tab bar and the phone Menu follow the Banner & Tabs theme setting */}
      <nav aria-label="Main" data-zone="banner" className="fixed bottom-0 inset-x-0 tabs-top:sticky tabs-top:top-0 tabs-top:bottom-auto z-40 bg-slate-900 border-t tabs-top:border-t-0 tabs-top:border-b border-slate-800 flex">
        <BarTabs items={barItems} activeTab={activeTab} onSelect={select} className="[scrollbar-width:none]" />
        {/* Phones use the Menu sheet, which lists every section, so More is md and up */}
        {moreItems.length > 0 && (
          <div ref={moreRef} className="hidden md:flex relative shrink-0">
            <button
              type="button"
              onClick={() => setMoreOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              title={activeMoreItem ? `More (${activeMoreItem.label})` : 'More'}
              className={`w-20 flex flex-col items-center gap-1 py-2 text-[0.625rem] lg:text-xs font-medium transition border-l border-slate-800 ${activeMoreItem || moreOpen ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <MoreHorizontal size={20} />
              <span>More</span>
            </button>
            {moreOpen && (
              // Opens upward from a bar at the bottom, downward from a bar at the top
              <div role="menu" aria-label="More sections" className="absolute right-0 bottom-full mb-1 tabs-top:bottom-auto tabs-top:mb-0 tabs-top:top-full tabs-top:mt-1 min-w-52 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-1">
                {moreItems.map(item => (
                  <button
                    key={item.tab}
                    type="button"
                    role="menuitem"
                    onClick={() => select(item.tab)}
                    aria-current={activeTab === item.tab ? 'page' : undefined}
                    title={item.locked ? `${item.label} (locked while privacy view is on)` : undefined}
                    className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm font-medium ${activeTab === item.tab ? 'bg-blue-500/10 text-blue-400' : 'text-slate-200 hover:bg-slate-800'} ${item.locked ? 'opacity-60' : ''}`}
                  >
                    <item.icon size={18} />
                    <span className="min-w-0">{item.label}</span>
                    {item.locked && <Lock size={14} aria-label="Locked while privacy view is on" className="ml-auto shrink-0 text-amber-300" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="md:hidden shrink-0 w-16 flex flex-col items-center gap-1 py-2 text-[0.6875rem] font-medium text-slate-400 border-l border-slate-800"
        >
          <Menu size={20} />
          <span>Menu</span>
        </button>
      </nav>

      {open && (
        <div className="md:hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end" onClick={() => setOpen(false)}>
          <ScrollLock />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            data-zone="banner"
            onClick={e => e.stopPropagation()}
            className="w-full max-h-[85dvh] overflow-y-auto bg-slate-900 border-t border-slate-800 rounded-t-2xl p-4 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{user.displayname}</p>
                <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20 font-semibold">{user.role}</span>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="shrink-0 bg-slate-800 text-slate-400 p-2 rounded-lg"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {items.map(item => (
                <button
                  key={item.tab}
                  type="button"
                  onClick={() => select(item.tab)}
                  aria-current={activeTab === item.tab ? 'page' : undefined}
                  className={`flex items-center gap-2 text-left px-3 py-3 rounded-lg border text-sm font-medium ${activeTab === item.tab ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-slate-950 border-slate-800 text-slate-200'}`}
                >
                  <item.icon size={18} />
                  <span className="min-w-0">{item.label}</span>
                  {item.locked && <Lock size={14} aria-label="Locked while privacy view is on" className="ml-auto shrink-0 text-amber-300" />}
                </button>
              ))}
            </div>
            <button type="button" onClick={onLogout} className="w-full flex items-center justify-center gap-2 bg-slate-800 text-slate-300 px-3 py-3 rounded-lg text-sm font-medium">
              <LogOut size={18} /> Log Out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
