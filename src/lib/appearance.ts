import { useSyncExternalStore } from 'react'

export type Appearance = 'system' | 'light' | 'dark'
const KEY = 'lexicon-appearance'
const EVENT = 'lexicon-appearance-change'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function preference(): Appearance {
  try {
    const value = localStorage.getItem(KEY)
    if (value === 'light' || value === 'dark') return value
  } catch { /* System appearance is also available without storage. */ }
  return 'system'
}

function snapshot() {
  const value = preference()
  return `${value}:${value === 'system' ? (media.matches ? 'dark' : 'light') : value}`
}

function apply() {
  const [, resolved] = snapshot().split(':')
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved
  void window.lexicon?.setTheme(preference()).catch(() => { /* CSS remains usable. */ })
}

export function initializeAppearance() {
  apply()
  media.addEventListener('change', apply)
  window.addEventListener('storage', apply)
  window.addEventListener(EVENT, apply)
}

function subscribe(listener: () => void) {
  media.addEventListener('change', listener)
  window.addEventListener('storage', listener)
  window.addEventListener(EVENT, listener)
  return () => {
    media.removeEventListener('change', listener)
    window.removeEventListener('storage', listener)
    window.removeEventListener(EVENT, listener)
  }
}

export function setAppearance(value: Appearance): boolean {
  try { localStorage.setItem(KEY, value) } catch { return false }
  window.dispatchEvent(new Event(EVENT))
  return true
}

export function useAppearance() {
  const [appearance, resolved] = useSyncExternalStore(subscribe, snapshot).split(':')
  return { appearance: appearance as Appearance, resolved: resolved as 'light' | 'dark' }
}
