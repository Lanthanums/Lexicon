interface Window {
  lexicon?: {
    saveBeforeImport(raw: string): Promise<void>
    saveSnapshot(raw: string): Promise<void>
    loadSnapshot(): Promise<string | null>
    migrateLegacy(): Promise<string>
    cancelMigration(): Promise<void>
    openDataFolder(): Promise<string>
  }
}
