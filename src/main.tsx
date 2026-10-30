import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { initializeAppearance } from '@/lib/appearance'

initializeAppearance()

async function boot() {
  if (window.lexicon && !localStorage.getItem('lexicon-state-v1')) {
    const raw = await window.lexicon.loadSnapshot().catch(() => null)
    if (raw) {
      try { const data = JSON.parse(raw); if (data.words && data.groups) localStorage.setItem('lexicon-state-v1', raw) } catch { /* retained on disk for recovery */ }
    }
  }
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

}
void boot()
