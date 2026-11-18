import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { planEntry, isTie } from '../src/lib/entryPlan'
import { insertPlanned } from '../src/lib/batchEntry'
import { deriveManagementView } from '../src/lib/managementView'
import { reconcileRelations } from '../src/lib/relations'
import { wordSimilarity } from '../src/lib/similarity'
import type { LibraryState } from '../src/types/index'

function fixture(): LibraryState {
  const words = Object.fromEntries(['calm', 'serene', 'unagitated', 'tranquill', 'balm'].map((text,i) => [text, {id:text,text,gloss:text,meanings:[],groupId:text,addedAt:i,source:'manual' as const}]))
  return {words,groups:Object.fromEntries(Object.keys(words).map(id=>[id,{id,wordIds:[id],manual:false,createdAt:1}])),synonymSets:{s:{id:'s',name:'平静',notes:'keep',wordIds:['calm','serene','unagitated'],createdAt:1}},stats:{},settings:{threshold:.7,dictProviders:[],synonymMode:'offline'},learning:{enabled:false,addCount:0,traces:[]},activity:{}}
}

test('one lookup plans both relation types without mutating existing words; offline makes no API call', async()=>{
 const original=globalThis.fetch, requests:string[]=[]
 globalThis.fetch=(async input=>{const url=String(input);requests.push(url);assert.match(url,/^\/wordnet\/t.json$/);return new Response(await readFile(new URL('../public'+url,import.meta.url)))}) as typeof fetch
 try {
   const state=fixture(), before=structuredClone(state)
   const plan=await planEntry({text:'tranquil'},state,new AbortController().signal)
   assert.equal(plan.shape[0].id,'tranquill');assert.equal(plan.near[0].groupId,'s')
   assert.deepEqual(new Set(plan.near[0].ids),new Set(['calm','serene','unagitated']))
   assert.deepEqual(state,before);assert.ok(!requests.some(url=>url.startsWith('/fwd')))
 } finally { globalThis.fetch=original }
})

test('online verification can form a smaller relation without changing an existing group',async()=>{
 const original=globalThis.fetch,state=fixture();state.settings.synonymMode='verified'
 try {
   globalThis.fetch=(async()=>new Response(JSON.stringify([{word:'calm'}]))) as typeof fetch
   const verified = await planEntry({text:'tranquil'},state,new AbortController().signal)
   assert.deepEqual(verified.near.map(option => [option.groupId, option.ids]), [[undefined, ['calm']]])
   assert.deepEqual(state.synonymSets.s.wordIds, ['calm', 'serene', 'unagitated'])
   globalThis.fetch=(async()=>new Response('unavailable',{status:503})) as typeof fetch
   const failed=await planEntry({text:'tranquil'},state,new AbortController().signal)
   assert.equal(failed.near.length,0);assert.equal(failed.shape[0].id,'tranquill');assert.match(failed.nearStatus,/未完成/)
 } finally {globalThis.fetch=original}
})

test('successive entries create both relations in either order at the default threshold', async t => {
 const words = {
   lethal: {text:'lethal', phonetic:'/ˈliːθ(ə)l/', gloss:'致命的'},
   leather: {text:'leather', phonetic:'/ˈleðə(r)/', gloss:'皮革'},
   fatal: {text:'fatal', phonetic:'/ˈfeɪt(ə)l/', gloss:'致命的；灾难性的'},
 }
 t.mock.method(globalThis, 'fetch', async (input: string) => {
   assert.match(input, /^\/wordnet\/[fl]\.json$/)
   return new Response(await readFile(new URL('../public'+input, import.meta.url)))
 })
 const signal = new AbortController().signal
 for (const order of [
   ['lethal','leather','fatal'], ['lethal','fatal','leather'],
   ['leather','lethal','fatal'], ['leather','fatal','lethal'],
   ['fatal','lethal','leather'], ['fatal','leather','lethal'],
 ] as const) {
   let state: LibraryState = {...fixture(),words:{},groups:{},synonymSets:{}}
   for (const id of order) {
     const input = {...words[id],meanings:[],source:'api' as const}
     const plan = await planEntry(input,state,signal)
     assert.equal(isTie(plan.shape),false)
     insertPlanned(state,input,plan,plan.shape[0]?.id??'',id,1,'2026-11-13')
     state = reconcileRelations(state)
   }
   const view = deriveManagementView(state)
   assert.deepEqual(view.cards.map(card=>card.kind).sort(),['shape','synonym'])
   assert.equal(view.relations.lethal.shapeId,view.relations.leather.shapeId)
   assert.deepEqual(view.relations.lethal.synonymIds,view.relations.fatal.synonymIds)
   assert.match(Object.values(state.synonymSets)[0].provenance!,/00996879-a~00997235-s/)
 }
 assert.ok(wordSimilarity('lethal','leather').score >= .7)
 assert.ok(wordSimilarity('lethal','leather').score < .8)
 assert.ok(wordSimilarity('lethal','fatal').score < .7)
})

