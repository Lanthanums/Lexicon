import type { DragItem, GroupKind, GroupRef, LibraryState, SynonymSet, WordGroup } from '../types/index'
import { coreGloss, userNotes } from './groupNames'

type Group = WordGroup | SynonymSet
type NewRef = {kind:GroupKind;id?:undefined}
const uid=()=>crypto.randomUUID()
function table(state:LibraryState,kind:GroupKind):Record<string,Group> {
  return kind==='shape'?state.groups:kind==='synonym'?state.synonymSets:(state.customSets??={})
}
function requireGroup(state:LibraryState,ref:GroupRef):Group {
  if(ref.kind==='isolated')throw new Error('请选择一个关系组')
  const group=table(state,ref.kind)[ref.id]
  if(!group)throw new Error('这个分组已发生变化，请重试')
  return group
}
function members(state:LibraryState,ref:GroupRef):string[] {
  if(ref.kind==='isolated') {if(!state.words[ref.id])throw new Error('这个单词已不存在');return [ref.id]}
  const ids=requireGroup(state,ref).wordIds
  if(ids.some(id=>!state.words[id]))throw new Error('分组成员已改变，请重试')
  return [...ids]
}
function detach(state:LibraryState,kind:GroupKind,ids:string[],except?:string) {
  const selected=new Set(ids)
  for(const group of Object.values(table(state,kind))) {
    if(group.id!==except)group.wordIds=group.wordIds.filter(id=>!selected.has(id))
  }
}
function consume(state:LibraryState,ref:GroupRef,wordId?:string) {
  if(ref.kind==='isolated')return
  const group=requireGroup(state,ref)
  if(wordId)group.wordIds=group.wordIds.filter(id=>id!==wordId)
  else delete table(state,ref.kind)[ref.id]
}
/** Make shape storage valid before normalizeState checks the foreign keys. */
function repair(state:LibraryState) {
  const owners=new Map<string,string>()
  for(const group of Object.values(state.groups)) {
    group.wordIds=[...new Set(group.wordIds)].filter(id=>!!state.words[id])
    if(group.wordIds.length>1) {
      group.kind='confusable'
      for(const id of group.wordIds) {
        if(owners.has(id))throw new Error('同一单词不能加入两个形近组')
        owners.set(id,group.id)
      }
    }
  }
  for(const [id,group] of Object.entries(state.groups)) {
    if(group.wordIds.length>1)continue
    group.wordIds=group.wordIds.filter(wid=>!owners.has(wid))
    if(!group.wordIds.length){delete state.groups[id];continue}
    group.kind='single';owners.set(group.wordIds[0],id)
  }
  for(const word of Object.values(state.words)) {
    let id=owners.get(word.id)
    if(!id) {id=uid();state.groups[id]={id,wordIds:[word.id],kind:'single',manual:false,createdAt:word.addedAt}}
    word.groupId=id
  }
  for(const kind of ['synonym','custom'] as const) {
    for(const [id,group] of Object.entries(table(state,kind))) {
      group.wordIds=[...new Set(group.wordIds)].filter(wid=>!!state.words[wid])
      if(group.wordIds.length<2)delete table(state,kind)[id]
    }
  }
}
function groupName(state:LibraryState,kind:GroupKind,ids:string[],name?:string):string {
  if(name?.trim())return name.trim().replace(/^(?:形近组|近义组|自定义组)\s*[·•:：]?\s*/,'').replace(/\s*[·•]\s*近义词\s*$/,'')
  return kind==='synonym'?(ids.map(id=>coreGloss(state.words[id].gloss)).find(Boolean)||'未命名'):''
}
function write(state:LibraryState,kind:GroupKind,id:string,ids:string[],source:Partial<SynonymSet&WordGroup>) {
  const derived=groupName(state,kind,ids,source.name)
  const name=source.nameSource==='auto' && source.name ? (coreGloss(derived)||groupName(state,kind,ids)) : derived
  const common={id,wordIds:[...new Set(ids)],createdAt:source.createdAt??Date.now(),notes:source.notes??'',provenance:source.provenance}
  if(kind==='shape')state.groups[id]={...common,name:name||undefined,manual:true,kind:'confusable'}
  else {
    const value:SynonymSet={...common,name,nameSource:source.nameSource??(name?'manual':'auto'),pendingTypeChoice:source.pendingTypeChoice??false}
    if(kind==='synonym')state.synonymSets[id]=value
    else (state.customSets??={})[id]=value
  }
}

