import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react'
import { toast } from 'sonner'
import type {
  DictProviderConfig,
  LearningTrace,
  LibraryState,
  Settings,
  Word,
  WordGroup,
  WordStats,
} from '@/types'
import { clusterWords, wordSimilarity } from '@/lib/similarity'
import type { ThresholdSuggestion } from '@/lib/learn'
import { normalizeState } from '@/lib/state'

const STORAGE_KEY = 'lexicon-state-v1'

export const DEFAULT_PROVIDERS: DictProviderConfig[] = [
  { id: 'youdao-web', label: '网易有道（免费 · 快速）', enabled: true },
  {
    id: 'wiktionary',
    label: '维基词典 + MyMemory（免费 · 较慢 · 默认关闭）',
    enabled: false,
  },
]

const DEFAULT_SETTINGS: Settings = {
  threshold: 0.7,
  dictProviders: DEFAULT_PROVIDERS,
}

const EMPTY: LibraryState = {
  synonymSets: {},
  words: {},
  groups: {},
  stats: {},
  settings: DEFAULT_SETTINGS,
  learning: { enabled: true, addCount: 0, traces: [] },
  activity: {},
}

/** local-date key YYYY-MM-DD (not UTC — the user's day rolls at midnight) */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** learner notifies only when the suggestion moves at least this much */
const LEARN_NOTIFY_DELTA = 0.02
/** learner runs after every N successful word adds */
const LEARN_EVERY = 50

export interface NewWordInput {
  text: string
  phonetic?: string
  gloss: string
  meanings: Word['meanings']
  source: Word['source']
  usageNote?: string
  example?: string
}

export interface AddResult {
  status: 'added' | 'duplicate'
  wordId: string
  /** group the word ended up in (or already belongs to) */
  groupId: string
  /** ids of other words now sharing the group */
  groupedWith: string[]
  homophoneMatch: boolean
}

/** conflict resolution chosen by the user when scores tie across groups */
export type AddResolution =
  | { mode: 'auto' }
  | { mode: 'group'; groupId: string }
  | { mode: 'merge'; groupIds: string[] }
  | { mode: 'new' }

export interface GroupCandidate {
  groupId: string
  score: number
  homophone: boolean
}

interface LibraryApi {
  state: LibraryState
  addStudyWord: (input: NewWordInput) => AddResult
  createSynonymSet: (name: string, wordIds: string[], notes: string) => string
  updateSynonymSet: (id: string, patch: { name?: string; notes?: string; wordIds?: string[] }) => void
  deleteSynonymSet: (id: string) => void
  addWord: (input: NewWordInput, resolution?: AddResolution) => AddResult
  previewGrouping: (input: { text: string; phonetic?: string }) => GroupCandidate[]
  deleteWord: (id: string) => void
  deleteGroup: (groupId: string) => void
  updateWord: (
    id: string,
    patch: Partial<Pick<Word, 'gloss' | 'phonetic' | 'meanings' | 'usageNote' | 'example'>>,
  ) => void
  mergeWordsIntoGroup: (wordIds: string[]) => void
  moveWordsToGroup: (wordIds: string[], groupId: string) => void
  createGroup: () => string
  moveWordInGroup: (groupId: string, wordId: string, dir: -1 | 1) => void
  detachWord: (id: string) => void
  setThreshold: (t: number) => void
  updateDictProvider: (id: string, patch: Partial<DictProviderConfig>) => void
  addDictProvider: (cfg: DictProviderConfig) => void
  removeDictProvider: (id: string) => void
  /** move a provider to the front of the chain, making it the primary */
  setPrimaryProvider: (id: string) => void
  recluster: () => void
  setLearningEnabled: (on: boolean) => void
  applyTrace: (id: string) => void
  ackTrace: (id: string) => void
  removeTrace: (id: string) => void
  clearTraces: () => void
  recordAnswer: (id: string, correct: boolean) => void
  resetWordStats: (id: string) => void
  resetGroupStats: (groupId: string) => void
  seedExamples: () => number
  importState: (json: string) => boolean
  clearAll: () => void
}

