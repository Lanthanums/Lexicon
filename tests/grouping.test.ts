import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {DragItem,GroupRef,LibraryState} from '../src/types/index'
import {DROP_KINDS,dropKindAt,mergeGroups,planDrop,recommendDropKinds,removeGroupMember,saveGroup,setGroupKind} from '../src/lib/grouping'
import {reconcileRelations,undoPatch} from '../src/lib/relations'
import {normalizeState} from '../src/lib/state'
import {deriveManagementView} from '../src/lib/managementView'
import {lookupSynonyms} from '../src/lib/synonyms'

function fixture():LibraryState {
 const words=Object.fromEntries('abcdefxy'.split('').map((id,i)=>[id,{id,text:id,gloss:'含义'+id,meanings:[],groupId:id,addedAt:i,source:'manual' as const}]))
 return {words,groups:Object.fromEntries(Object.keys(words).map(id=>[id,{id,wordIds:[id],manual:false,kind:'single' as const,createdAt:1}])),synonymSets:{},customSets:{},stats:{a:{correct:8,wrong:1,level:3}},settings:{threshold:.7,dictProviders:[]},learning:{enabled:false,addCount:0,traces:[]},activity:{}}
}
function grouped(){const s=fixture();saveGroup(s,{kind:'shape'},{name:'形近',notes:'字形笔记',wordIds:['a','b','c']});saveGroup(s,{kind:'synonym'},{name:'意思',notes:'语义笔记',wordIds:['d','e']});return s}

test('removing the first member cannot overwrite the group that grew from its singleton', () => {
 const before = fixture()
 delete before.groups.a
 delete before.groups.b
 delete before.groups.c
 const id = 'single-a'
 before.groups[id] = {id, wordIds:['a','b','c'], name:'字形辨析', notes:'保留笔记', manual:false, createdAt:1}
 for (const wordId of ['a','b','c']) before.words[wordId].groupId = id
 const draft = structuredClone(before)
 removeGroupMember(draft, {kind:'shape', id}, 'a')
 const after = normalizeState(reconcileRelations(draft), before)
 assert.deepEqual(after.groups[id], {...before.groups[id], kind:'confusable', wordIds:['b','c']})
 assert.notEqual(after.words.a.groupId, id)
 assert.equal(deriveManagementView(after).relations.a.isolated, true)
 assert.deepEqual(after.stats.a, before.stats.a)
 assert.deepEqual(undoPatch(before, after, after).groups[id].wordIds, ['a','b','c'])
})

test('two isolated words create the selected group, can be edited, and can be undone',()=>{
 const before=fixture(),after=structuredClone(before)
 const result=mergeGroups(after,{ref:{kind:'isolated',id:'x'}},{kind:'isolated',id:'y'},'custom')
 assert.equal(result.kind,'custom')
 assert.equal(after.customSets![result.id].pendingTypeChoice,undefined)
 assert.deepEqual(after.customSets![result.id].wordIds,['y','x'])
 const edited=structuredClone(after)
 assert.deepEqual(setGroupKind(edited,result,'synonym'),{kind:'synonym',id:result.id})
 assert.deepEqual(edited.synonymSets[result.id].wordIds,['y','x'])
 assert.deepEqual(after.stats,before.stats)
 const restored=undoPatch(before,after,after)
 assert.equal(deriveManagementView(restored).relations.x.isolated,true)
 assert.equal(Object.keys(restored.customSets!).length,0)
})

test('isolated into a typed card joins when the target type is selected; same-type whole cards union without losing notes',()=>{
 const s=grouped(),target=Object.values(s.groups).find(g=>g.wordIds.length>1)!
 const result=mergeGroups(s,{ref:{kind:'isolated',id:'x'}},{kind:'shape',id:target.id},'shape')
 assert.equal(result.kind,'shape');assert.equal(s.groups[target.id].wordIds.length,4)
 const second=saveGroup(s,{kind:'shape'},{name:'第二组',notes:'另一条笔记',wordIds:['f','y']})
 mergeGroups(s,{ref:second},{kind:'shape',id:target.id},'shape')
 assert.equal(s.groups[target.id].wordIds.length,6);assert.ok(!s.groups[second.id]);assert.match(s.groups[target.id].notes!,/另一条笔记/)
 assert.equal(s.words.y.groupId,target.id)
})

