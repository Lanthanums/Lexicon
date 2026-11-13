import type { DictProviderConfig, LibraryState, Settings } from '../types'

export const STORAGE_KEY = 'lexicon-state-v1'
export const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
export const BEFORE_IMPORT_KEY = 'lexicon-before-import'

const DEFAULT_PROVIDERS: DictProviderConfig[] = [
  { id: 'youdao-web', label: '网易有道（免费 · 快速）', enabled: true },
  {
    id: 'wiktionary',
    label: '维基词典 + MyMemory（免费 · 较慢 · 默认关闭）',
    enabled: false,
  },
]

const DEFAULT_SETTINGS: Settings = {
  synonymMode: 'offline',
  threshold: 0.7,
  dictProviders: DEFAULT_PROVIDERS,
}

export const EMPTY: LibraryState = {
  customSets: {},
  synonymSets: {},
  words: {},
  groups: {},
  stats: {},
  settings: DEFAULT_SETTINGS,
  learning: { enabled: true, addCount: 0, traces: [] },
  activity: {},
}