const LibraryContext = createContext<LibraryApi | null>(null)

function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  ).toLowerCase()
}

function load(): LibraryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    return normalizeState(JSON.parse(raw), EMPTY)

  } catch {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) localStorage.setItem('lexicon-unreadable-original', raw)
    } catch { /* original remains in browser storage or disk backups */ }
    queueMicrotask(() => toast.error('原词库未能读取，已保留恢复副本。请在设置中检查备份。', { id: 'load-error', duration: 15000 }))
    return EMPTY
  }
}

/* ---------- seed data (offline-friendly demo) ---------- */

const SEED: Array<NewWordInput & { seedGroup: string }> = [
  { seedGroup: 'a', text: 'scout', phonetic: '/skaʊt/', gloss: '侦察；侦察员；物色人才', source: 'manual', meanings: [{ pos: 'n.', en: 'a person sent out to obtain information', zh: '侦察员' }, { pos: 'v.', en: 'to search for something', zh: '寻找；物色' }] },
  { seedGroup: 'a', text: 'stout', phonetic: '/staʊt/', gloss: '结实的；矮胖的；烈性黑啤酒', source: 'manual', meanings: [{ pos: 'adj.', en: 'rather fat or of heavy build', zh: '矮胖的' }, { pos: 'n.', en: 'a strong dark beer', zh: '烈性黑啤' }] },
  { seedGroup: 'a', text: 'spout', phonetic: '/spaʊt/', gloss: '喷口；壶嘴；喷出', source: 'manual', meanings: [{ pos: 'n.', en: 'a tube or lip projecting from a container', zh: '壶嘴；喷嘴' }, { pos: 'v.', en: 'to send out liquid in a stream', zh: '喷出' }] },
  { seedGroup: 'a', text: 'scour', phonetic: '/ˈskaʊər/', gloss: '擦洗；彻底搜索', source: 'manual', meanings: [{ pos: 'v.', en: 'to clean by rubbing hard', zh: '擦净' }, { pos: 'v.', en: 'to search a place thoroughly', zh: '彻底搜查' }] },
  { seedGroup: 'a', text: 'snout', phonetic: '/snaʊt/', gloss: '（动物的）口鼻部；吻', source: 'manual', meanings: [{ pos: 'n.', en: 'the projecting nose and mouth of an animal', zh: '口鼻部' }] },
  { seedGroup: 'b', text: 'compliment', phonetic: '/ˈkɒmplɪmənt/', gloss: '赞美；恭维；问候', source: 'manual', meanings: [{ pos: 'n.', en: 'a polite expression of praise or admiration', zh: '赞美的话' }, { pos: 'v.', en: 'to praise someone politely', zh: '称赞' }] },
  { seedGroup: 'b', text: 'complement', phonetic: '/ˈkɒmplɪment/', gloss: '补充物；补足；补语', source: 'manual', meanings: [{ pos: 'n.', en: 'a thing that completes or brings to perfection', zh: '补充物' }, { pos: 'v.', en: 'to add to something in a way that enhances it', zh: '使完善' }] },
  { seedGroup: 'c', text: 'stationary', phonetic: '/ˈsteɪʃənri/', gloss: '静止的；固定的', source: 'manual', meanings: [{ pos: 'adj.', en: 'not moving or not intended to be moved', zh: '静止的' }] },
  { seedGroup: 'c', text: 'stationery', phonetic: '/ˈsteɪʃənri/', gloss: '文具；信纸', source: 'manual', meanings: [{ pos: 'n.', en: 'writing materials and office supplies', zh: '文具' }] },
]