test('cross-type cards consume their selected relations but preserve unrelated memberships and every word',()=>{
 const s=grouped(),shape=Object.values(s.groups).find(g=>g.wordIds.length>1)!,near=Object.values(s.synonymSets)[0]
 const other=saveGroup(s,{kind:'synonym'},{name:'别的关系',notes:'保留',wordIds:['a','f']})
 const result=mergeGroups(s,{ref:{kind:'shape',id:shape.id}},{kind:'synonym',id:near.id},'custom')
 assert.equal(result.kind,'custom');assert.equal(s.customSets![result.id].wordIds.length,5)
 assert.deepEqual(s.synonymSets[other.id].wordIds,['a','f']);assert.ok(!s.synonymSets[near.id]);assert.equal(Object.keys(s.words).length,8)
 assert.match(s.customSets![result.id].notes,/字形笔记/);assert.match(s.customSets![result.id].notes,/语义笔记/)
 assert.deepEqual(s.stats.a,{correct:8,wrong:1,level:3})
})

test('dragging one word between shape and synonym cards preserves the source relationship and appends to the target',()=>{
 const before=grouped(),s=structuredClone(before)
 const shape=Object.values(s.groups).find(g=>g.wordIds.length>1)!,near=Object.values(s.synonymSets)[0]
 const shapeRef={kind:'shape' as const,id:shape.id},nearRef={kind:'synonym' as const,id:near.id}

 const joinedNear=mergeGroups(s,{ref:shapeRef,wordId:'a'},nearRef,'synonym')
 assert.deepEqual(joinedNear,nearRef)
 assert.deepEqual(s.groups[shape.id].wordIds,['a','b','c'])
 assert.deepEqual(s.synonymSets[near.id].wordIds,['d','e','a'])
 assert.deepEqual(undoPatch(before,s,s).synonymSets,before.synonymSets)

 const joinedShape=mergeGroups(s,{ref:nearRef,wordId:'d'},shapeRef,'shape')
 assert.deepEqual(joinedShape,shapeRef)
 assert.deepEqual(s.groups[shape.id].wordIds,['a','b','c','d'])
 assert.deepEqual(s.synonymSets[near.id].wordIds,['d','e','a'])
 assert.equal(Object.keys(s.customSets!).length,0)
 const view=deriveManagementView(normalizeState(s,before))
 for (const id of ['a','d']){
  assert.equal(view.relations[id].shapeId,shape.id)
  assert.deepEqual(view.relations[id].synonymIds,[near.id])
 }
})

test('same word can hold one of all three relationships; reassigning preserves the others and manual order',()=>{
 const s=fixture(),shape=saveGroup(s,{kind:'shape'},{name:'shape',notes:'',wordIds:['b','a']}),near=saveGroup(s,{kind:'synonym'},{name:'near',notes:'',wordIds:['a','c']}),custom=saveGroup(s,{kind:'custom'},{name:'theme',notes:'',wordIds:['a','d']})
 let rel=deriveManagementView(s).relations.a;assert.equal(rel.shapeId,shape.id);assert.deepEqual(rel.synonymIds,[near.id]);assert.equal(rel.customId,custom.id);assert.equal(rel.isolated,false)
 const next=saveGroup(s,{kind:'custom'},{name:'new',notes:'',wordIds:['e','a']})
 rel=deriveManagementView(s).relations.a;assert.equal(rel.customId,next.id);assert.equal(rel.shapeId,shape.id);assert.deepEqual(rel.synonymIds,[near.id])
 assert.deepEqual(s.customSets![next.id].wordIds,['e','a']);assert.equal(deriveManagementView(s).relations.d.isolated,true)
})

