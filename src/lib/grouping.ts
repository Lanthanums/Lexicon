import type { DragItem, GroupKind, GroupRef, LibraryState, SynonymSet, WordGroup } from '../types/index'
import { coreGloss, userNotes } from './groupNames'
import { canMatchShape, normalizePhonetic, wordSimilarity } from './similarity'
import { cachedSynonymSenses, normalizeLemma } from './synonyms'

export const DROP_KINDS = ['shape', 'synonym', 'custom'] as const
export const DROP_LABELS: Record<GroupKind, string> = {shape: '形近组', synonym: '近义组', custom: '自定义组'}

export function dropKindAt(position: number, active: GroupKind | null): GroupKind {
  // Use the settled widths. An active zone keeps a wider hit area as the
  // animation runs, so a stationary pointer cannot cause a selection loop.
  const first = active === null ? 1 / 3 : active === 'shape' ? .5 : .25
  const second = active === null ? 2 / 3 : active === 'custom' ? .5 : .75
  return DROP_KINDS[position < first ? 0 : position < second ? 1 : 2]
}

type Group = WordGroup | SynonymSet
type NewRef = {kind:GroupKind;id?:undefined}
const uid=()=>crypto.randomUUID()
function table(state:LibraryState,kind:GroupKind):Record<string,Group> {
  return kind==='shape'?state.groups:kind==='synonym'?state.synonymSets:(state.customSets??{})
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
  if(ids.length < 2 || ids.some(id=>!state.words[id]))throw new Error('分组成员已改变，请重试')
  return [...ids]
}
function detach(state:LibraryState,kind:GroupKind,ids:string[],except?:string) {
  if (kind === 'synonym') return
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
export function removeGroupMember(state: LibraryState, ref: GroupRef, wordId: string): void {
  const group = requireGroup(state, ref)
  if (!state.words[wordId] || !group.wordIds.includes(wordId)) throw new Error('这个单词已不在本组中')
  consume(state, ref, wordId)
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
    const value:SynonymSet={...common,name,nameSource:source.nameSource??(name?'manual':'auto')}
    if(kind==='synonym')state.synonymSets[id]=value
    else (state.customSets??={})[id]=value
  }
}

type DropAction = 'join' | 'create' | 'merge' | 'extend'
type AllowedDrop = {
  allowed: true
  action: DropAction
  wordIds: string[]
  keepId?: string
  consumed: GroupRef[]
  movedFrom?: GroupRef
  preview: string
}
export type DropPlan = AllowedDrop | {allowed: false; preview: string}

const sameGroup = (a: GroupRef, b: GroupRef) => a.kind === b.kind && a.id === b.id

/** A single-word drop preserves group cards; whole-card drops combine the participating groups. */
export function planDrop(state: LibraryState, source: DragItem, target: GroupRef, kind: GroupKind): DropPlan {
  const from = source.ref
  if (sameGroup(from, target)) return {allowed: false, preview: '原卡片'}
  let fromIds: string[], targetIds: string[]
  try {
    fromIds = members(state, from)
    targetIds = members(state, target)
  } catch {
    return {allowed: false, preview: '卡片已变化'}
  }
  const wordId = source.wordId ?? (from.kind === 'isolated' ? from.id : undefined)
  if (wordId && !fromIds.includes(wordId)) return {allowed: false, preview: '单词已移出'}
  if (wordId && target.kind === kind && targetIds.includes(wordId)) return {allowed: false, preview: '已在当前组'}
  const wordIds = [...new Set([...targetIds, ...(wordId ? [wordId] : fromIds)])]
  if (wordIds.length < 2) return {allowed: false, preview: '需要两个不同的词'}

  const consumed = wordId ? [target].filter(ref => ref.kind === kind) :
    [from, target].filter(ref => ref.kind !== 'isolated')
  const keepId = target.kind === kind ? target.id : !wordId && from.kind === kind ? from.id : undefined
  const action = wordId ? (keepId ? 'join' : 'create') : target.kind === 'isolated' && keepId ? 'extend' : 'merge'
  const groupLabel = DROP_LABELS[kind]
  const selectedIds = new Set(wordIds)
  let movedFrom: GroupRef | undefined
  for (const group of Object.values(table(state, kind))) {
    if (group.wordIds.length < 2 || consumed.some(ref => ref.kind === kind && ref.id === group.id)) continue
    const overlapping = group.wordIds.filter(id => selectedIds.has(id))
    if (overlapping.length === wordIds.length && group.wordIds.length === wordIds.length) {
      return {allowed: false, preview: '已有相同分组'}
    }
    if (kind === 'synonym' || !overlapping.length) continue
    if (!wordId || overlapping.some(id => id !== wordId)) {
      return {allowed: false, preview: `其他${groupLabel}会受影响`}
    }
    movedFrom = {kind, id: group.id}
  }

  let preview: string
  if (action === 'join') preview = '加入当前组'
  else if (action === 'extend') preview = '独立词加入原组'
  else if (action === 'merge') preview = consumed.length === 2 ? '合并并替换两组' : '成组并替换原组'
  else preview = target.kind === 'isolated' ? '创建新组' : '与目标组成员另建'
  if (movedFrom) preview += ` · 移出原${groupLabel}`
  const preservesGroup = [from, target].some(ref => ref.kind !== 'isolated' &&
    !consumed.some(group => sameGroup(ref, group)) && (!movedFrom || !sameGroup(ref, movedFrom)))
  if (wordId && preservesGroup && !movedFrom) preview += ' · 保留已有组'
  return {allowed: true, action, wordIds, keepId, consumed, movedFrom, preview}
}