/* ---------- provider ---------- */

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [state, setReactState] = useState<LibraryState>(load)
  const stateRef = useRef(state)
  // Transactions run once, synchronously, so callers get the actual add result.
  const setState = useCallback((update: LibraryState | ((prev: LibraryState) => LibraryState)) => {
    const next = typeof update === 'function' ? update(stateRef.current) : update
    stateRef.current = next
    setReactState(next)
  }, [])

  useEffect(() => {
    const flush = () => {
      try {
        const raw = JSON.stringify(stateRef.current)
        localStorage.setItem(STORAGE_KEY, raw)
        window.lexicon?.saveSnapshot(raw).catch(() => toast.error('自动备份失败，请手动导出词库', { id: 'backup-error' }))
      } catch {
        toast.error('词库未能保存，请立即导出备份', { id: 'storage-error' })
      }
    }
    const timer = window.setTimeout(flush, 180)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [state])

  const lastLearned = useRef(state.learning.addCount)
  useEffect(() => {
    const count = state.learning.addCount
    if (!count || count % LEARN_EVERY || count === lastLearned.current || !state.learning.enabled) return
    lastLearned.current = count
    const snapshot = stateRef.current
    const words = Object.values(snapshot.words).filter(w => snapshot.groups[w.groupId]?.kind !== 'single').slice(-300)
    const worker = new Worker(new URL('../lib/threshold.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<ThresholdSuggestion | null>) => {
      const sug = event.data
      setState(prev => {
        if (prev.learning.addCount !== count) return prev
        const trace: LearningTrace = {
          id: uid(), at: Date.now(), previous: snapshot.settings.threshold,
          suggested: sug?.suggested ?? snapshot.settings.threshold, f1: sug?.f1 ?? 0,
          wordCount: words.length, groupCount: new Set(words.map(w => w.groupId)).size,
          applied: false, ack: !(sug && Math.abs(sug.suggested - snapshot.settings.threshold) >= LEARN_NOTIFY_DELTA),
        }
        return { ...prev, learning: { ...prev.learning, traces: [trace, ...prev.learning.traces].slice(0, 20) } }
      })
      worker.terminate()
    }
    worker.onerror = () => { worker.terminate(); toast.info('本次阈值建议未生成，录入与复习已保存') }
    worker.postMessage({ words, groups: snapshot.groups, threshold: snapshot.settings.threshold })
    return () => worker.terminate()
  }, [state.learning.addCount, state.learning.enabled, setState])

  const previewGrouping = useCallback(
    (input: { text: string; phonetic?: string }): GroupCandidate[] => {
      const threshold = state.settings.threshold
      const best = new Map<string, GroupCandidate>()
      for (const w of Object.values(state.words)) {
        if (state.groups[w.groupId]?.kind === 'single') continue;
        const { score, homophone } = wordSimilarity(
          input.text,
          w.text,
          input.phonetic,
          w.phonetic,
        )
        if (homophone || score >= threshold) {
          const s = homophone ? 1 : score
          const cur = best.get(w.groupId)
          if (!cur || s > cur.score)
            best.set(w.groupId, { groupId: w.groupId, score: s, homophone })
        }
      }
      return [...best.values()].sort((a, b) => b.score - a.score)
    },
    [state],
  )

  const applyTrace = useCallback((id: string) => {
    let applied: LearningTrace | undefined
    setState((prev) => {
      const tr = prev.learning.traces.find((t) => t.id === id)
      if (!tr) return prev
      applied = tr
      return {
        ...prev,
        settings: { ...prev.settings, threshold: tr.suggested },
        learning: {
          ...prev.learning,
          traces: prev.learning.traces.map((t) =>
            t.id === id ? { ...t, applied: true, ack: true } : t,
          ),
        },
      }
    })
    if (applied)
      toast.success(`阈值已调整为 ${applied.suggested.toFixed(2)}`, {
        description: '新录入的词将按学习建议的阈值归组',
      })
  }, [setState])

  const ackTrace = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      learning: {
        ...prev.learning,
        traces: prev.learning.traces.map((t) =>
          t.id === id ? { ...t, ack: true } : t,
        ),
      },
    }))
  }, [setState])

  const addWord = useCallback(
    (input: NewWordInput, resolution: AddResolution = { mode: 'auto' }): AddResult => {
    let result: AddResult = {
      status: 'added',
      wordId: '',
      groupId: '',
      groupedWith: [],
      homophoneMatch: false,
    }
    setState((prev) => {
      const existing = Object.values(prev.words).find(
        (w) => w.text === input.text,
      )
      if (existing) {
        result = {
          status: 'duplicate',
          wordId: existing.id,
          groupId: existing.groupId,
          groupedWith: [],
          homophoneMatch: false,
        }
        return prev
      }

      const id = uid()
      const threshold = prev.settings.threshold

      // find every existing word similar enough to join
      const hits: Array<{ word: Word; score: number; homophone: boolean }> = []
      for (const w of Object.values(prev.words)) {
        if (prev.groups[w.groupId]?.kind === 'single') continue;
        const { score, homophone } = wordSimilarity(
          input.text,
          w.text,
          input.phonetic,
          w.phonetic,
        )
        if (homophone || score >= threshold)
          hits.push({ word: w, score, homophone })
      }
      hits.sort((a, b) => b.score - a.score)

      const groups: Record<string, WordGroup> = { ...prev.groups }
      const words = { ...prev.words }
      let groupId: string

      /** merge several existing groups into the first, repointing words */
      const mergeInto = (groupIds: string[]) => {
        const base = { ...groups[groupIds[0]] }
        groups[groupIds[0]] = base
        for (const gid of groupIds.slice(1)) {
          const g = groups[gid]
          if (!g) continue
          base.wordIds = [...new Set([...base.wordIds, ...g.wordIds])]
          base.manual = base.manual || g.manual
          delete groups[gid]
          for (const wid of g.wordIds) {
            if (words[wid]) words[wid] = { ...words[wid], groupId: groupIds[0] }
          }
        }
      }

      if (resolution.mode === 'new') {
        groupId = uid()
        groups[groupId] = { id: groupId, wordIds: [], manual: false, createdAt: Date.now() }
      } else if (resolution.mode === 'group' && groups[resolution.groupId]) {
        groupId = resolution.groupId
      } else if (resolution.mode === 'merge') {
        const valid = resolution.groupIds.filter((gid) => groups[gid])
        if (valid.length === 0) {
          groupId = uid()
          groups[groupId] = { id: groupId, wordIds: [], manual: false, createdAt: Date.now() }
        } else {
          groupId = valid[0]
          mergeInto(valid)
        }
      } else if (hits.length === 0) {
        groupId = uid()
        groups[groupId] = { id: groupId, wordIds: [], manual: false, createdAt: Date.now() }
      } else {
        // auto: join the best-matching group; if the new word bridges
        // several groups, merge them all into it.
        const groupIds = [...new Set(hits.map((h) => h.word.groupId))]
        groupId = groupIds[0]
        mergeInto(groupIds)
      }

      const word: Word = {
        id,
        text: input.text,
        phonetic: input.phonetic,
        gloss: input.gloss,
        meanings: input.meanings,
        groupId,
        addedAt: Date.now(),
        source: input.source,
        usageNote: input.usageNote,
        example: input.example,
      }
      groups[groupId] = {
        ...groups[groupId],
        wordIds: [...groups[groupId].wordIds, id],
      }

      result = {
        status: 'added',
        wordId: id,
        groupId,
        groupedWith: hits.map((h) => h.word.id),
        homophoneMatch: hits.some((h) => h.homophone),
      }
      return {
        ...prev,
        words: { ...words, [id]: word },
        groups,
      }
    })

    // daily activity + threshold learning
    if (result.status === 'added') {
      setState((prev) => {
        const today = dayKey()
        const act = prev.activity[today] ?? { added: 0, reviewed: 0 }
        const withActivity = {
          ...prev,
          activity: {
            ...prev.activity,
            [today]: { ...act, added: act.added + 1 },
          },
        }
        if (!prev.learning.enabled) return withActivity
        const addCount = prev.learning.addCount + 1
        if (addCount % LEARN_EVERY !== 0)
          return {
            ...withActivity,
            learning: { ...prev.learning, addCount },
          }
        return { ...withActivity, learning: { ...prev.learning, addCount } }
      })
    }
    return result
    },
    [setState],
  )

  const deleteWord = useCallback((id: string) => {
    setState((prev) => {
      const w = prev.words[id]
      if (!w) return prev
      const words = { ...prev.words }
      delete words[id]
      const stats = { ...prev.stats }
      delete stats[id]
      const groups: Record<string, WordGroup> = {}
      for (const [gid, g] of Object.entries(prev.groups)) {
        if (gid === w.groupId) {
          const rest = g.wordIds.filter((x) => x !== id)
          if (rest.length > 0) groups[gid] = { ...g, wordIds: rest }
        } else {
          groups[gid] = g
        }
      }
      const synonymSets = Object.fromEntries(Object.entries(prev.synonymSets).map(([sid, set]) =>
        [sid, { ...set, wordIds: set.wordIds.filter(wid => !!words[wid]) }]))
      return { ...prev, words, groups, stats, synonymSets }
    })
  }, [setState])

  const deleteGroup = useCallback((groupId: string) => {
    setState((prev) => {
      const g = prev.groups[groupId]
      if (!g) return prev
      const words = { ...prev.words }
      const stats = { ...prev.stats }
      for (const wid of g.wordIds) {
        delete words[wid]
        delete stats[wid]
      }
      const groups = { ...prev.groups }
      delete groups[groupId]
      const synonymSets = Object.fromEntries(Object.entries(prev.synonymSets).map(([sid, set]) =>
        [sid, { ...set, wordIds: set.wordIds.filter(wid => !!words[wid]) }]))
      return { ...prev, words, groups, stats, synonymSets }
    })
  }, [setState])

  const updateWord = useCallback<LibraryApi['updateWord']>((id, patch) => {
    setState((prev) => {
      const w = prev.words[id]
      if (!w) return prev
      return { ...prev, words: { ...prev.words, [id]: { ...w, ...patch } } }
    })
  }, [setState])

  const mergeWordsIntoGroup = useCallback((wordIds: string[]) => {
    setState((prev) => {
      const ids = wordIds.filter((id) => prev.words[id])
      if (ids.length < 2) return prev
      const groupId = prev.words[ids[0]].groupId
      const words = { ...prev.words }
      const groups: Record<string, WordGroup> = { ...prev.groups }
      const merged = new Set<string>(groups[groupId]?.wordIds ?? [])
      let manual = groups[groupId]?.manual ?? false
      for (const id of ids) {
        const gid = words[id].groupId
        if (gid !== groupId && groups[gid]) {
          for (const wid of groups[gid].wordIds) {
            merged.add(wid)
            words[wid] = { ...words[wid], groupId }
          }
          manual = manual || groups[gid].manual
          delete groups[gid]
        }
      }
      groups[groupId] = {
        ...(groups[groupId] ?? {
          id: groupId,
          wordIds: [],
          createdAt: Date.now(),
        }),
        wordIds: [...merged],
        manual: true, // human-curated: survive re-clustering
      }
      return { ...prev, words, groups }
    })
  }, [setState])

  const createGroup = useCallback((): string => {
    const gid = uid()
    setState((prev) => ({
      ...prev,
      groups: {
        ...prev.groups,
        [gid]: { id: gid, wordIds: [], manual: true, createdAt: Date.now() },
      },
    }))
    return gid
  }, [setState])

  const moveWordsToGroup = useCallback(
    (wordIds: string[], groupId: string) => {
      setState((prev) => {
        const target = prev.groups[groupId]
        if (!target) return prev
        const ids = wordIds.filter((id) => prev.words[id])
        if (ids.length === 0) return prev
        const words = { ...prev.words }
        const groups: Record<string, WordGroup> = { ...prev.groups }
        const merged = new Set(target.wordIds)
        for (const id of ids) {
          const gid = words[id].groupId
          if (gid === groupId) continue
          const old = groups[gid]
          if (old) {
            const rest = old.wordIds.filter((x) => x !== id)
            if (rest.length > 0) groups[gid] = { ...old, wordIds: rest }
            else delete groups[gid]
          }
          words[id] = { ...words[id], groupId }
          merged.add(id)
        }
        groups[groupId] = { ...target, wordIds: [...merged], manual: true }
        return { ...prev, words, groups }
      })
    },
    [setState],
  )

  const moveWordInGroup = useCallback(
    (groupId: string, wordId: string, dir: -1 | 1) => {
      setState((prev) => {
        const g = prev.groups[groupId]
        if (!g) return prev
        const i = g.wordIds.indexOf(wordId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= g.wordIds.length) return prev
        const wordIds = [...g.wordIds]
        ;[wordIds[i], wordIds[j]] = [wordIds[j], wordIds[i]]
        return { ...prev, groups: { ...prev.groups, [groupId]: { ...g, wordIds } } }
      })
    },
    [setState],
  )

  const updateDictProvider = useCallback(
    (id: string, patch: Partial<DictProviderConfig>) => {
      setState((prev) => ({
        ...prev,
        settings: {
          ...prev.settings,
          dictProviders: prev.settings.dictProviders.map((p) =>
            p.id === id ? { ...p, ...patch } : p,
          ),
        },
      }))
    },
    [setState],
  )

  const addDictProvider = useCallback((cfg: DictProviderConfig) => {
    setState((prev) => {
      // custom providers slot in before the slow wiktionary fallback
      const list = [...prev.settings.dictProviders]
      const wIdx = list.findIndex((p) => p.id === 'wiktionary')
      if (wIdx >= 0) list.splice(wIdx, 0, cfg)
      else list.push(cfg)
      return { ...prev, settings: { ...prev.settings, dictProviders: list } }
    })
  }, [setState])

  const removeDictProvider = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        dictProviders: prev.settings.dictProviders.filter((p) => p.id !== id),
      },
    }))
  }, [setState])

  const setPrimaryProvider = useCallback((id: string) => {
    setState((prev) => {
      const list = prev.settings.dictProviders
      const idx = list.findIndex((p) => p.id === id)
      if (idx <= 0) return prev
      const next = [...list]
      const [p] = next.splice(idx, 1)
      next.unshift(p)
      return { ...prev, settings: { ...prev.settings, dictProviders: next } }
    })
  }, [setState])

  const detachWord = useCallback((id: string) => {
    setState((prev) => {
      const w = prev.words[id]
      if (!w) return prev
      const old = prev.groups[w.groupId]
      if (old && old.wordIds.length <= 1) return {
        ...prev, groups: { ...prev.groups, [old.id]: { ...old, kind: 'single', manual: true } }
      }
      const gid = uid()
      const groups: Record<string, WordGroup> = {
        ...prev.groups,
        [gid]: { id: gid, wordIds: [id], kind: 'single', manual: true, createdAt: Date.now() },
      }
      if (old)
        groups[old.id] = {
          ...old,
          wordIds: old.wordIds.filter((x) => x !== id),
        }
      return {
        ...prev,
        groups,
        words: { ...prev.words, [id]: { ...w, groupId: gid } },
      }
    })
  }, [setState])

  const setThreshold = useCallback((t: number) => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, threshold: t },
    }))
  }, [setState])

  const setLearningEnabled = useCallback((on: boolean) => {
    setState((prev) => ({
      ...prev,
      learning: { ...prev.learning, enabled: on },
    }))
  }, [setState])

  const removeTrace = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      learning: {
        ...prev.learning,
        traces: prev.learning.traces.filter((t) => t.id !== id),
      },
    }))
  }, [setState])

  const clearTraces = useCallback(() => {
    setState((prev) => ({
      ...prev,
      learning: { ...prev.learning, traces: [] },
    }))
  }, [setState])

  const recluster = useCallback(() => {
    setState((prev) => {
      const wordList = Object.values(prev.words).filter(w => prev.groups[w.groupId]?.kind !== 'single')
      if (wordList.length === 0) return prev
      const locked = Object.values(prev.groups)
        .filter((g) => g.manual && g.wordIds.length > 1)
        .map((g) => g.wordIds)
      const manualMember = new Set(locked.flat())
      const clusters = clusterWords(
        wordList.map((w) => ({ id: w.id, text: w.text, phonetic: w.phonetic })),
        prev.settings.threshold,
        locked,
      )
      const groups: Record<string, WordGroup> = Object.fromEntries(Object.entries(prev.groups).filter(([,g]) => g.kind === 'single'))
      const words = { ...prev.words }
      for (const cluster of clusters) {
        const gid = uid()
        groups[gid] = {
          id: gid,
          wordIds: cluster,
          manual: cluster.some((id) => manualMember.has(id)),
          createdAt: Date.now(),
        }
        for (const id of cluster) {
          words[id] = { ...words[id], groupId: gid }
        }
      }
      return { ...prev, words, groups }
    })
  }, [setState])

  const recordAnswer = useCallback((id: string, correct: boolean) => {
    setState((prev) => {
      const prevStats: WordStats = prev.stats[id] ?? {
        correct: 0,
        wrong: 0,
        level: 0,
      }
      const stats: WordStats = {
        correct: prevStats.correct + (correct ? 1 : 0),
        wrong: prevStats.wrong + (correct ? 0 : 1),
        level: correct
          ? Math.min(5, prevStats.level + 1)
          : Math.max(0, prevStats.level - 1),
        dueAt: Date.now() + (correct ? [1, 3, 7, 14, 30, 60][Math.min(5, prevStats.level)] * 86400000 : 5 * 60000),
        lastSeen: Date.now(),
        lastResult: correct,
      }
      const today = dayKey()
      const act = prev.activity[today] ?? { added: 0, reviewed: 0 }
      return {
        ...prev,
        stats: { ...prev.stats, [id]: stats },
        activity: {
          ...prev.activity,
          [today]: { ...act, reviewed: act.reviewed + 1 },
        },
      }
    })
  }, [setState])

  const resetWordStats = useCallback((id: string) => {
    setState((prev) => {
      if (!prev.stats[id]) return prev
      const stats = { ...prev.stats }
      delete stats[id]
      return { ...prev, stats }
    })
  }, [setState])

  const resetGroupStats = useCallback((groupId: string) => {
    setState((prev) => {
      const g = prev.groups[groupId]
      if (!g) return prev
      const stats = { ...prev.stats }
      for (const wid of g.wordIds) delete stats[wid]
      return { ...prev, stats }
    })
  }, [setState])

  const seedExamples = useCallback((): number => {
    let added = 0
    setState((prev) => {
      const words = { ...prev.words }
      const groups = { ...prev.groups }
      for (const s of SEED) {
        if (Object.values(words).some((w) => w.text === s.text)) continue
        const id = uid()
        // find existing seed group with same seedGroup tag among words already added
        const sibling = Object.values(words).find((w) =>
          SEED.some((o) => o.text === w.text && o.seedGroup === s.seedGroup),
        )
        let gid = sibling?.groupId
        if (!gid) {
          gid = uid()
          groups[gid] = { id: gid, wordIds: [], manual: false, createdAt: Date.now() }
        }
        groups[gid] = { ...groups[gid], wordIds: [...groups[gid].wordIds, id] }
        const { text, phonetic, gloss, source, meanings } = s
        const rest = { text, phonetic, gloss, source, meanings }
        words[id] = {
          id,
          ...rest,
          groupId: gid,
          addedAt: Date.now(),
        }
        added++
      }
      return added ? { ...prev, words, groups } : prev
    })
    return added
  }, [setState])

  const importState = useCallback((json: string): boolean => {
    try {
      const parsed = normalizeState(JSON.parse(json), EMPTY)
      // Keep the previous library available even when a valid import replaces it.
      const previous = JSON.stringify(stateRef.current)
      localStorage.setItem('lexicon-before-import', previous)
      window.lexicon?.saveBeforeImport(previous).catch(() => toast.error('导入前的磁盘备份失败，本地恢复副本仍保留'))
      setState(parsed)
      return true
    } catch {
      return false
    }
  }, [setState])

  const addStudyWord = useCallback((input: NewWordInput): AddResult => {
    const text = input.text.trim().toLowerCase()
    const existing = Object.values(stateRef.current.words).find(w => w.text === text)
    if (existing) return { status: 'duplicate', wordId: existing.id, groupId: existing.groupId, groupedWith: [], homophoneMatch: false }
    if (!/^[a-z][a-z'’ -]*$/.test(text) || !input.gloss.trim()) throw new Error('请填写英文单词和释义')
    const id = uid(), gid = uid(), now = Date.now(), today = dayKey()
    setState(prev => ({
      ...prev,
      words: { ...prev.words, [id]: { ...input, id, text, groupId: gid, addedAt: now } },
      groups: { ...prev.groups, [gid]: { id: gid, wordIds: [id], manual: true, kind: 'single', createdAt: now } },
      activity: { ...prev.activity, [today]: { added: (prev.activity[today]?.added ?? 0) + 1, reviewed: prev.activity[today]?.reviewed ?? 0 } },
    }))
    return { status: 'added', wordId: id, groupId: gid, groupedWith: [], homophoneMatch: false }
  }, [setState])

  const createSynonymSet = useCallback((name: string, wordIds: string[], notes: string): string => {
    const id = uid()
    const ids = [...new Set(wordIds)].filter(wid => !!stateRef.current.words[wid])
    if (!name.trim() || ids.length < 2) throw new Error('词群需要名称和至少两个词')
    setState(prev => ({ ...prev, synonymSets: { ...prev.synonymSets,
      [id]: { id, name: name.trim(), notes, wordIds: ids, createdAt: Date.now() } } }))
    return id
  }, [setState])
  const updateSynonymSet = useCallback<LibraryApi['updateSynonymSet']>((id, patch) => {
    setState(prev => {
      const group = prev.synonymSets[id]
      if (!group) return prev
      const next = { ...group, ...patch, name: (patch.name ?? group.name).trim(),
        wordIds: [...new Set(patch.wordIds ?? group.wordIds)].filter(wid => !!prev.words[wid]) }
      if (!next.name || next.wordIds.length < 2) throw new Error('词群需要名称和至少两个词')
      return { ...prev, synonymSets: { ...prev.synonymSets, [id]: next } }
    })
  }, [setState])
  const deleteSynonymSet = useCallback((id: string) => {
    setState(prev => { const synonymSets = { ...prev.synonymSets }; delete synonymSets[id]; return { ...prev, synonymSets } })
  }, [setState])

  const clearAll = useCallback(() => setState(EMPTY), [setState])

  const api = useMemo<LibraryApi>(
    () => ({
      state,
      addStudyWord,
      createSynonymSet,
      updateSynonymSet,
      deleteSynonymSet,
      addWord,
      previewGrouping,
      deleteWord,
      deleteGroup,
      updateWord,
      mergeWordsIntoGroup,
      moveWordsToGroup,
      createGroup,
      moveWordInGroup,
      detachWord,
      setThreshold,
      updateDictProvider,
      addDictProvider,
      removeDictProvider,
      setPrimaryProvider,
      recluster,
      setLearningEnabled,
      applyTrace,
      ackTrace,
      removeTrace,
      clearTraces,
      recordAnswer,
      resetWordStats,
      resetGroupStats,
      seedExamples,
      importState,
      clearAll,
    }),
    [
      state,
      addStudyWord,
      createSynonymSet,
      updateSynonymSet,
      deleteSynonymSet,
      addWord,
      previewGrouping,
      deleteWord,
      deleteGroup,
      updateWord,
      mergeWordsIntoGroup,
      moveWordsToGroup,
      createGroup,
      moveWordInGroup,
      detachWord,
      setThreshold,
      updateDictProvider,
      addDictProvider,
      removeDictProvider,
      setPrimaryProvider,
      recluster,
      setLearningEnabled,
      applyTrace,
      ackTrace,
      removeTrace,
      clearTraces,
      recordAnswer,
      resetWordStats,
      resetGroupStats,
      seedExamples,
      importState,
      clearAll,
    ],
  )

  return (
    <LibraryContext.Provider value={api}>{children}</LibraryContext.Provider>
  )
}

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext)
  if (!ctx) throw new Error('useLibrary must be used inside LibraryProvider')
  return ctx
}