export function mergeGroups(state:LibraryState,source:DragItem,target:GroupRef,kind?:GroupKind):{groupRef:GroupRef;needsTypeChoice:boolean} {
  const original=members(state,source.ref),targetIds=members(state,target)
  if(source.wordId && !original.includes(source.wordId))throw new Error('拖动的单词已移出原卡片')
  const same=source.ref.kind===target.kind && source.ref.id===target.id
  if(same || (source.wordId && targetIds.includes(source.wordId)))return {groupRef:target,needsTypeChoice:false}
  const fromIds=source.wordId?[source.wordId]:original
  const ids=[...new Set([...targetIds,...fromIds])]
  if(ids.length<2)throw new Error('至少需要两个不同的单词')
  const inferred=source.ref.kind===target.kind && target.kind!=='isolated'?target.kind:
    source.ref.kind==='isolated' && target.kind!=='isolated'?target.kind:
    target.kind==='isolated' && source.ref.kind!=='isolated'?source.ref.kind:undefined
  const resultKind=kind??inferred??'custom'
  const pending=!kind && !inferred
  const from=source.ref.kind==='isolated'?undefined:structuredClone(requireGroup(state,source.ref))
  const into=target.kind==='isolated'?undefined:structuredClone(requireGroup(state,target))
  const id=target.kind===resultKind?target.id:uid()
  const notes=[into?.notes,...(!source.wordId?[from?.notes]:[])].filter((note):note is string=>!!note&&!!userNotes(note)).filter((note,i,all)=>all.indexOf(note)===i).join('\n\n')
  const provenance=[into?.provenance,from?.provenance].filter(Boolean).join('\n\n')
  consume(state,source.ref,source.wordId);consume(state,target)
  detach(state,resultKind,ids)
  write(state,resultKind,id,ids,{name:into?.name,notes,provenance,nameSource:into && 'nameSource' in into?into.nameSource:undefined,pendingTypeChoice:pending || (resultKind==='custom' && !!into && 'pendingTypeChoice' in into && !!into.pendingTypeChoice),createdAt:into?.createdAt})
  repair(state)
  return {groupRef:{kind:resultKind,id},needsTypeChoice:pending}
}

export function setGroupKind(state:LibraryState,ref:GroupRef,kind:GroupKind):GroupRef {
  const group=structuredClone(requireGroup(state,ref)),ids=[...group.wordIds]
  if(ref.kind===kind) {
    if('pendingTypeChoice' in table(state,kind)[ref.id])(table(state,kind)[ref.id] as SynonymSet).pendingTypeChoice=false
    return ref
  }
  consume(state,ref);detach(state,kind,ids)
  write(state,kind,ref.id,ids,{...group,pendingTypeChoice:false})
  repair(state)
  return {kind,id:ref.id}
}

export function saveGroup(state:LibraryState,ref:GroupRef|NewRef,input:{name:string;notes:string;wordIds:string[]}):GroupRef {
  const ids=[...new Set(input.wordIds)]
  if(ids.some(id=>!state.words[id]))throw new Error('有单词已被删除，请重新选择')
  if(ids.length<2)throw new Error('关系组至少需要两个单词')
  const kind:GroupKind=ref.kind==='isolated'?'custom':ref.kind
  const old=ref.id && ref.kind!=='isolated'?structuredClone(requireGroup(state,ref as GroupRef)):undefined
  const id=ref.id && ref.kind!=='isolated'?ref.id:uid()
  detach(state,kind,ids,id)
  write(state,kind,id,ids,{...old,name:input.name,notes:input.notes,nameSource:input.name.trim()?'manual':'auto',pendingTypeChoice:old && 'pendingTypeChoice' in old ? old.pendingTypeChoice : false})
  repair(state)
  return {kind,id}
}
