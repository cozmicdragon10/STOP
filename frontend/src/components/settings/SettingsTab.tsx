import { Moon, Sun } from 'lucide-react';
import { CLIENT_SIDE_OPTIONS, COLOR_VISION_OPTIONS, DEFAULT_CUSTOM_COLORS, FONT_SIZE_OPTIONS, FONT_TYPE_OPTIONS, TABS_POSITION_OPTIONS, useTheme, type ClientSide, type ColorVision, type FontSize, type FontType, type StatusColor, type TabsPosition } from '../../hooks/useTheme';

// The Appearance preview badges. They use the palette classes, so they show whichever color setting is active.
const STATUS_CHIPS: { key: StatusColor; label: string; className: string }[] = [
  { key: 'success', label: 'Paid / Assigned', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { key: 'warning', label: 'Warning', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { key: 'problem', label: 'Problem / Owes', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { key: 'info', label: 'Information', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
];

// The Settings tab, open to every role: each person's own appearance and layout, remembered on their computer
export default function SettingsTab() {
  const { theme, toggleTheme, colorVision, setColorVision, customColors, setCustomColors, fontSize, setFontSize, fontType, setFontType, tabsPosition, setTabsPosition, clientSide, setClientSide, clientTabsPosition, setClientTabsPosition } = useTheme();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl space-y-4 self-start">
        <div className="flex justify-between items-center gap-3 border-b border-slate-800 pb-3">
          <h2 className="text-lg font-bold text-white">Appearance</h2>
          <button
            type="button"
            onClick={toggleTheme}
            title="Click to switch theme"
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-1.5 rounded font-semibold text-xs shrink-0"
          >
            {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />} {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
          </button>
        </div>
        <p className="text-xs text-slate-400">Click the button to switch between dark and light mode. Your choice is remembered on this computer.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="font-size" className="block text-xs text-slate-400 uppercase mb-1">Font Size</label>
            <select
              id="font-size"
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value as FontSize)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm"
            >
              {FONT_SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="font-type" className="block text-xs text-slate-400 uppercase mb-1">Font Type</label>
            <select
              id="font-type"
              value={fontType}
              onChange={(e) => setFontType(e.target.value as FontType)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm"
            >
              {FONT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="color-vision" className="block text-xs text-slate-400 uppercase mb-1">Color Blind Setting</label>
          <select
            id="color-vision"
            value={colorVision}
            onChange={(e) => setColorVision(e.target.value as ColorVision)}
            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm"
          >
            {COLOR_VISION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex flex-wrap items-center gap-2 mt-3" aria-label="Color preview">
            {STATUS_CHIPS.map(({ key, label, className }) => (
              <label key={key} className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border ${className} ${colorVision === 'custom' ? 'cursor-pointer' : ''}`}>
                {colorVision === 'custom' && (
                  <input
                    type="color"
                    aria-label={`${label} color`}
                    value={customColors[key]}
                    onChange={(e) => setCustomColors({ ...customColors, [key]: e.target.value })}
                    className="h-4 w-4 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                )}
                {label}
              </label>
            ))}
            {colorVision === 'custom' && (
              <button type="button" onClick={() => setCustomColors(DEFAULT_CUSTOM_COLORS)} className="text-xs text-slate-400 hover:text-white underline">Reset Colors</button>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            {colorVision === 'custom'
              ? 'Click a color square to choose that status color. Remembered on this computer, like dark mode.'
              : 'Changes the green, amber and blue used across the app so statuses are easier to tell apart. Remembered on this computer, like dark mode.'}
          </p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl space-y-4 self-start">
        <div className="border-b border-slate-800 pb-3">
          <h2 className="text-lg font-bold text-white">Layout</h2>
        </div>
        <div>
          <label htmlFor="tabs-position" className="block text-xs text-slate-400 uppercase mb-1">Main Tabs Position</label>
          <select
            id="tabs-position"
            value={tabsPosition}
            onChange={(e) => setTabsPosition(e.target.value as TabsPosition)}
            className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm"
          >
            {TABS_POSITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="client-side" className="block text-xs text-slate-400 uppercase mb-1">Client View Side</label>
            <select
              id="client-side"
              value={clientSide}
              onChange={(e) => setClientSide(e.target.value as ClientSide)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm"
            >
              {CLIENT_SIDE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="client-tabs-position" className="block text-xs text-slate-400 uppercase mb-1">Client Tabs Position</label>
            <select
              id="client-tabs-position"
              value={clientTabsPosition}
              onChange={(e) => setClientTabsPosition(e.target.value as TabsPosition)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white text-sm"
            >
              {TABS_POSITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-400">Left and right only show on wide screens; on smaller ones the client view fills the screen. Remembered on this device, like dark mode.</p>
      </div>
    </div>
  );
}
