import type {LibraryState, Word} from '../types/index'
import {coreGloss} from './groupNames'
import type {EntryPlan} from './entryPlan'

export function parseEntries(value:string){
  const seen=new Set<string>(), words:string[]=[], invalid:string[]=[], repeated:string[]=[]
  for(const raw of value.split(/[;；\n]+/)){
    const text=raw.trim().toLowerCase().replace(/[‘’]/g,"'").replace(/\s+/g,' ')
    if(!text)continue
    if(!/^[a-z][a-z'’ -]*$/.test(text)){invalid.push(text);continue}
    if(seen.has(text)){repeated.push(text);continue}
    seen.add(text);words.push(text)
  }
  return {words,invalid,repeated}
}

export type EntryInput=Omit<Word,'id'|'groupId'|'addedAt'>
export function insertPlanned(draft:LibraryState,input:EntryInput,plan:EntryPlan,shapeId:string,nearId:string,id:string,now:number,date:string){
  const existing=Object.values(draft.words).find(word=>word.text===input.text)
  if(existing)return {id:existing.id,duplicate:true,shape:false,near:false}
  const option=plan.near.find(item=>item.id===nearId), gid=shapeId || 'single-'+id
  if(shapeId && !draft.groups[shapeId])throw new Error('词库已发生变化，请重新确认归组')
  const occupied=new Set(Object.values(draft.synonymSets).flatMap(group=>group.id===option?.groupId?[]:group.wordIds))
  if(option?.ids.some(wid=>!draft.words[wid] || occupied.has(wid)))throw new Error('近义组已发生变化，请重新确认')
  if(option?.groupId && (!draft.synonymSets[option.groupId] || draft.synonymSets[option.groupId].wordIds.some(wid=>!option.ids.includes(wid))))throw new Error('近义组已发生变化，请重新确认')
  draft.words[id]={...input,id,groupId:gid,addedAt:now}
  draft.groups[gid]??={id:gid,wordIds:[],manual:false,createdAt:now}
  draft.groups[gid].wordIds.push(id)
  if(option){
    const sid=option.groupId || 'near-'+id, prior=draft.synonymSets[sid]
    draft.synonymSets[sid]=prior ? {...prior,wordIds:[...new Set([...prior.wordIds,...option.ids,id])]} :
      {id:sid,name:coreGloss(input.gloss),nameSource:'auto',notes:'',provenance:option.note,wordIds:[...option.ids,id],createdAt:now}
  }
  const activity=draft.activity[date]??{added:0,reviewed:0}
  draft.activity[date]={...activity,added:activity.added+1}
  if(draft.learning.enabled)draft.learning.addCount++
  return {id,duplicate:false,shape:!!shapeId,near:!!option}
}
