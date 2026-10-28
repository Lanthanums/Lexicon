import type { LibraryState, Word, WordGroup, WordStats, SynonymSet } from '../types/index'

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Validate before replacing a library; legacy v1 backups migrate without rewriting IDs. */
export function normalizeState(value: unknown, defaults: LibraryState): LibraryState {
  if (!record(value) || !record(value.words) || !record(value.groups)) throw new Error('词库格式不正确')
  const words: Record<string, Word> = {}
  const groups: Record<string, WordGroup> = {}
  for (const [id, w] of Object.entries(value.words)) {
    if (!record(w) || w.id !== id || typeof w.text !== 'string' || !w.text.trim() ||
      typeof w.gloss !== 'string' || typeof w.groupId !== 'string' || !finite(w.addedAt) ||
      !Array.isArray(w.meanings) || !w.meanings.every(m => record(m) && typeof m.pos === 'string' && typeof m.en === 'string' && (m.zh === undefined || typeof m.zh === 'string')) ||
      !['api', 'manual'].includes(String(w.source))) throw new Error('单词数据不完整')
    for (const key of ['phonetic', 'example', 'usageNote']) if (w[key] !== undefined && typeof w[key] !== 'string') throw new Error('单词附加信息格式错误')
    words[id] = w as unknown as Word
  }
  const seen = new Set<string>()
  for (const [id, g] of Object.entries(value.groups)) {
    if (!record(g) || g.id !== id || !Array.isArray(g.wordIds) || typeof g.manual !== 'boolean' || !finite(g.createdAt) ||
      (g.kind !== undefined && g.kind !== 'single' && g.kind !== 'confusable')) throw new Error('分组格式错误')
    for (const wid of g.wordIds) {
      if (typeof wid !== 'string' || !words[wid] || words[wid].groupId !== id || seen.has(wid)) throw new Error('单词与分组关系不一致')
      seen.add(wid)
    }
    groups[id] = g as unknown as WordGroup
  }
  if (seen.size !== Object.keys(words).length) throw new Error('存在没有分组的单词')
  const synonymSets: Record<string, SynonymSet> = {}
  if (value.synonymSets !== undefined && !record(value.synonymSets)) throw new Error('近义词群格式错误')
  for (const [id, g] of Object.entries(value.synonymSets ?? {})) {
    if (!record(g) || g.id !== id || typeof g.name !== 'string' || typeof g.notes !== 'string' || !finite(g.createdAt) ||
      !Array.isArray(g.wordIds) || !g.wordIds.every(w => typeof w === 'string' && !!words[w])) throw new Error('近义词群关系错误')
    synonymSets[id] = { ...g, wordIds: [...new Set(g.wordIds)] } as unknown as SynonymSet
  }
  const stats: Record<string, WordStats> = {}
  if (value.stats !== undefined && !record(value.stats)) throw new Error('学习记录格式错误')
  for (const [id, st] of Object.entries(value.stats ?? {})) {
    if (!words[id]) continue
    if (!record(st) || !finite(st.correct) || !finite(st.wrong) || !finite(st.level) || st.correct < 0 || st.wrong < 0 || st.level < 0 || st.level > 5 ||
      (st.lastSeen !== undefined && !finite(st.lastSeen)) || (st.dueAt !== undefined && !finite(st.dueAt)) ||
      (st.lastResult !== undefined && typeof st.lastResult !== 'boolean')) throw new Error('学习记录格式错误')
    stats[id] = st as unknown as WordStats
  }
  const settings = record(value.settings) ? value.settings : {}
  if (settings.threshold !== undefined && (!finite(settings.threshold) || settings.threshold < 0.5 || settings.threshold > 0.95)) throw new Error('阈值格式错误')
  if (settings.dictProviders !== undefined && (!Array.isArray(settings.dictProviders) || !settings.dictProviders.every(p => record(p) && typeof p.id === 'string' && typeof p.label === 'string' && typeof p.enabled === 'boolean' && ['appId', 'apiKey', 'endpoint', 'glossPath'].every(k => p[k] === undefined || typeof p[k] === 'string')))) throw new Error('词典配置错误')
  const learning = record(value.learning) ? value.learning : defaults.learning
  if (typeof learning.enabled !== 'boolean' || !finite(learning.addCount) || !Array.isArray(learning.traces) || !learning.traces.every(t => record(t) && typeof t.id === 'string' && finite(t.at) && finite(t.suggested) && finite(t.previous) && finite(t.f1) && finite(t.wordCount) && finite(t.groupCount) && typeof t.applied === 'boolean')) throw new Error('阈值学习记录错误')
  const activity = record(value.activity) ? value.activity : {}
  if (!Object.values(activity).every(a => record(a) && finite(a.added) && finite(a.reviewed))) throw new Error('活动记录错误')
  return {
    words, groups, stats, synonymSets,
    settings: { ...defaults.settings, ...settings } as LibraryState['settings'],
    learning: learning as unknown as LibraryState['learning'],
    activity: activity as LibraryState['activity'],
  }
}