test('a new sense may reuse a member from an incompatible existing group',async()=>{
 const state=fixture();state.synonymSets={other:{id:'other',name:'manual',notes:'keep',wordIds:['calm','balm'],createdAt:1}}
 const plan=await planEntry({text:'tranquil'},state,new AbortController().signal)
 assert.ok(plan.near.every(option=>!option.groupId))
 assert.ok(plan.near.some(option=>option.ids.includes('calm')))
 insertPlanned(state,{text:'tranquil',gloss:'宁静的',meanings:[],source:'api'},plan,'','tranquil',10,'2026-11-15')
 assert.deepEqual(state.synonymSets.other.wordIds,['calm','balm'])
 assert.equal(isTie([{score:.9},{score:.87}]),true);assert.equal(isTie([{score:.9},{score:.7}]),false)
 const controller=new AbortController();controller.abort()
 await assert.rejects(planEntry({text:'tranquil'},state,controller.signal))
})

test('one entry joins all compatible groups and creates separate groups for uncovered senses', async t => {
 const terms = ['bank', 'depository', 'banking concern', 'riverbank', 'riverside', 'rely', 'depend']
 const words = Object.fromEntries(terms.slice(1).map(text => [text, {id:text,text,gloss:text,meanings:[],groupId:text,addedAt:1,source:'manual' as const}]))
 const state: LibraryState = {...fixture(), words, groups:Object.fromEntries(Object.keys(words).map(id => [id,{id,wordIds:[id],manual:false,createdAt:1}])), synonymSets:{
   money:{id:'money',name:'金融机构',notes:'原笔记',wordIds:['depository','banking concern'],createdAt:1},
   river:{id:'river',name:'河岸',notes:'河流',wordIds:['riverbank','riverside'],createdAt:2},
   another:{id:'another',name:'金融服务',notes:'另一组笔记',wordIds:['depository','banking concern'],createdAt:3},
 }}
 const senses = {
   finance:{id:'finance',definition:'a financial institution',terms:terms.slice(0,3)},
   land:{id:'land',definition:'land beside a river',terms:['bank','riverbank','riverside']},
   trust:{id:'trust',definition:'have confidence in',terms:['bank','rely']},
   count:{id:'count',definition:'depend on something',terms:['bank','depend']},
   repeated:{id:'repeated',definition:'depend on something',terms:['bank','depend']},
 }
 t.mock.method(globalThis, 'fetch', async (url: string) => {
   assert.equal(url, '/wordnet/b.json')
   return Response.json({lookup:{bank:Object.keys(senses)}, senses})
 })
 const input = {text:'bank',gloss:'银行；岸；依靠',meanings:[],source:'api' as const}
 const plan = await planEntry(input,state,new AbortController().signal)
 assert.equal(plan.near.length,5)
 insertPlanned(state,input,plan,'','bank',10,'2026-11-15')
 const saved = reconcileRelations(state)
 assert.deepEqual(saved.synonymSets.money.wordIds,['depository','banking concern','bank'])
 assert.deepEqual(saved.synonymSets.river.wordIds,['riverbank','riverside','bank'])
 assert.deepEqual(saved.synonymSets.another.wordIds,['depository','banking concern','bank'])
 assert.deepEqual(saved.synonymSets['near-bank'].wordIds,['rely','bank'])
 assert.deepEqual(saved.synonymSets['near-bank-2'].wordIds,['depend','bank'])
 assert.equal(saved.synonymSets.money.notes,'原笔记')
 assert.equal(saved.activity['2026-11-15'].added,1)
 assert.equal(deriveManagementView(saved).relations.bank.synonymIds.length,5)
})

test('verified mode skips the network when the library has no offline candidate', async t => {
 const state=fixture();state.settings.synonymMode='verified'
 state.words={balm:state.words.balm};state.groups={balm:state.groups.balm};state.synonymSets={}
 const requests:string[]=[]
 t.mock.method(globalThis,'fetch',async (input:string)=>{
   requests.push(input)
   if(input.startsWith('/fwd'))return new Response('[]')
   return new Response(await readFile(new URL('../public'+input,import.meta.url)))
 })
 const plan=await planEntry({text:'tranquil'},state,new AbortController().signal)
 assert.equal(plan.near.length,0);assert.equal(plan.nearIssue,undefined)
 // The shard may already be cached by earlier tests; the API must never be asked.
 assert.ok(!requests.some(url=>url.startsWith('/fwd')))
})
