import { CloudMoon, Moon, Sun, SunDim } from 'lucide-react';
import { CLIENT_SIDE_OPTIONS, COLOR_VISION_OPTIONS, DEFAULT_CUSTOM_COLORS, FONT_SIZE_OPTIONS, FONT_TYPE_OPTIONS, TABS_POSITION_OPTIONS, THEME_OPTIONS, useTheme, type ClientSide, type ColorVision, type FontSize, type FontType, type StatusColor, type TabsPosition, type Theme } from '../../hooks/useTheme';

const THEME_ICONS = { light: Sun, soft: SunDim, dim: CloudMoon, dark: Moon };

// A Light | Soft | Dim | Dark switch for one part of the screen
function ThemePicker({ label, hint, value, onChange }: { label: string; hint: string; value: Theme; onChange: (theme: Theme) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-200">{label}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <div role="group" aria-label={`${label} theme`} className="flex flex-wrap max-w-full bg-slate-800 border border-slate-700 rounded-lg p-0.5">
        {THEME_OPTIONS.map(o => {
          const Icon = THEME_ICONS[o.value];
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-semibold text-xs ${active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}
            >
              <Icon size={14} /> {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The Appearance preview badges. They use the palette classes, so they show whichever color setting is active.
const STATUS_CHIPS: { key: StatusColor; label: string; className: string }[] = [
  { key: 'success', label: 'Paid / Assigned', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { key: 'warning', label: 'Warning', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { key: 'problem', label: 'Problem / Owes', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  { key: 'info', label: 'Information', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
];

// The Settings tab, open to every role: each person's own appearance and layout, remembered on their computer
export default function SettingsTab() {
  const { theme, setTheme, windowTheme, setWindowTheme, bannerTheme, setBannerTheme, colorVision, setColorVision, customColors, setCustomColors, fontSize, setFontSize, fontType, setFontType, tabsPosition, setTabsPosition, clientSide, setClientSide, clientTabsPosition, setClientTabsPosition } = useTheme();
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 md:p-6 shadow-xl space-y-4 self-start">
        <div className="border-b border-slate-800 pb-3">
          <h2 className="text-lg font-bold text-white">Appearance</h2>
        </div>
        <div className="space-y-3">
          <ThemePicker label="Windows" hint="The cards and panels in the middle of the page" value={windowTheme} onChange={setWindowTheme} />
          <ThemePicker label="Background" hint="The page behind them, and titles on it" value={theme} onChange={setTheme} />
          <ThemePicker label="Banner & Tabs" hint="The header and the main tab bar" value={bannerTheme} onChange={setBannerTheme} />
        </div>
        <p className="text-xs text-slate-400">Light, Soft (light on gray), Dim (dark on softer gray), or Dark. Your choices are remembered on this computer.</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(14rem,100%),1fr))] gap-3">
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
              ? 'Click a color square to choose that status color. Remembered on this computer, like the theme.'
              : 'Changes the green, amber and blue used across the app so statuses are easier to tell apart. Remembered on this computer, like the theme.'}
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
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(14rem,100%),1fr))] gap-3">
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
        <p className="text-xs text-slate-400">Left and right only show on wide screens; on smaller ones the client view fills the screen. Remembered on this device, like the theme.</p>
      </div>
    </div>
  );
}
