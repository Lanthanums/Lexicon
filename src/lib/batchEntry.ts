import type {LibraryState, Word} from '../types/index'
import {coreGloss} from './groupNames'
import type {EntryPlan} from './entryPlan'

export const MAX_ENTRY_LENGTH = 256

export function normalizeEntryText(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ')
}

export function parseEntries(value:string){
  const seen=new Set<string>(), words:string[]=[], invalid:string[]=[], repeated:string[]=[]
  for(const raw of value.split(/[;；\r\n]+/)){
    const text=normalizeEntryText(raw)
    if(!text)continue
    if(text.length > MAX_ENTRY_LENGTH || !/^[a-z]+(?:[' -][a-z]+)*$/.test(text)){invalid.push(text);continue}
    if(seen.has(text)){repeated.push(text);continue}
    seen.add(text);words.push(text)
  }
  return {words,invalid,repeated}
}

export function indexEntryWords(state: LibraryState): Map<string, Word> {
  const index = new Map<string, Word>()
  for (const word of Object.values(state.words)) {
    const text = normalizeEntryText(word.text)
    if (!index.has(text)) index.set(text, word)
  }
  return index
}

export type EntryInput=Omit<Word,'id'|'groupId'|'addedAt'>
export function insertPlanned(draft:LibraryState,input:EntryInput,plan:EntryPlan,shapeId:string,nearId:string,id:string,now:number,date:string,words=indexEntryWords(draft)){
  const existing=words.get(normalizeEntryText(input.text))
  if(existing)return {id:existing.id,duplicate:true,shape:false,near:false}
  const option=plan.near.find(item=>item.id===nearId), gid=shapeId || 'single-'+id
  if(shapeId && !draft.groups[shapeId])throw new Error('词库已发生变化，请重新确认归组')
  const source = option?.moveFrom
  if (source && JSON.stringify(draft.synonymSets[source.id]) !== JSON.stringify(source)) {
    throw new Error('原近义组已发生变化，请重新确认')
  }
  if (option) {
    const selected = new Set(option.ids)
    const conflict = Object.values(draft.synonymSets).some(group =>
      group.id !== option.groupId && group.id !== source?.id && group.wordIds.some(wid => selected.has(wid)))
    if (conflict || option.ids.some(wid => !draft.words[wid])) throw new Error('近义组已发生变化，请重新确认')
  }
  if(option?.groupId && (!draft.synonymSets[option.groupId] || draft.synonymSets[option.groupId].wordIds.some(wid=>!option.ids.includes(wid))))throw new Error('近义组已发生变化，请重新确认')
  draft.words[id]={...input,id,groupId:gid,addedAt:now}
  words.set(normalizeEntryText(input.text), draft.words[id])
  draft.groups[gid]??={id:gid,wordIds:[],manual:false,createdAt:now}
  draft.groups[gid].wordIds.push(id)
  if(option){
    if (source) {
      const remaining = source.wordIds.filter(wid => !option.ids.includes(wid))
      if (remaining.length >= 2) {
        draft.synonymSets[source.id] = {...source, wordIds:remaining}
      } else {
        (draft.relationArchive ??= []).push(source)
        delete draft.synonymSets[source.id]
      }
    }
    const sid=option.groupId || 'near-'+id, prior=draft.synonymSets[sid]
    draft.synonymSets[sid]=prior ? {...prior,wordIds:[...new Set([...prior.wordIds,...option.ids,id])]} :
      {id:sid,name:coreGloss(input.gloss),nameSource:'auto',notes:'',provenance:option.note,wordIds:[...option.ids,id],createdAt:now}
  }
  const activity=draft.activity[date]??{added:0,reviewed:0}
  draft.activity[date]={...activity,added:activity.added+1}
  if(draft.learning.enabled)draft.learning.addCount++
  return {id,duplicate:false,shape:!!shapeId,near:!!option}
}
