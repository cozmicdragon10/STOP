import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyColorVision, applyCustomColors, applyFontSize, applyFontType, applyTheme, getSavedColorVision, getSavedCustomColors, getSavedFontSize, getSavedFontType, getSavedTheme } from './hooks/useTheme'

// Set before the first render so the saved theme doesn't flash dark first
applyTheme(getSavedTheme())
applyColorVision(getSavedColorVision())
applyCustomColors(getSavedCustomColors())
applyFontSize(getSavedFontSize())
applyFontType(getSavedFontType())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