test('editing, dragging and removing a shared word affects only the selected synonym groups', () => {
 const state = grouped()
 const a = {kind:'synonym' as const, id:Object.keys(state.synonymSets)[0]}
 const b = saveGroup(state,{kind:'synonym'},{name:'另一义项',notes:'第二组笔记',wordIds:['d','y']})
 const c = saveGroup(state,{kind:'synonym'},{name:'第三义项',notes:'第三组笔记',wordIds:['x','f']})
 mergeGroups(state,{ref:a,wordId:'d'},c,'synonym')
 assert.deepEqual(state.synonymSets[a.id].wordIds,['d','e'])
 assert.deepEqual(state.synonymSets[b.id].wordIds,['d','y'])
 assert.deepEqual(state.synonymSets[c.id].wordIds,['x','f','d'])
 removeGroupMember(state,c,'d')
 const saved = reconcileRelations(state)
 assert.deepEqual(saved.synonymSets[c.id].wordIds,['x','f'])
 assert.deepEqual(deriveManagementView(saved).relations.d.synonymIds,[a.id,b.id])
})

test('invalid targets never partially mutate a draft; normalized custom data retains notes and ordering',()=>{
 const s=fixture(),before=structuredClone(s);assert.throws(()=>mergeGroups(s,{ref:{kind:'isolated',id:'a'}},{kind:'custom',id:'missing'},'custom'));assert.deepEqual(s,before)
 const result=mergeGroups(s,{ref:{kind:'isolated',id:'a'}},{kind:'isolated',id:'b'},'custom');s.customSets![result.id].notes='自定义笔记'
 const round=normalizeState(JSON.parse(JSON.stringify(s)),fixture());assert.deepEqual(round.customSets,s.customSets)
 round.customSets!.duplicate={...round.customSets![result.id],id:'duplicate'};assert.throws(()=>reconcileRelations(round));assert.throws(()=>normalizeState(round,fixture()))
})

test('all three choices apply the same rules across the nine card pairs and six member pairs', () => {
 const kinds = ['shape','synonym','isolated'] as const
 for (const fromKind of kinds) for (const targetKind of kinds) {
  for (const singleMember of (fromKind === 'isolated' ? [false] : [false,true])) {
   for (const chosen of DROP_KINDS) {
    const state = fixture()
    const from: GroupRef = fromKind === 'isolated' ? {kind:'isolated',id:'a'} :
      saveGroup(state,{kind:fromKind},{name:'来源',notes:'来源笔记',wordIds:['a','b']})
    const target: GroupRef = targetKind === 'isolated' ? {kind:'isolated',id:'d'} :
      saveGroup(state,{kind:targetKind},{name:'目标',notes:'目标笔记',wordIds:['d','e']})
    const source: DragItem = singleMember ? {ref:from,wordId:'a'} : {ref:from}
    const plan = planDrop(state,source,target,chosen)
    assert.ok(plan.allowed)
    const result = mergeGroups(state,source,target,chosen)
    const view = deriveManagementView(state)
    const find = (ref:GroupRef) => view.cards.find(card => card.kind === ref.kind && card.id === ref.id)
    assert.equal(result.kind,chosen)
    assert.deepEqual(find(result)?.words.map(word=>word.id),
      ['d', ...(targetKind==='isolated'?[]:['e']), 'a', ...(!singleMember&&fromKind!=='isolated'?['b']:[])])
    if(targetKind === chosen) assert.equal(result.id,target.id)
    if(targetKind !== 'isolated' && targetKind !== chosen) assert.equal(!!find(target),singleMember || fromKind === 'isolated')
    if(fromKind !== 'isolated' && result.id !== from.id) {
     assert.equal(!!find(from),singleMember && (fromKind !== chosen || chosen === 'synonym'))
    }
    assert.deepEqual(state.stats,fixture().stats)
    normalizeState(state,fixture())
   }
  }
 }
})

test('heretic and lethal examples preserve relationships outside the chosen type', () => {
 const state = fixture()
 for(const [id,text] of Object.entries({a:'heretic',b:'hermetic',c:'dissident',d:'fatal',e:'lethal',f:'leather'})){
  state.words[id].text=text
 }
 const spelling = saveGroup(state,{kind:'shape'},{name:'形近',notes:'字形',wordIds:['a','b']})
 const near = saveGroup(state,{kind:'synonym'},{name:'致命',notes:'用法',wordIds:['d','e']})
 const dissident = mergeGroups(state,{ref:spelling,wordId:'a'},{kind:'isolated',id:'c'},'synonym')
 const leather = mergeGroups(state,{ref:near,wordId:'e'},{kind:'isolated',id:'f'},'shape')
 assert.deepEqual(state.groups[spelling.id].wordIds,['a','b'])
 assert.deepEqual(state.synonymSets[dissident.id].wordIds,['c','a'])
 assert.deepEqual(state.synonymSets[near.id].wordIds,['d','e'])
 assert.deepEqual(state.groups[leather.id].wordIds,['f','e'])
})

