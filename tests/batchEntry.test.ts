import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseEntries,insertPlanned} from '../src/lib/batchEntry'
import type {LibraryState} from '../src/types/index'
import {normalizeState} from '../src/lib/state'

const blank=():LibraryState=>({words:{},groups:{},synonymSets:{},stats:{},customSets:{},settings:{threshold:.7,dictProviders:[]},learning:{enabled:true,addCount:49,traces:[]},activity:{}})
test('batch parser accepts semicolons, normalizes and deduplicates, and keeps invalid entries explicit',()=>{
  assert.deepEqual(parseEntries(' Effluent;affluent；effulgent;EFFLUENT;;\nnot123; ice cream '),{words:['effluent','affluent','effulgent','ice cream'],invalid:['not123'],repeated:['effluent']})
})
test('staged batch entries can group with an earlier word from the same batch and commit exact counts',()=>{
  const s=blank(),plan={shape:[],near:[],nearStatus:'未找到近义关系'}
  insertPlanned(s,{text:'effluent',gloss:'流出的',meanings:[],source:'manual'},plan,'','','a',100,'2026-10-29')
  insertPlanned(s,{text:'affluent',gloss:'富裕的',meanings:[],source:'manual'},plan,'single-a','','b',101,'2026-10-29')
  assert.deepEqual(s.groups['single-a'].wordIds,['a','b'])
  assert.equal(s.activity['2026-10-29'].added,2);assert.equal(s.learning.addCount,51)
  const duplicate=insertPlanned(s,{text:'affluent',gloss:'保留原义',meanings:[],source:'manual'},plan,'','','c',102,'2026-10-29')
  assert.equal(duplicate.duplicate,true);assert.equal(s.words.b.gloss,'富裕的');assert.equal(s.activity['2026-10-29'].added,2)
})
test('new memory metadata round-trips and malformed memory plans reject the entire import',()=>{
  const s=blank();s.words.a={id:'a',text:'a',gloss:'一个',meanings:[],source:'manual',groupId:'g',addedAt:1};s.groups.g={id:'g',wordIds:['a'],manual:false,createdAt:1}
  s.stats.a={correct:2,wrong:1,level:1,lastSeen:100,dueAt:200,memory:{stability:3,difficulty:5,lapses:1}}
  assert.deepEqual(normalizeState(s,s).stats.a.memory,s.stats.a.memory)
  for(const bad of [-1,NaN,Infinity,366]){
    const invalid=structuredClone(s);invalid.stats.a.memory!.stability=bad
    assert.throws(()=>normalizeState(invalid,s))
  }
})
