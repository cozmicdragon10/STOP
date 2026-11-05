import { useState } from 'react';
import { LogOut, Menu, X } from 'lucide-react';
import BarTabs from './BarTabs';
import type { NavItem } from './BarTabs';

interface Props {
  // Every section the user can open, in order
  items: NavItem[];
  activeTab: string;
  onSelect: (tab: string) => void;
  user: { displayname: string; role: string };
  onLogout: () => void;
}

// The app's navigation at every screen size: a bar with every section, pinned to the bottom of the screen or, with the Layout
// setting, the top. On phones it swipes sideways, and a Menu sheet lists them all at once with the account and Log Out. From
// md up there may be no touch screen to swipe, so every section fits across the bar, and the account is in the header.
export default function MainNav({ items, activeTab, onSelect, user, onLogout }: Props) {
  const [open, setOpen] = useState(false);

  const select = (tab: string) => {
    setOpen(false);
    onSelect(tab);
  };

  return (
    <>
      <nav aria-label="Main" className="fixed bottom-0 inset-x-0 tabs-top:sticky tabs-top:top-0 tabs-top:bottom-auto z-40 bg-slate-900 border-t tabs-top:border-t-0 tabs-top:border-b border-slate-800 flex">
        <BarTabs items={items} activeTab={activeTab} onSelect={select} className="[scrollbar-width:none]" />
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
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
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
