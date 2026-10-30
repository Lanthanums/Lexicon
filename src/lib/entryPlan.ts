import {groupTitle} from './groupNames'
import type { LibraryState, Word } from '../types/index'
import { wordSimilarity } from './similarity'
import { lookupSynonyms, normalizeLemma, verifySynonyms } from './synonyms'
export interface ShapeOption { id: string; score: number; label: string }
export interface NearOption { id: string; score: number; label: string; ids: string[]; groupId?: string; note: string }
export interface EntryPlan { shape: ShapeOption[]; near: NearOption[]; nearStatus: string }
export const isTie = (items: {score:number}[]) => items.length > 1 && items[0].score-items[1].score <= .05

export async function planEntry(input: Pick<Word,'text'|'phonetic'>, state: LibraryState, signal: AbortSignal): Promise<EntryPlan> {
  const shapeMap = new Map<string, ShapeOption>()
  for (const word of Object.values(state.words)) {
    const {score} = wordSimilarity(input.text, word.text, input.phonetic, word.phonetic)
    if (score < state.settings.threshold) continue
    const group = state.groups[word.groupId]
    const option = {id:word.groupId, score, label:group?.name || (group?.wordIds.map(id=>state.words[id]?.text).filter(Boolean).join(' / ') ?? word.text)}
    if (!shapeMap.has(option.id) || shapeMap.get(option.id)!.score < score) shapeMap.set(option.id,option)
  }
  const plan: EntryPlan = { shape:[...shapeMap.values()].sort((a,b)=>b.score-a.score), near:[], nearStatus:'未找到近义关系' }
  try {
    const senses = await lookupSynonyms(input.text)
    if (signal.aborted) throw new DOMException('Aborted','AbortError')
    let supported: Set<string> | undefined
    if (state.settings.synonymMode === 'verified' && senses.length) supported = await verifySynonyms(input.text, state.settings.synonymApiKey ?? '', signal)
    const byLemma = new Map(Object.values(state.words).map(word=>[normalizeLemma(word.text),word]))
    const owner = new Map(Object.values(state.synonymSets).flatMap(group=>group.wordIds.map(id=>[id,group.id] as const)))
    for (const sense of senses) {
      const matches = sense.terms.filter(term=>term!==normalizeLemma(input.text) && (!supported || supported.has(term))).map(term=>byLemma.get(term)).filter((word):word is Word=>!!word)
      const free = matches.filter(word=>!owner.has(word.id)).map(word=>word.id)
      const targets = [...new Set(matches.map(word=>owner.get(word.id)).filter((id):id is string=>!!id))].filter(id=>state.synonymSets[id].wordIds.every(wid=>sense.terms.includes(normalizeLemma(state.words[wid].text)) && (!supported || supported.has(normalizeLemma(state.words[wid].text)))))
      for (const target of targets.length ? targets : [undefined]) {
        const ids = [...new Set([...(target ? state.synonymSets[target].wordIds : []),...free])]
        if (!ids.length) continue
        plan.near.push({id:sense.id+(target??''),score:Math.min(.99,.75+.2*ids.length/Math.max(1,sense.terms.length-1)),label:target ? groupTitle(state,{kind:'synonym',id:target}) : [input.text,...ids.map(id=>state.words[id].text)].join(' / '),ids,groupId:target,note:`来源：Open English WordNet 2025 · ${sense.id}\n义项：${sense.definition}${supported ? '\nDatamuse 词形关系支持；不保证当前义项可任意互换。' : ''}`})
      }
    }
    const unique = new Map<string,NearOption>()
    for (const option of plan.near) {
      const key = (option.groupId??'')+option.ids.slice().sort().join('|')
      const prior = unique.get(key)
      if (!prior || prior.score<option.score) unique.set(key,option)
    }
    plan.near=[...unique.values()].sort((a,b)=>b.score-a.score)
    if (plan.near.length) plan.nearStatus = '近义词归组成功'
  } catch(error) {
    if (signal.aborted) throw error
    plan.nearStatus = state.settings.synonymMode === 'verified' ? '近义联网校验未完成，可稍后在归组管理中调整' : '离线近义检索未完成，可稍后调整'
  }
  return plan
}
