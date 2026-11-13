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

test('online verification must corroborate every existing member; failure preserves a usable shape plan',async()=>{
 const original=globalThis.fetch,state=fixture();state.settings.synonymMode='verified'
 try {
   globalThis.fetch=(async()=>new Response(JSON.stringify([{word:'calm'}]))) as typeof fetch
   assert.equal((await planEntry({text:'tranquil'},state,new AbortController().signal)).near.length,0)
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
     assert.equal(isTie(plan.near),false)
     insertPlanned(state,input,plan,plan.shape[0]?.id??'',plan.near[0]?.id??'',id,1,'2026-11-13')
     state = reconcileRelations(state)
   }
   const view = deriveManagementView(state)
   assert.deepEqual(view.cards.map(card=>card.kind).sort(),['shape','synonym'])
   assert.equal(view.relations.lethal.shapeId,view.relations.leather.shapeId)
   assert.equal(view.relations.lethal.synonymId,view.relations.fatal.synonymId)
   assert.match(Object.values(state.synonymSets)[0].provenance!,/00996879-a~00997235-s/)
 }
 assert.ok(wordSimilarity('lethal','leather').score >= .7)
 assert.ok(wordSimilarity('lethal','leather').score < .8)
 assert.ok(wordSimilarity('lethal','fatal').score < .7)
})

test('automatic synonym planning never steals a word from an incompatible existing relation',async()=>{
 const state=fixture();state.synonymSets={other:{id:'other',name:'manual',notes:'keep',wordIds:['calm','balm'],createdAt:1}}
 const plan=await planEntry({text:'tranquil'},state,new AbortController().signal)
 assert.ok(plan.near.some(option=>!option.moveFrom))
 assert.ok(plan.near.filter(option=>!option.moveFrom).every(option=>!option.ids.includes('calm')))
 assert.ok(plan.near.some(option=>option.moveFrom?.id==='other' && option.ids.includes('calm')))
 assert.deepEqual(state.synonymSets.other.wordIds,['calm','balm'])
 assert.equal(isTie([{score:.9},{score:.87}]),true);assert.equal(isTie([{score:.9},{score:.7}]),false)
 const controller=new AbortController();controller.abort()
 await assert.rejects(planEntry({text:'tranquil'},state,controller.signal))
})