test('exclusive memberships in uninvolved groups block only the affected drop choices', () => {
 const state = grouped()
 const source = {ref:{kind:'shape' as const,id:state.words.a.groupId}}
 const target = {kind:'synonym' as const,id:Object.keys(state.synonymSets)[0]}
 const otherShape = saveGroup(state,{kind:'shape'},{name:'别组',notes:'别组笔记',wordIds:['d','f']})
 const otherCustom = saveGroup(state,{kind:'custom'},{name:'别组',notes:'自定义笔记',wordIds:['a','x']})
 const before = structuredClone(state)
 assert.match(planDrop(state,source,target,'shape').preview,/其他形近组/)
 assert.match(planDrop(state,source,target,'custom').preview,/其他自定义组/)
 assert.throws(()=>mergeGroups(state,source,target,'shape'),/其他形近组/)
 assert.deepEqual(state,before)
 mergeGroups(state,source,target,'synonym')
 assert.deepEqual(state.groups[otherShape.id],before.groups[otherShape.id])
 assert.deepEqual(state.customSets![otherCustom.id],before.customSets![otherCustom.id])
})

test('self drops and duplicate memberships are invalid while an added relationship remains available', () => {
 const state=grouped()
 const shape: GroupRef={kind:'shape',id:state.words.a.groupId}
 const synonym=saveGroup(state,{kind:'synonym'},{name:'现有近义',notes:'',wordIds:['a','f']})
 assert.ok(DROP_KINDS.every(kind=>!planDrop(state,{ref:shape,wordId:'a'},shape,kind).allowed))
 assert.equal(planDrop(state,{ref:shape,wordId:'a'},synonym,'synonym').preview,'已在当前组')
 assert.equal(planDrop(state,{ref:shape,wordId:'a'},{kind:'isolated',id:'f'},'synonym').preview,'已有相同分组')
 assert.equal(planDrop(state,{ref:shape,wordId:'a'},synonym,'custom').allowed,true)
})

test('hit areas expand with hysteresis and keep a stationary pointer on the highlighted choice', () => {
 assert.equal(dropKindAt(.32,null),'shape')
 assert.equal(dropKindAt(.49,'shape'),'shape')
 assert.equal(dropKindAt(.51,'shape'),'synonym')
 assert.equal(dropKindAt(.49,'synonym'),'synonym')
 assert.equal(dropKindAt(.75,'synonym'),'custom')
 assert.equal(dropKindAt(.71,'custom'),'custom')
 assert.equal(dropKindAt(.24,'synonym'),'shape')
 for(let x=0;x<=1;x+=.01){
  for(const active of [null,...DROP_KINDS]){
   const entered=dropKindAt(x,active)
   assert.equal(dropKindAt(x,entered),entered)
  }
 }
})

test('recommendations use spelling and cached direct senses independently without starting a request', async t => {
 const state=fixture()
 const source={ref:{kind:'isolated' as const,id:'a'}}, target={kind:'isolated' as const,id:'b'}
 state.words.a.text='adviser';state.words.b.text='advisor'
 const query=t.mock.method(globalThis,'fetch',async()=>Response.json({
  lookup:{adviser:['sense']},
  senses:{sense:{id:'sense',pos:'n',definition:'a person who advises',terms:['adviser','advisor']}},
 }))
 const plans=()=>({
  shape:planDrop(state,source,target,'shape'),
  synonym:planDrop(state,source,target,'synonym'),
  custom:planDrop(state,source,target,'custom'),
 })
 assert.deepEqual(recommendDropKinds(state,source,target,plans()),['shape'])
 assert.equal(query.mock.callCount(),0)
 await lookupSynonyms('adviser')
 assert.deepEqual(recommendDropKinds(state,source,target,plans()),['shape','synonym'])
 state.words.b.text='dissident'
 assert.deepEqual(recommendDropKinds(state,source,target,plans()),[])
 assert.equal(query.mock.callCount(),1)
})
