import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { turnOffBrowserAutofill } from './utils/noAutofill'
import { applyBannerTheme, applyClientSide, applyClientTabsPosition, applyColorVision, applyCustomColors, applyFontSize, applyFontType, applyTabsPosition, applyTheme, applyWindowTheme, getSavedBannerTheme, getSavedClientSide, getSavedClientTabsPosition, getSavedColorVision, getSavedCustomColors, getSavedFontSize, getSavedFontType, getSavedTabsPosition, getSavedTheme, getSavedWindowTheme } from './hooks/useTheme'

// Set before the first render so the saved themes don't flash the wrong colors first
applyTheme(getSavedTheme())
applyWindowTheme(getSavedWindowTheme())
applyBannerTheme(getSavedBannerTheme())
applyColorVision(getSavedColorVision())
applyCustomColors(getSavedCustomColors())
applyFontSize(getSavedFontSize())
applyFontType(getSavedFontType())
applyTabsPosition(getSavedTabsPosition())
applyClientSide(getSavedClientSide())
applyClientTabsPosition(getSavedClientTabsPosition())

// Keeps the browser from offering to save client details (names, ID #s, addresses) as the user's own
turnOffBrowserAutofill()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
