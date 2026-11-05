import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyClientSide, applyClientTabsPosition, applyColorVision, applyCustomColors, applyFontSize, applyFontType, applyTabsPosition, applyTheme, getSavedClientSide, getSavedClientTabsPosition, getSavedColorVision, getSavedCustomColors, getSavedFontSize, getSavedFontType, getSavedTabsPosition, getSavedTheme } from './hooks/useTheme'

// Set before the first render so the saved theme doesn't flash dark first
applyTheme(getSavedTheme())
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
