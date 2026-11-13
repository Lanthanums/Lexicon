import {groupTitle} from './groupNames'
import type { LibraryState, SynonymSet, Word } from '../types/index'
import { canMatchShape, normalizePhonetic, wordSimilarity } from './similarity'
import { lookupSynonyms, normalizeLemma, verifySynonyms } from './synonyms'
export interface ShapeOption { id: string; score: number; label: string; memberIds: string[] }
export interface NearOption {
  id: string
  score: number
  label: string
  ids: string[]
  groupId?: string
  note: string
  moveFrom?: SynonymSet
}
export interface EntryPlan { shape: ShapeOption[]; near: NearOption[]; nearStatus: string }
export const isTie = (items: {score:number}[]) => items.length > 1 && items[0].score-items[1].score <= .05

export async function planEntry(input: Pick<Word,'text'|'phonetic'>, state: LibraryState, signal: AbortSignal): Promise<EntryPlan> {
  const shapeMap = new Map<string, number>()
  const pronunciation = normalizePhonetic(input.phonetic)
  const threshold = state.settings.threshold
  for (const word of Object.values(state.words)) {
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
    let supported: Set<string> | undefined
    if (state.settings.synonymMode === 'verified' && senses.length) supported = await verifySynonyms(input.text, state.settings.synonymApiKey ?? '', signal)
    const lemma = normalizeLemma(input.text)
    const byLemma = new Map(Object.values(state.words).map(word=>[normalizeLemma(word.text),word]))
    const owner = new Map(Object.values(state.synonymSets).flatMap(group=>group.wordIds.map(id=>[id,group.id] as const)))
    for (const sense of senses) {
      const matches = sense.terms.filter(term=>term!==lemma && (!supported || supported.has(term))).map(term=>byLemma.get(term)).filter((word):word is Word=>!!word)
      const free = matches.filter(word=>!owner.has(word.id)).map(word=>word.id)
      const targets = [...new Set(matches.map(word=>owner.get(word.id)).filter((id):id is string=>!!id))].filter(id=>state.synonymSets[id].wordIds.every(wid=>sense.terms.includes(normalizeLemma(state.words[wid].text)) && (!supported || supported.has(normalizeLemma(state.words[wid].text)))))
      const note = `来源：Open English WordNet 2025 · ${sense.id}\n${sense.related ? '相近义项' : '义项'}：${sense.definition}${supported ? '\nDatamuse 词形关系支持；不保证当前义项可任意互换。' : ''}`
      const pairLabel = (ids: string[]) => [input.text, ...ids.map(id => state.words[id].text)].join(' / ')
      const score = (ids: string[]) => {
        const coverage = ids.length / Math.max(1, sense.terms.length - 1)
        return sense.related ? .55 + .14 * coverage : .75 + .2 * coverage
      }

      for (const target of targets.length ? targets : [undefined]) {
        const ids = [...new Set([...(target ? state.synonymSets[target].wordIds : []), ...free])]
        if (!ids.length) continue
        plan.near.push({
          id: sense.id + (target ?? ''), score: score(ids),
          label: target ? groupTitle(state, {kind:'synonym', id:target}) : pairLabel(ids),
          ids, groupId: target, note,
        })
      }

      const incompatible = new Map<string, string[]>()
      for (const word of matches) {
        const groupId = owner.get(word.id)
        if (!groupId || targets.includes(groupId)) continue
        // Leave existing groups alone when online verification only corroborates a subset.
        if (supported && state.synonymSets[groupId].wordIds.some(id =>
          !supported.has(normalizeLemma(state.words[id].text)))) continue
        const ids = incompatible.get(groupId) ?? []
        ids.push(word.id)
        incompatible.set(groupId, ids)
      }
      for (const [groupId, moving] of incompatible) {
        const source = state.synonymSets[groupId]
        const ids = [...free, ...moving]
        const title = groupTitle(state, {kind:'synonym', id:groupId})
        const names = moving.map(id => state.words[id].text).join('、')
        plan.near.push({
          id: `${sense.id}:move:${groupId}`, score: score(ids),
          label: `新建 ${pairLabel(ids)}（从「${title}」移出 ${names}）`,
          ids, note, moveFrom: source,
        })
      }
    }
    const unique = new Map<string,NearOption>()
    for (const option of plan.near) {
      const key = JSON.stringify([option.groupId, option.moveFrom?.id, [...option.ids].sort()])
      const prior = unique.get(key)
      if (!prior || prior.score<option.score) unique.set(key,option)
    }
    plan.near = [...unique.values()].sort((a,b) =>
      Number(!!a.moveFrom) - Number(!!b.moveFrom) || b.score - a.score)
    if (plan.near.some(option => !option.moveFrom)) plan.nearStatus = '已找到近义关系'
    else if (plan.near.length) plan.nearStatus = '近义关系待确认'
  } catch(error) {
    if (signal.aborted) throw error
    plan.nearStatus = state.settings.synonymMode === 'verified' ? '近义联网校验未完成，可稍后在归组管理中调整' : '离线近义检索未完成，可稍后调整'
  }
  return plan
}
