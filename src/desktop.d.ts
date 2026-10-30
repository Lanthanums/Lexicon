interface Window {
  lexicon?: {
    saveBeforeImport(raw: string): Promise<void>
    saveSnapshot(raw: string): Promise<void>
    loadSnapshot(): Promise<string | null>
    setTheme(theme: 'system' | 'light' | 'dark'): Promise<void>
    openDataFolder(): Promise<string>
  }
}
