import { useCallback, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'stop-theme';

// The saved choice for this browser; dark is the default
export function getSavedTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

// index.css swaps the color palette when <html data-theme="light"> is set
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export type ColorVision = 'standard' | 'red-green' | 'blue-yellow' | 'custom';

export const COLOR_VISION_OPTIONS: { value: ColorVision; label: string }[] = [
  { value: 'standard', label: 'Standard colors' },
  { value: 'red-green', label: 'Red-green (protanopia, deuteranopia)' },
  { value: 'blue-yellow', label: 'Blue-yellow (tritanopia)' },
  { value: 'custom', label: 'Custom (choose your own colors)' },
];

export type StatusColor = 'success' | 'warning' | 'problem' | 'info';
export type CustomColors = Record<StatusColor, string>;

// The standard status colors, so Custom starts out looking the same
export const DEFAULT_CUSTOM_COLORS: CustomColors = { success: '#00d492', warning: '#ffb900', problem: '#ff6467', info: '#51a2ff' };

const COLOR_VISION_KEY = 'stop-color-vision';
const CUSTOM_COLORS_KEY = 'stop-custom-colors';

// The saved custom colors for this browser. Anything missing or unreadable falls back to the standard color.
export function getSavedCustomColors(): CustomColors {
  const colors = { ...DEFAULT_CUSTOM_COLORS };
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) || '{}');
    for (const key of Object.keys(colors) as StatusColor[]) {
      if (/^#[0-9a-f]{6}$/i.test(saved?.[key])) colors[key] = saved[key];
    }
  } catch {
    // Storage unavailable or bad JSON
  }
  return colors;
}

// index.css builds the shades of each status color from these when <html data-color-vision="custom"> is set
export function applyCustomColors(colors: CustomColors) {
  for (const key of Object.keys(colors) as StatusColor[]) {
    document.documentElement.style.setProperty(`--custom-${key}`, colors[key]);
  }
}

// The saved choice for this browser; standard colors are the default
export function getSavedColorVision(): ColorVision {
  try {
    const saved = localStorage.getItem(COLOR_VISION_KEY);
    return COLOR_VISION_OPTIONS.find(o => o.value === saved)?.value ?? 'standard';
  } catch {
    return 'standard';
  }
}

// index.css swaps the status colors when <html data-color-vision="..."> is set
export function applyColorVision(colorVision: ColorVision) {
  document.documentElement.dataset.colorVision = colorVision;
}

// Sizes are percentages of the browser's own text size. The app is sized in rem, so spacing grows with the text.
export const FONT_SIZE_OPTIONS = [
  { value: 'small', label: 'Small', size: '87.5%' },
  { value: 'default', label: 'Default', size: '100%' },
  { value: 'large', label: 'Large', size: '112.5%' },
  { value: 'extra-large', label: 'Extra Large', size: '125%' },
] as const;
export type FontSize = (typeof FONT_SIZE_OPTIONS)[number]['value'];

// Fonts that come with Windows, so nothing is downloaded. Default keeps the app's built-in font.
export const FONT_TYPE_OPTIONS = [
  { value: 'default', label: 'Default', stack: '' },
  { value: 'arial', label: 'Arial', stack: 'Arial, sans-serif' },
  { value: 'calibri', label: 'Calibri', stack: 'Calibri, sans-serif' },
  { value: 'segoe', label: 'Segoe UI', stack: '"Segoe UI", sans-serif' },
  { value: 'tahoma', label: 'Tahoma', stack: 'Tahoma, sans-serif' },
  { value: 'verdana', label: 'Verdana', stack: 'Verdana, sans-serif' },
  { value: 'georgia', label: 'Georgia', stack: 'Georgia, serif' },
  { value: 'times', label: 'Times New Roman', stack: '"Times New Roman", serif' },
] as const;
export type FontType = (typeof FONT_TYPE_OPTIONS)[number]['value'];

const FONT_SIZE_KEY = 'stop-font-size';
const FONT_TYPE_KEY = 'stop-font-type';

const savedChoice = <T extends string>(key: string, options: readonly { value: T }[], fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return options.find(o => o.value === saved)?.value ?? fallback;
  } catch {
    return fallback;
  }
};

// The saved choices for this browser
export const getSavedFontSize = () => savedChoice<FontSize>(FONT_SIZE_KEY, FONT_SIZE_OPTIONS, 'default');
export const getSavedFontType = () => savedChoice<FontType>(FONT_TYPE_KEY, FONT_TYPE_OPTIONS, 'default');

export function applyFontSize(fontSize: FontSize) {
  document.documentElement.style.fontSize = FONT_SIZE_OPTIONS.find(o => o.value === fontSize)?.size ?? '';
}

// Tailwind reads --font-sans for the page font; removing it puts the default back
export function applyFontType(fontType: FontType) {
  const stack = FONT_TYPE_OPTIONS.find(o => o.value === fontType)?.stack;
  if (stack) document.documentElement.style.setProperty('--font-sans', stack);
  else document.documentElement.style.removeProperty('--font-sans');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  const [fontSize, setFontSizeState] = useState<FontSize>(getSavedFontSize);
  const setFontSize = useCallback((next: FontSize) => {
    setFontSizeState(next);
    applyFontSize(next);
    try {
      localStorage.setItem(FONT_SIZE_KEY, next);
    } catch {
      // Not saved (private window, blocked storage); the size still applies for this visit
    }
  }, []);
  const [fontType, setFontTypeState] = useState<FontType>(getSavedFontType);
  const setFontType = useCallback((next: FontType) => {
    setFontTypeState(next);
    applyFontType(next);
    try {
      localStorage.setItem(FONT_TYPE_KEY, next);
    } catch {
      // Not saved (private window, blocked storage); the font still applies for this visit
    }
  }, []);
  const [colorVision, setColorVisionState] = useState<ColorVision>(getSavedColorVision);
  const setColorVision = useCallback((next: ColorVision) => {
    setColorVisionState(next);
    applyColorVision(next);
    try {
      localStorage.setItem(COLOR_VISION_KEY, next);
    } catch {
      // Not saved (private window, blocked storage); the colors still apply for this visit
    }
  }, []);
  const [customColors, setCustomColorsState] = useState<CustomColors>(getSavedCustomColors);
  const setCustomColors = useCallback((next: CustomColors) => {
    setCustomColorsState(next);
    applyCustomColors(next);
    try {
      localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(next));
    } catch {
      // Not saved (private window, blocked storage); the colors still apply for this visit
    }
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Not saved (private window, blocked storage); the switch still applies for this visit
      }
      return next;
    });
  }, []);
  return { theme, toggleTheme, colorVision, setColorVision, customColors, setCustomColors, fontSize, setFontSize, fontType, setFontType };
}
