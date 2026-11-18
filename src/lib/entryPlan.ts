import type { LibraryState, Word } from '../types/index'
import { canMatchShape, normalizePhonetic, wordSimilarity } from './similarity'
import { createSynonymVerifier, lookupSynonyms, normalizeLemma, type SynonymSense, type SynonymVerifier } from './synonyms'
export interface ShapeOption { id: string; score: number; label: string; memberIds: string[] }
export interface NearOption {
  ids: string[]
  groupId?: string
  note: string
}
export interface EntryPlan {
  shape: ShapeOption[]
  near: NearOption[]
  nearStatus: string
  /** Set when synonym lookup could not finish; shape grouping is unaffected. */
  nearIssue?: 'verify' | 'offline'
}
export const isTie = (items: {score:number}[]) => items.length > 1 && items[0].score-items[1].score <= .05

export async function planEntry(
  input: Pick<Word, 'text' | 'phonetic'>,
  state: LibraryState,
  signal: AbortSignal,
  excludedShape?: ReadonlySet<string>,
  verifier?: SynonymVerifier,
): Promise<EntryPlan> {
  const shapeMap = new Map<string, number>()
  const pronunciation = normalizePhonetic(input.phonetic)
  const threshold = state.settings.threshold
  for (const word of Object.values(state.words)) {
    if (excludedShape?.has(word.id)) continue
    if (!canMatchShape(input.text, word.text, pronunciation, normalizePhonetic(word.phonetic), threshold)) continue
    const {score} = wordSimilarity(input.text, word.text, input.phonetic, word.phonetic)
    if (score >= threshold && score > (shapeMap.get(word.groupId) ?? -1)) shapeMap.set(word.groupId, score)
  }
  const shape = [...shapeMap].map(([id, score]) => {
    const group = state.groups[id]
    const label = group.name || group.wordIds.slice(0, 6).map(wid => state.words[wid].text).join(' / ') +
      (group.wordIds.length > 6 ? ` …（${group.wordIds.length} 词）` : '')
    return {id, score, label, memberIds: [...group.wordIds]}
  }).sort((a,b) => b.score - a.score)
  const plan: EntryPlan = { shape, near: [], nearStatus: '未找到近义关系' }
  try {
    const senses = await lookupSynonyms(input.text)
    if (signal.aborted) throw new DOMException('Aborted','AbortError')
    if (!senses.length) return plan
    const lemma = normalizeLemma(input.text)
    const byLemma = new Map(Object.values(state.words).map(word => [normalizeLemma(word.text), word.id]))
    const candidates = senses.map(sense => ({
      sense, terms: sense.terms.filter(term => term !== lemma && byLemma.has(term)),
    })).filter(candidate => candidate.terms.length)
    // Verification can only remove offline candidates, so skip the network when none exist.
    if (!candidates.length) return plan
    const supported = state.settings.synonymMode === 'verified'
      ? await (verifier ?? createSynonymVerifier(state.settings.synonymApiKey ?? '', signal)).verify(input.text, signal)
      : undefined
    if (signal.aborted) throw new DOMException('Aborted','AbortError')
    const groupsByWord = new Map<string, string[]>()
    for (const group of Object.values(state.synonymSets)) {
      for (const id of group.wordIds) {
        const groups = groupsByWord.get(id) ?? []
        groups.push(group.id)
        groupsByWord.set(id, groups)
      }
    }
    const matchesBySense = candidates.map(({sense, terms}) => ({
      sense,
      ids: new Set(terms.filter(term => !supported || supported.has(term)).map(term => byLemma.get(term)!)),
    })).filter(match => match.ids.size)
    const existing = new Map<string, NearOption>()
    const newGroups = new Map<string, NearOption>()
    // Prefer the direct sense when two WordNet entries describe the same members.
    matchesBySense.sort((a, b) => Number(!!a.sense.related) - Number(!!b.sense.related))
    for (const {sense, ids} of matchesBySense) {
      const targets = new Set([...ids].flatMap(id => groupsByWord.get(id) ?? []))
      const compatible = [...targets].filter(id => state.synonymSets[id].wordIds.every(wid => ids.has(wid)))
      const note = makeNote(sense, !!supported)
      if (compatible.length) {
        for (const groupId of compatible) {
          if (!existing.has(groupId)) existing.set(groupId, {groupId, ids: [...state.synonymSets[groupId].wordIds], note})
        }
        continue
      }
      if (sense.related && matchesBySense.some(match => !match.sense.related && [...ids].every(id => match.ids.has(id)))) continue
      const key = JSON.stringify([...ids].sort())
      if (!newGroups.has(key)) newGroups.set(key, {ids: [...ids], note})
    }
    plan.near = [...existing.values(), ...newGroups.values()]
    if (plan.near.length) plan.nearStatus = '已找到近义关系'
  } catch(error) {
    if (signal.aborted) throw error
    const verified = state.settings.synonymMode === 'verified'
    plan.nearIssue = verified ? 'verify' : 'offline'
    plan.nearStatus = verified ? '近义联网校验未完成，可稍后在归组管理中调整' : '离线近义检索未完成，可稍后调整'
  }
  return plan
}

/**
 * Start the slow parts of planning early: load the offline shard and, in verified
 * mode, request verification only when the library (or this batch) has a candidate.
 */
export async function prefetchEntry(text: string, state: LibraryState, verifier: SynonymVerifier, batchTexts: Iterable<string> = []): Promise<void> {
  try {
    const senses = await lookupSynonyms(text)
    if (state.settings.synonymMode !== 'verified' || !senses.length) return
    const lemma = normalizeLemma(text)
    const known = new Set([...Object.values(state.words).map(word => normalizeLemma(word.text)), ...[...batchTexts].map(normalizeLemma)])
    if (senses.some(sense => sense.terms.some(term => term !== lemma && known.has(term)))) await verifier.verify(text)
  } catch { /* planning reports the failure when it needs the result */ }
}

function makeNote(sense: SynonymSense, verified: boolean): string {
  return `来源：Open English WordNet 2025 · ${sense.id}\n${sense.related ? '相近义项' : '义项'}：${sense.definition}${verified ? '\nDatamuse 词形关系支持；不保证当前义项可任意互换。' : ''}`
}