/** Use the same validation for preview and for the transaction that commits the selected type. */
export function mergeGroups(state: LibraryState, source: DragItem, target: GroupRef, kind: GroupKind): GroupRef {
  const plan = planDrop(state, source, target, kind)
  if (!plan.allowed) throw new Error(plan.preview)
  const groups = [...plan.consumed].reverse().map(ref => requireGroup(state, ref))
  const retained = plan.consumed.find(ref => ref.kind === kind && ref.id === plan.keepId)
  const inherited = retained ? requireGroup(state, retained) : groups[0]
  const notes = [...new Set(groups.map(group => group.notes ?? '').filter(userNotes))].join('\n\n')
  const provenance = [...new Set(groups.map(group => group.provenance ?? '').filter(Boolean))].join('\n\n')
  const id = plan.keepId ?? uid()
  if (plan.movedFrom) consume(state, plan.movedFrom, source.wordId ?? source.ref.id)
  for (const ref of plan.consumed) consume(state, ref)
  detach(state, kind, plan.wordIds)
  write(state, kind, id, plan.wordIds, {
    name: inherited?.name,
    notes,
    provenance,
    nameSource: inherited && 'nameSource' in inherited ? inherited.nameSource : undefined,
    createdAt: inherited?.createdAt,
  })
  repair(state)
  return {kind, id}
}

/** Check a bounded number of pairs and use stored group evidence for synonyms. */
export function recommendDropKinds(state: LibraryState, source: DragItem, target: GroupRef, plans: Record<GroupKind, DropPlan>): GroupKind[] {
  const recommended: GroupKind[] = []
  const shape = plans.shape
  if (shape.allowed) {
    const sourceIds = source.wordId ? [source.wordId] : members(state, source.ref)
    const targetIds = members(state, target)
    if (sourceIds.length * targetIds.length <= 64 && sourceIds.every(id => targetIds.some(other => {
      if (id === other) return false
      const a = state.words[id], b = state.words[other], threshold = state.settings.threshold
      return canMatchShape(a.text, b.text, normalizePhonetic(a.phonetic), normalizePhonetic(b.phonetic), threshold) &&
        wordSimilarity(a.text, b.text, a.phonetic, b.phonetic).score >= threshold
    }))) recommended.push('shape')
  }
  const synonym = plans.synonym
  if (synonym.allowed) {
    const ids = new Set(synonym.wordIds)
    const recorded = Object.values(state.synonymSets).some(group =>
      group.wordIds.length >= ids.size && group.wordIds.filter(id => ids.has(id)).length === ids.size)
    const terms = synonym.wordIds.map(id => normalizeLemma(state.words[id].text))
    const cached = terms.length <= 8 && terms.some(term => cachedSynonymSenses(term).some(sense =>
      !sense.related && terms.every(member => sense.terms.includes(member))))
    if (recorded || cached) recommended.push('synonym')
  }
  return recommended
}

export function setGroupKind(state:LibraryState,ref:GroupRef,kind:GroupKind):GroupRef {
  const group=structuredClone(requireGroup(state,ref)),ids=[...group.wordIds]
  if(ref.kind===kind) return ref
  const id = Object.hasOwn(table(state,kind), ref.id) ? uid() : ref.id
  consume(state,ref);detach(state,kind,ids)
  write(state,kind,id,ids,group)
  repair(state)
  return {kind,id}
}

export function saveGroup(state:LibraryState,ref:GroupRef|NewRef,input:{name:string;notes:string;wordIds:string[];nameSource?:'auto'|'manual'}):GroupRef {
  const ids=[...new Set(input.wordIds)]
  if(ids.some(id=>!state.words[id]))throw new Error('有单词已被删除，请重新选择')
  if(ids.length<2)throw new Error('关系组至少需要两个单词')
  const kind:GroupKind=ref.kind==='isolated'?'custom':ref.kind
  const old=ref.id && ref.kind!=='isolated'?structuredClone(requireGroup(state,ref as GroupRef)):undefined
  const id=ref.id && ref.kind!=='isolated'?ref.id:uid()
  detach(state,kind,ids,id)
  write(state,kind,id,ids,{...old,name:input.name,notes:input.notes,nameSource:input.nameSource??(input.name.trim()?'manual':'auto')})
  repair(state)
  return {kind,id}
}
