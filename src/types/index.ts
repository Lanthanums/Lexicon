export interface WordMeaning {
  pos: string
  en: string
  zh?: string
}

export interface Word {
  id: string
  /** lowercase normalized form, used for similarity */
  text: string
  phonetic?: string
  /** primary Chinese gloss, editable */
  gloss: string
  meanings: WordMeaning[]
  groupId: string
  addedAt: number
  source: 'api' | 'manual'
  usageNote?: string
  example?: string
}

export interface WordGroup {
  kind?: 'confusable' | 'single'
  id: string
  wordIds: string[]
  /** manual groups are preserved when re-clustering by threshold */
  manual: boolean
  createdAt: number
}

export interface WordStats {
  dueAt?: number
  correct: number
  wrong: number
  /** 0–5 mastery level (Leitner-ish) */
  level: number
  lastSeen?: number
  lastResult?: boolean
}

export interface DictProviderConfig {
  /** 'youdao-web' | 'wiktionary' | 'baidu' | 'youdao-cloud' | 'custom' */
  id: string
  label: string
  enabled: boolean
  appId?: string
  apiKey?: string
  /** custom: URL template with {word} {appid} {key} placeholders */
  endpoint?: string
  /** custom: dot path to the gloss field in a JSON response */
  glossPath?: string
}

export interface Settings {
  /** 0.5 – 0.95, similarity required for auto-grouping */
  threshold: number
  /** dictionary providers, tried in list order */
  dictProviders: DictProviderConfig[]
}

/** one recorded threshold-learning observation */
export interface LearningTrace {
  id: string
  at: number
  /** threshold in effect when the trace was produced */
  previous: number
  /** threshold the learner recommends */
  suggested: number
  /** pairwise F1 of the suggested threshold against current grouping */
  f1: number
  wordCount: number
  groupCount: number
  applied: boolean
  /** user has seen/dismissed the top notification for this trace */
  ack?: boolean
}

export interface LearningState {
  /** master switch for threshold learning */
  enabled: boolean
  /** successful word adds observed so far */
  addCount: number
  /** newest first, capped */
  traces: LearningTrace[]
}

export interface LibraryState {
  synonymSets: Record<string, SynonymSet>
  words: Record<string, Word>
  groups: Record<string, WordGroup>
  stats: Record<string, WordStats>
  settings: Settings
  learning: LearningState
  /** per-day activity, keyed by local date YYYY-MM-DD */
  activity: Record<string, { added: number; reviewed: number }>
}

export interface SynonymSet {
  id: string
  name: string
  notes: string
  wordIds: string[]
  createdAt: number
}

export type QuizMode = 'zh2en' | 'en2zh' | 'spell' | 'mixed' | 'progressive'
