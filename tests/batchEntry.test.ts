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

test('pasted lines normalize fullwidth letters, apostrophes and spaces; huge terms are flagged', () => {
  const oversized = 'a'.repeat(20000)
  assert.deepEqual(parseEntries(`ＣＡＮ’Ｔ\rice   cream\r\ncan't；well-known;bad -;${oversized}`), {
    words: ["can't", 'ice cream', 'well-known'], invalid: ['bad -', oversized], repeated: ["can't"],
  })
})

test('an old spelling variant is detected without replacing its record', () => {
  const s = blank()
  const plan = { shape: [], near: [], nearStatus: '' }
  insertPlanned(s, { text: 'CAN’T', gloss: '原义', meanings: [], source: 'manual' }, plan, '', '', 'old', 1, '2026-11-13')
  const result = insertPlanned(s, { text: "can't", gloss: '新义', meanings: [], source: 'manual' }, plan, '', '', 'new', 2, '2026-11-13')
  assert.equal(result.id, 'old')
  assert.equal(result.duplicate, true)
  assert.equal(s.words.old.gloss, '原义')
  assert.equal(s.words.new, undefined)
})
