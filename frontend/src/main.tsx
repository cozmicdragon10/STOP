import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
