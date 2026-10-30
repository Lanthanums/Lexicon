import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { planEntry, isTie } from '../src/lib/entryPlan'
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

test('automatic synonym planning never steals a word from an incompatible existing relation',async()=>{
 const state=fixture();state.synonymSets={other:{id:'other',name:'manual',notes:'keep',wordIds:['calm','balm'],createdAt:1}}
 const plan=await planEntry({text:'tranquil'},state,new AbortController().signal)
 assert.ok(plan.near.length>0);assert.ok(plan.near.every(option=>!option.ids.includes('calm')))
 assert.deepEqual(state.synonymSets.other.wordIds,['calm','balm'])
 assert.equal(isTie([{score:.9},{score:.87}]),true);assert.equal(isTie([{score:.9},{score:.7}]),false)
 const controller=new AbortController();controller.abort()
 await assert.rejects(planEntry({text:'tranquil'},state,controller.signal))
})
