import {test} from 'node:test'
import assert from 'node:assert/strict'
import type {LibraryState} from '../src/types/index'
import {mergeGroups,saveGroup,setGroupKind} from '../src/lib/grouping'
import {reconcileRelations,undoPatch} from '../src/lib/relations'
import {normalizeState} from '../src/lib/state'
import {deriveManagementView} from '../src/lib/managementView'

function fixture():LibraryState {
 const words=Object.fromEntries('abcdefxy'.split('').map((id,i)=>[id,{id,text:id,gloss:'含义'+id,meanings:[],groupId:id,addedAt:i,source:'manual' as const}]))
 return {words,groups:Object.fromEntries(Object.keys(words).map(id=>[id,{id,wordIds:[id],manual:false,kind:'single' as const,createdAt:1}])),synonymSets:{},customSets:{},stats:{a:{correct:8,wrong:1,level:3}},settings:{threshold:.7,dictProviders:[]},learning:{enabled:false,addCount:0,traces:[]},activity:{}}
}
function grouped(){const s=fixture();saveGroup(s,{kind:'shape'},{name:'形近',notes:'字形笔记',wordIds:['a','b','c']});saveGroup(s,{kind:'synonym'},{name:'意思',notes:'语义笔记',wordIds:['d','e']});return s}

test('two isolated words merge directly into a persistent provisional custom group and can be completely undone',()=>{
 const before=fixture(),after=structuredClone(before),result=mergeGroups(after,{ref:{kind:'isolated',id:'x'}},{kind:'isolated',id:'y'})
 assert.equal(result.groupRef.kind,'custom');assert.equal(result.needsTypeChoice,true)
 assert.equal(after.customSets![result.groupRef.id].pendingTypeChoice,true)
 saveGroup(after,result.groupRef,{name:'主题',notes:'保存编辑不替代类型选择',wordIds:after.customSets![result.groupRef.id].wordIds});assert.equal(after.customSets![result.groupRef.id].pendingTypeChoice,true)
 assert.deepEqual(new Set(after.customSets![result.groupRef.id].wordIds),new Set(['x','y']))
 assert.deepEqual(after.stats,before.stats)
 assert.equal(deriveManagementView(after).relations.x.isolated,false)
 const restored=undoPatch(before,after,after);assert.equal(deriveManagementView(restored).relations.x.isolated,true);assert.equal(Object.keys(restored.customSets!).length,0)
})

test('isolated into a typed card inherits its type; same-type whole cards union without losing notes',()=>{
 const s=grouped(),target=Object.values(s.groups).find(g=>g.wordIds.length>1)!
 const result=mergeGroups(s,{ref:{kind:'isolated',id:'x'}},{kind:'shape',id:target.id})
 assert.equal(result.groupRef.kind,'shape');assert.equal(result.needsTypeChoice,false);assert.equal(s.groups[target.id].wordIds.length,4)
 const second=saveGroup(s,{kind:'shape'},{name:'第二组',notes:'另一条笔记',wordIds:['f','y']})
 mergeGroups(s,{ref:second},{kind:'shape',id:target.id})
 assert.equal(s.groups[target.id].wordIds.length,6);assert.ok(!s.groups[second.id]);assert.match(s.groups[target.id].notes!,/另一条笔记/)
 assert.equal(s.words.y.groupId,target.id)
})

test('cross-type cards consume their selected relations but preserve unrelated memberships and every word',()=>{
 const s=grouped(),shape=Object.values(s.groups).find(g=>g.wordIds.length>1)!,near=Object.values(s.synonymSets)[0]
 const other=saveGroup(s,{kind:'synonym'},{name:'别的关系',notes:'保留',wordIds:['a','f']})
 const result=mergeGroups(s,{ref:{kind:'shape',id:shape.id}},{kind:'synonym',id:near.id})
 assert.equal(result.groupRef.kind,'custom');assert.equal(s.customSets![result.groupRef.id].wordIds.length,5)
 assert.deepEqual(s.synonymSets[other.id].wordIds,['a','f']);assert.ok(!s.synonymSets[near.id]);assert.equal(Object.keys(s.words).length,8)
 assert.match(s.customSets![result.groupRef.id].notes,/字形笔记/);assert.match(s.customSets![result.groupRef.id].notes,/语义笔记/)
 assert.deepEqual(s.stats.a,{correct:8,wrong:1,level:3})
})

test('dragging a member moves only that member, not its source card; explicit type choice persists and clears pending',()=>{
 const s=grouped(),shape=Object.values(s.groups).find(g=>g.wordIds.length>1)!,near=Object.values(s.synonymSets)[0]
 const result=mergeGroups(s,{ref:{kind:'shape',id:shape.id},wordId:'a'},{kind:'synonym',id:near.id})
 assert.deepEqual(s.groups[shape.id].wordIds,['b','c']);assert.deepEqual(new Set(s.customSets![result.groupRef.id].wordIds),new Set(['a','d','e']))
 const chosen=setGroupKind(s,result.groupRef,'synonym');assert.equal(chosen.kind,'synonym');assert.equal(s.synonymSets[chosen.id].pendingTypeChoice,false);assert.ok(!s.customSets![chosen.id])
 const view=deriveManagementView(s);assert.equal(view.relations.a.synonymId,chosen.id);assert.equal(view.relations.b.shapeId,shape.id)
})

test('same word can hold one of all three relationships; reassigning preserves the others and manual order',()=>{
 const s=fixture(),shape=saveGroup(s,{kind:'shape'},{name:'shape',notes:'',wordIds:['b','a']}),near=saveGroup(s,{kind:'synonym'},{name:'near',notes:'',wordIds:['a','c']}),custom=saveGroup(s,{kind:'custom'},{name:'theme',notes:'',wordIds:['a','d']})
 let rel=deriveManagementView(s).relations.a;assert.equal(rel.shapeId,shape.id);assert.equal(rel.synonymId,near.id);assert.equal(rel.customId,custom.id);assert.equal(rel.isolated,false)
 const next=saveGroup(s,{kind:'custom'},{name:'new',notes:'',wordIds:['e','a']})
 rel=deriveManagementView(s).relations.a;assert.equal(rel.customId,next.id);assert.equal(rel.shapeId,shape.id);assert.equal(rel.synonymId,near.id)
 assert.deepEqual(s.customSets![next.id].wordIds,['e','a']);assert.equal(deriveManagementView(s).relations.d.isolated,true)
})

test('invalid targets never partially mutate a draft; normalized custom data retains choice, notes and ordering',()=>{
 const s=fixture(),before=structuredClone(s);assert.throws(()=>mergeGroups(s,{ref:{kind:'isolated',id:'a'}},{kind:'custom',id:'missing'}));assert.deepEqual(s,before)
 const result=mergeGroups(s,{ref:{kind:'isolated',id:'a'}},{kind:'isolated',id:'b'});s.customSets![result.groupRef.id].notes='自定义笔记'
 const round=normalizeState(JSON.parse(JSON.stringify(s)),fixture());assert.deepEqual(round.customSets,s.customSets)
 round.customSets!.duplicate={...round.customSets![result.groupRef.id],id:'duplicate'};assert.throws(()=>reconcileRelations(round));assert.throws(()=>normalizeState(round,fixture()))
})
