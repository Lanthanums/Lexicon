import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { initializeAppearance } from '@/lib/appearance'
import { EMPTY, STORAGE_KEY } from '@/lib/libraryDefaults'
import { normalizeState } from '@/lib/state'

initializeAppearance()

async function boot() {
  let mirror: string | null = null
  try { mirror = localStorage.getItem(STORAGE_KEY) } catch { /* use the disk snapshot */ }
  const disk = await window.lexicon?.loadSnapshot().catch(() => null) ?? null
  const parse = (raw: string | null) => {
    if (!raw) return
    try {
      const data = JSON.parse(raw)
      const state = normalizeState(data, EMPTY)
      const at = Number.isSafeInteger(data.snapshotAt) && data.snapshotAt > 0 ? data.snapshotAt as number : 0
      return { state, at }
    } catch { /* keep the unreadable copy available for recovery */ }
  }
  const browserCopy = parse(mirror)
  const diskCopy = mirror === disk ? browserCopy : parse(disk)
  const chosen = diskCopy && (!browserCopy || diskCopy.at > browserCopy.at) ? diskCopy : browserCopy
  const preserveUnreadable = !chosen && (mirror !== null || disk !== null)
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App initialState={chosen?.state} snapshotAt={chosen?.at} preserveUnreadable={preserveUnreadable} />
    </BrowserRouter>
  </StrictMode>,
)

}
void boot()
