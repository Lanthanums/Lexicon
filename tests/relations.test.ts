import {test} from 'node:test'
import assert from 'node:assert/strict'
import {reconcileRelations,undoPatch,restoreDeletedWord} from '../src/lib/relations'
import {deriveManagementView,managementWords} from '../src/lib/managementView'
import type {LibraryState} from '../src/types/index'
const fixture=():LibraryState=>({words:{a:{id:'a',text:'calm',gloss:'平静',meanings:[],groupId:'g',addedAt:1,source:'manual'},b:{id:'b',text:'balm',gloss:'膏',meanings:[],groupId:'g',addedAt:2,source:'manual'},c:{id:'c',text:'serene',gloss:'宁静',meanings:[],groupId:'c',addedAt:3,source:'manual'}},groups:{g:{id:'g',wordIds:['a','b'],manual:true,createdAt:1},c:{id:'c',wordIds:['c'],kind:'single',manual:false,createdAt:3}},synonymSets:{s:{id:'s',name:'平静',notes:'原始笔记',wordIds:['a','c'],createdAt:1}},stats:{},settings:{threshold:.7,dictProviders:[]},learning:{enabled:false,addCount:0,traces:[]},activity:{}})
test('dual membership is one shape and one synonym; list deduplicates and synonyms are not isolated',()=>{
 const state=reconcileRelations(fixture()), view=deriveManagementView(state)
 assert.equal(view.relations.a.shapeId,'g');assert.equal(view.relations.a.synonymId,'s');assert.equal(view.relations.c.isolated,false)
 assert.equal(managementWords(view.cards,'az').length,3)
})
test('multiple synonyms fail manual edits; legacy overlap is archived without losing notes',()=>{
 const state=fixture();state.synonymSets.second={id:'second',name:'another',notes:'keep',wordIds:['a','b'],createdAt:2}
 assert.throws(()=>reconcileRelations(state))
 const migrated=reconcileRelations(state,true)
 assert.equal(Object.values(migrated.synonymSets).filter(g=>g.wordIds.includes('a')).length,1)
 assert.ok(migrated.relationArchive?.some(g=>g.notes==='原始笔记'&&g.wordIds.includes('a')))
 assert.equal(Object.keys(migrated.words).length,3)
})
test('undo restores deleted relations and preserves unrelated later additions; rejects conflicting later edits',()=>{
 const before=reconcileRelations(fixture());const deleted=structuredClone(before)
 delete deleted.words.a;Object.values(deleted.groups).forEach(g=>g.wordIds=g.wordIds.filter(id=>id!=='a'));Object.values(deleted.synonymSets).forEach(g=>g.wordIds=g.wordIds.filter(id=>id!=='a'))
 const after=reconcileRelations(deleted),current=structuredClone(after)
 current.words.z={...before.words.a,id:'z',text:'zebra',groupId:'z'};current.groups.z={id:'z',wordIds:['z'],manual:false,createdAt:5}
 const restored=undoPatch(before,after,current)
 assert.ok(restored.words.z);assert.deepEqual(restored.synonymSets.s,before.synonymSets.s)
 current.words.a={...before.words.a,gloss:'later recreation'};assert.throws(()=>undoPatch(before,after,current))
})

test('conflicting deletion undo can recover the word independently without replacing later relationships',()=>{
 const before=fixture();before.stats.a={level:3,correct:8,wrong:1}
 const current=structuredClone(before);delete current.words.a;delete current.stats.a
 current.groups.g.wordIds=['b','c'];delete current.groups.c;current.words.c.groupId='g';current.synonymSets={}
 const recovered=reconcileRelations(restoreDeletedWord(before,current,'a'))
 assert.deepEqual(recovered.groups.g.wordIds,['b','c']);assert.deepEqual(recovered.stats.a,before.stats.a)
 assert.equal(recovered.words.a.gloss,'平静');assert.equal(deriveManagementView(recovered).relations.a.isolated,true)
 assert.throws(()=>restoreDeletedWord(before,recovered,'a'))
})
