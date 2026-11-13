interface Window {
  lexicon?: {
    saveBeforeImport(raw: string): Promise<void>
    saveSnapshot(raw: string): Promise<void>
    hasBeforeImport(): Promise<boolean>
    loadBeforeImport(): Promise<string | null>
    loadSnapshot(): Promise<string | null>
    setTheme(theme: 'system' | 'light' | 'dark'): Promise<void>
    openDataFolder(): Promise<string>
  }
}
